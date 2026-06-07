# IOTO Tasks Center — 出链 badge 悬停显示链接列表

## Summary

在任务中心右侧任务列表中，用户将鼠标悬停在“输入/输出/成果”出链数量 badge 上时，弹出一个轻量 popover，展示该类别对应的“目标笔记列表”（按目标去重）。用户可在 popover 中点击目标笔记，直接在任务中心右侧固定 pane 打开该笔记。

## Current State Analysis

### Badge 渲染位置

- 任务行渲染：`IOTOTasksCenterView.renderTaskRows()`  
  [iotoTasksCenterView.ts:L845-L963](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L845-L963)
- 出链 badge DOM：`.ioto-tasks-center__task-outlink-count`（每类一个）
- 当前仅设置了 `title/ariaLabel`，无交互事件：
  [iotoTasksCenterView.ts:L870-L919](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L870-L919)

### 出链数据来源

- 使用 Obsidian cache：`this.app.metadataCache.resolvedLinks?.[task.path]`
- 计数纯函数：`countTaskOutlinksByRootPaths`  
  [task-outlink-counts.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-outlink-counts.ts)

### 右侧固定 pane 的打开方式

- 任务点击打开使用 `openFileInPreview(file)`，该方法会更新任务中心的“当前打开任务”状态：  
  [openFileInPreview](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2314-L2334)

### 已存在的 hover 交互冲突点

- 任务行本身有 `mouseover` 触发 Obsidian 的 hover preview：  
  [triggerTaskHoverPreview](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L965-L983)
- 若在 badge 上悬停同时触发任务行 hover preview，会产生 UI 叠加/干扰，需要规避。

## Decisions (Locked)

- 触发方式：鼠标悬停 badge 即显示列表（无需点击）。
- 点击列表项的打开位置：任务中心右侧固定 pane（与任务条目打开保持一致的区域）。
- 列表显示文本：目标笔记文件名（basename，不含 `.md`）。
- 链接范围：仅展示能解析到真实文件路径的 resolved outlinks（`metadataCache.resolvedLinks`）。
- 计数/列表口径：按目标笔记去重（同一目标多次链接仅展示一次）。

## Proposed Changes

### 1) 扩展出链纯函数：从“计数”升级为“分类后的目标列表”

**修改文件**

- [task-outlink-counts.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-outlink-counts.ts)

**新增导出**

- `TaskOutlinkTargets = { input: string[]; output: string[]; outcome: string[] }`
- `groupTaskOutlinksByRootPaths(resolvedLinksForSource, roots): TaskOutlinkTargets`

**规则**

- 输入 `resolvedLinksForSource`：`Record<string, number> | null | undefined`（key 为目标文件路径）
- 对 `Object.keys(resolvedLinksForSource ?? {})` 去重（天然去重）并按 rootPath 前缀分类：
  - `destPath === root` 或 `destPath.startsWith(root + '/')`
- 返回的数组做稳定排序（`localeCompare(undefined, { numeric: true })`）
- `countTaskOutlinksByRootPaths(...)` 内部改为复用 `groupTaskOutlinksByRootPaths(...)`，保证“计数与列表”逻辑一致。

**测试**

- 修改/新增单测覆盖 `groupTaskOutlinksByRootPaths`：
  - 文件：`tests/task-outlink-counts.test.mjs`
  - 覆盖：去重、前缀边界、排序、空输入。

### 2) 新增 popover UI 组件（可复用、便于管理关闭逻辑）

**新增文件**

- `src/ui/task-outlink-popover.ts`

**接口设计**

- `type TaskOutlinkCategory = 'input' | 'output' | 'outcome'`
- `interface TaskOutlinkPopoverItem { path: string; title: string; file: TFile }`
- `class TaskOutlinkPopover`：
  - `open(options)`：
    - `anchorEl: HTMLElement`
    - `category: TaskOutlinkCategory`
    - `items: TaskOutlinkPopoverItem[]`
    - `onItemClick: (file: TFile) => void`
  - `close()`：立即关闭并清理 DOM
  - `destroy()`：view close 时调用，确保无遗留监听器/DOM

**交互细节**

- 使用 `position: fixed` + `getBoundingClientRect()` 将 popover 放在 badge 下方（空间不足时放上方）。
- `mouseenter` 打开；`mouseleave` 延迟关闭（如 150ms），允许鼠标从 badge 移动到 popover 内点击。
- popover 内 `mouseenter` 取消关闭计时；`mouseleave` 再触发延迟关闭。
- 点击列表项：
  - 关闭 popover
  - 调用 `onItemClick(file)` 打开目标文件
- 点击 popover 外部区域：关闭 popover（document `mousedown` 捕获判断 `contains`）。
- 滚动/刷新：在 Tasks Center `render()` 或 `refreshFromVaultChange()` 前先 `close()`，避免悬浮层残留错位。

### 3) iotoTasksCenterView：为 badge 增加悬停事件，构建并展示链接列表

**修改文件**

- [iotoTasksCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)

**新增字段**

- `private readonly outlinkPopover = new TaskOutlinkPopover(activeDocument);`（或在 `onOpen` 初始化）

**新增方法**

- `private getOutlinkPopoverItems(taskPath: string, category: TaskOutlinkCategory): TaskOutlinkPopoverItem[]`
  - 读取 `resolvedLinks`，调用 `groupTaskOutlinksByRootPaths`
  - 取对应 category 的 `destPaths`
  - `destPath -> TFile`：`this.app.vault.getAbstractFileByPath(destPath)`，非 `TFile` 跳过
  - `title`：`file.basename`
  - 返回排序后的 items（与纯函数排序一致；如需二次排序，按 `title` 再排序）

- `private openOutlinkFileInPreview(file: TFile): Promise<void>`
  - 使用 `ensurePreviewLeaf()` + `leaf.openFile(file, { active: true })`
  - 不更新 `openedTaskPath / lastOpenedTaskByProject / openingTaskPath`，避免“打开非任务笔记导致任务激活态/缓存任务路径被覆盖”

**在渲染处绑定事件**

- 在每个 badge 创建后：
  - `badgeEl.addEventListener('mouseenter', (event) => { ... })`
  - `badgeEl.addEventListener('mouseleave', () => { outlinkPopover.requestClose(); })`
  - `event.stopPropagation()`：避免触发任务行 `mouseover` 的 hover preview
  - `outlinkPopover.open({ anchorEl: badgeEl, category, items, onItemClick: (file) => void this.openOutlinkFileInPreview(file) })`

**规避任务行 hover preview 冲突**

- 在任务行的 `mouseover` handler 中增加 guard：当事件源来自 `.ioto-tasks-center__task-outlink-count` 或 popover 内元素时，跳过 `triggerTaskHoverPreview`。

### 4) 样式：popover 与列表项

**修改文件**

- [styles.css](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css)

**新增样式类（建议）**

- `.ioto-tasks-center__outlink-popover`
  - `position: fixed; z-index: 9999;`
  - 背景/边框/阴影对齐 Obsidian 主题变量（如 `--background-primary`, `--background-modifier-border`）
  - `max-height` + `overflow: auto`（防止出链过多撑满屏幕）
- `.ioto-tasks-center__outlink-popover-title`（显示“输入/输出/成果出链”）
- `.ioto-tasks-center__outlink-popover-item`
  - 用 button 或 a-like 样式，hover 高亮
- `.ioto-tasks-center__outlink-popover-empty`（无链接时提示）

### 5) i18n：popover 标题与空态文案

**修改文件**

- [en.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)
- [zh-cn.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts)
- [zh-tw.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts)

**新增 keys（建议命名）**

- `task.outlinks.popover.title.input`
- `task.outlinks.popover.title.output`
- `task.outlinks.popover.title.outcome`
- `task.outlinks.popover.empty`

## Acceptance Criteria

- 悬停任一出链 badge 时，会弹出对应类别的目标笔记列表。
- 列表项可点击；点击后在任务中心右侧固定 pane 打开目标笔记。
- 列表展示目标笔记 basename（不含 `.md`），且按稳定顺序排序。
- 若无对应出链，popover 显示空态文案而不是空白。
- 悬停 badge 时不会再触发任务行的 hover preview（避免叠加）。
- 多语言：popover 标题与空态文案在 en/zh-cn/zh-tw 下正确显示。

## Verification Steps

1. 单测：
   - `npm test`
2. 构建：
   - `npm run build`
3. Obsidian 手动验证：
   - 打开任务中心，确保“显示任务出链计数”已开启（并至少开启其中一个类别）。
   - 在某任务笔记中添加链接到输入/输出/成果根目录下的若干笔记。
   - 回到任务中心：悬停对应类别 badge，应出现链接列表；点击任意项应在右侧 pane 打开对应笔记。
   - 鼠标在 badge → popover → 列表项之间移动，不应频繁闪烁关闭；点击 popover 外部应关闭。

