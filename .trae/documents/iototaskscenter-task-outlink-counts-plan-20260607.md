# IOTO Tasks Center — 任务条目出链计数显示（输入/输出/成果）

## Summary

在 Tasks Center 右侧任务列表中，每个任务条目在任务标题后追加 3 类“任务笔记出链计数”（输入/输出/成果）。计数口径为“按目标笔记去重”，展示形式为紧跟标题的 3 个小 badge；并在 **Basic** 设置页提供：

- 总开关：是否显示出链计数
- 分类开关：选择显示输入/输出/成果哪几类的计数

所有新增文案支持多语言（en/zh-cn/zh-tw）。

## Current State Analysis

### 任务条目渲染位置

- 任务列表条目渲染在 [iotoTasksCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts) 的 `renderTaskRows()`：
  - [iotoTasksCenterView.ts:L801-L888](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L801-L888)
  - 当前仅渲染标题（`.ioto-tasks-center__task-title`）、可选 priority badge、状态 badge。

### Settings 结构与 Basic 页

- 设置结构与默认值在 [settings.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts)：
  - `IOTOTasksCenterSettings` + `DEFAULT_SETTINGS`：[settings.ts:L42-L74](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts#L42-L74)
- Basic tab 的渲染在：
  - [settings.ts:L197-L322](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts#L197-L322)

### i18n 约束

- `TranslationKey = keyof typeof en`（en.ts 是 key 真源），新增 key 必须先添加到：
  - [en.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)

### 现状缺口

- 代码库中没有任何“出链/链接提取/计数”的现成逻辑，需要新增实现。

## Decisions (Locked)

- **计数口径**：按目标笔记去重（同一目标笔记被多次链接也只算 1）。
- **展示形式**：任务标题后展示 3 个小 badge（可通过设置选择显示哪些 badge）。
- **链接识别方式**：基于 Obsidian 的已解析链接（resolved outlinks），以目标文件的实际路径分类，而不是基于链接文本是否包含文件夹前缀。

## Proposed Changes

### 1) 新增“出链计数”纯函数模块（可测试）

**新增文件**

- `src/tasks-center/task-outlink-counts.ts`

**内容与职责**

- 定义计数结果类型：
  - `TaskOutlinkCounts = { input: number; output: number; outcome: number }`
- 提供纯函数（不依赖 Obsidian API），输入为“单个任务文件的 resolvedLinks map”与 3 个 rootPath，输出 3 类计数：
  - `countTaskOutlinksByRootPaths(resolvedLinksForSource, { inputRootPath, outputRootPath, outcomeRootPath })`
- 计数规则：
  - 遍历 `Object.keys(resolvedLinksForSource ?? {})`（每个 key 为目标文件路径，天然去重）
  - 对每个目标路径按前缀分类：
    - `matchesRoot(destPath, root)` 为 `destPath === root` 或 `destPath.startsWith(root + '/')`
  - 各分类计数为匹配到的“目标路径数量”（去重后）

**边界处理**

- rootPath 均是“vault 相对路径、无尾部 /”的规范化结果（来自现有 normalize），因此前缀判断只需处理 `root` 与 `root/`。
- 若 rootPath 之间存在前缀包含关系（罕见），同一目标可能被多类同时命中；本次实现按“各类独立匹配”计数（不做互斥分配）。

### 2) 单元测试覆盖计数与前缀匹配

**新增文件**

- `tests/task-outlink-counts.test.mjs`

**测试点**

- 同一目标多次链接（resolvedLinks value > 1）仍只计 1。
- `root/xxx.md` 命中，`rootx/xxx.md` 不命中（前缀边界）。
- 输入/输出/成果分别计数正确，空 map 返回 0/0/0。

### 3) Settings：新增总开关 + 分类开关（Basic tab）

**修改文件**

- [settings.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts)

**新增 settings 字段**

在 `IOTOTasksCenterSettings` + `DEFAULT_SETTINGS` 增加：

- `showTaskOutlinkCounts: boolean`（默认 `false`，避免默认增加 UI 噪音）
- `showTaskInputOutlinkCount: boolean`（默认 `true`）
- `showTaskOutputOutlinkCount: boolean`（默认 `true`）
- `showTaskOutcomeOutlinkCount: boolean`（默认 `true`）

**Basic tab UI 增补**

在 Basic tab（[settings.ts:L197-L322](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts#L197-L322)）中，建议放在 “Task list behavior” 之后、Project sort heading 之前，新增一个区块：

- Heading：`settings.heading.taskOutlinks`
- Toggle：`showTaskOutlinkCounts`
- Toggles：`showTaskInputOutlinkCount` / `showTaskOutputOutlinkCount` / `showTaskOutcomeOutlinkCount`

交互细节：

- 总开关关闭时：任务列表不渲染 counters。
- 分类开关仅影响展示哪些 badge；对应类别没有出链时展示 `0`。
- 分类开关即使在总开关关闭时也允许用户预先配置（开启总开关后立即生效）。

### 4) main.ts：新增 update 方法 + 将新设置透传给 Tasks Center View

**修改文件**

- [main.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts)

**新增 update 方法**

仿照 `updateShowTaskPriority(show)` 的实现，增加：

- `updateShowTaskOutlinkCounts(show: boolean)`
- `updateShowTaskInputOutlinkCount(show: boolean)`
- `updateShowTaskOutputOutlinkCount(show: boolean)`
- `updateShowTaskOutcomeOutlinkCount(show: boolean)`

这些方法：

- 若值未变化直接 return
- 更新 `this.settings.*`
- `await this.saveSettings()`
- `this.applySettingsToOpenViews()`

**View 构造参数透传**

`registerView(IOTO_TASKS_CENTER_VIEW_TYPE, ...)` 中向 `new IOTOTasksCenterView(...)` 追加 getter/update 依赖：

- getters：
  - `() => this.settings.inputRootPath`
  - `() => this.settings.outputRootPath`
  - `() => this.settings.outcomeRootPath`
  - `() => this.settings.showTaskOutlinkCounts`
  - `() => this.settings.showTaskInputOutlinkCount`
  - `() => this.settings.showTaskOutputOutlinkCount`
  - `() => this.settings.showTaskOutcomeOutlinkCount`
- updates：
  - 对应调用上述 update 方法（供 view 内未来可能的展示菜单复用；本次主要由 settings 页调用）

### 5) Tasks Center View：在任务标题后渲染 badges（含 i18n tooltip）

**修改文件**

- [iotoTasksCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)

**构造函数新增依赖**

在 `IOTOTasksCenterView` 的字段与构造函数参数中追加：

- root path getters：`getInputRootPath/getOutputRootPath/getOutcomeRootPath`
- 显示控制 getters：`getShowTaskOutlinkCounts` + 三个分类 getter

**渲染逻辑（renderTaskRows）**

在 `renderTaskRows()`：

- 将现有 `rowEl.createDiv({ cls: '...__task-title', text: task.title })` 改为可容纳“标题文本 + counters”的结构：
  - `.ioto-tasks-center__task-title`（作为 flex 容器）
    - `.ioto-tasks-center__task-title-text`（仅标题文本，支持 ellipsis）
    - `.ioto-tasks-center__task-outlink-counts`（badge 容器）
- 当 `getShowTaskOutlinkCounts()` 为 `true` 时：
  - 从 `this.app.metadataCache.resolvedLinks?.[task.path]` 读取该任务的 resolved outlinks map
  - 调用 `countTaskOutlinksByRootPaths(...)` 得到 `{ input, output, outcome }`
  - 按用户开启的分类顺序渲染 badge（顺序固定：输入 → 输出 → 成果）：
    - `.ioto-tasks-center__task-outlink-count`
    - `text` 为数字
    - `title`/`ariaLabel` 使用 i18n key（例如 “Input outlinks: 3”）

### 6) 样式：新增 counters/badge 样式（不影响现有 priority/status）

**修改文件**

- [styles.css](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css)

**新增/调整样式点**

- 让 `.ioto-tasks-center__task-title` 成为 flex 容器以支持 “标题文本 + badge”：
  - `.ioto-tasks-center__task-title { display: flex; align-items: center; gap: 8px; min-width: 0; }`
- 将原本 ellipsis 能力移动到 `.ioto-tasks-center__task-title-text`，避免 counters 被截断：
  - `.ioto-tasks-center__task-title-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`
- counters 容器与 badge：
  - `.ioto-tasks-center__task-outlink-counts { flex: 0 0 auto; display: inline-flex; gap: 6px; }`
  - `.ioto-tasks-center__task-outlink-count { ... }`（外观参考现有 priority/status，但更轻量：小字号、圆角 pill、muted 配色）

### 7) i18n：新增 settings 文案 + badge tooltip 文案

**修改文件**

- [en.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)
- [zh-cn.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts)
- [zh-tw.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts)

**新增 key（建议命名）**

Settings（Basic）：

- `settings.heading.taskOutlinks`
- `settings.taskOutlinks.show.name`
- `settings.taskOutlinks.show.desc`
- `settings.taskOutlinks.input.name`
- `settings.taskOutlinks.input.desc`
- `settings.taskOutlinks.output.name`
- `settings.taskOutlinks.output.desc`
- `settings.taskOutlinks.outcome.name`
- `settings.taskOutlinks.outcome.desc`

Badge tooltip：

- `task.outlinks.input`（带 `{0}`：数量）
- `task.outlinks.output`
- `task.outlinks.outcome`

## Acceptance Criteria

- Basic 设置页可配置：
  - 总开关关闭时：任务列表不显示任何出链 badge
  - 总开关开启时：在每条任务标题后显示所选分类的 badge；无出链时显示 `0`
  - 可单独关闭输入/输出/成果任意一类 badge
- 计数准确：
  - 统计的是“任务笔记的出链目标笔记”去重后的数量（同一目标多次链接仅算 1）
  - 分类依据为目标笔记的实际路径前缀（匹配 input/output/outcome root folder）
- 多语言：
  - Settings 文案与 badge tooltip 在 en/zh-cn/zh-tw 下均正常显示
- 不影响现有 UI：
  - priority/status badge 行为不变
  - 标题仍可省略号截断，且 counters 不会被截断掉

## Verification Steps

1. 运行单元测试：
   - `npm test`
2. 构建检查：
   - `npm run build`
3. Obsidian 手动验证（推荐场景）：
   - 打开 **Settings → Community plugins → IOTO Tasks Center → Basic**
   - 开启 “Show task outlink counters”，确认任务列表出现 badge
   - 在某任务笔记中创建链接：
     - 链接到 `inputRootPath` 下的任意笔记、`outputRootPath` 下的任意笔记、`outcomeRootPath` 下的任意笔记
     - 同一目标多次链接（例如重复两次），badge 仍只 +1
   - 切换分类开关，确认 badge 增减与顺序正确（输入→输出→成果）

