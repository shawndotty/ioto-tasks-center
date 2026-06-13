# 计划：任务状态 Badge 显示未完成 checklist popover

## Summary

- 在任务中心任务列表中，当任务状态为“待开始”或“进行中”时，鼠标悬停到状态 badge 上，显示一个 popover。
- popover 内容为该任务笔记中**未完成**的 checklist。
- checklist 文本过长时，popover 中仅显示前 20 个字符，超出部分以省略形式展示。
- 点击 popover 中某条 checklist 后，打开对应任务笔记，并在编辑态中选中该 checklist，以实现稳定的“高亮定位”。

## Current State Analysis

- 当前任务行渲染逻辑位于 [iotoTasksCenterView.ts:L1040-L1188](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1040-L1188)
  - 已渲染状态 badge：`ioto-tasks-center__task-status`
  - 但状态 badge 目前仅显示文字，没有 hover popover
- 当前状态 badge 的样式位于 [styles.css:L1067-L1101](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css#L1067-L1101)
- 当前出链 popover 已有成熟实现，可复用其交互骨架：
  - 组件： [task-outlink-popover.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/task-outlink-popover.ts)
  - 视图绑定： [bindTaskOutlinkPopover](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1190-L1217)
  - 样式： [styles.css:L961-L1018](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css#L961-L1018)
- 当前任务状态解析逻辑在 [data.ts:L399-L509](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/data.ts#L399-L509)
  - 目前只会统计 checklist 的总数和完成数
  - 还不会返回“未完成 checklist 的文本内容 + 行号”
- 当前任务打开逻辑位于：
  - [openTaskFile](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2891-L2914)
  - [openFileInPreview](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L3037-L3058)
- 仓库里已经存在“打开后设置编辑器选区”的现成模式，见 [selected-text-subtask.ts:L198-L221](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/selected-text-subtask.ts#L198-L221)
  - 说明“打开笔记后，在编辑器里选中范围”是当前代码风格下可复用、可稳定落地的方案
- 另一个需要注意的现状：
  - 任务行 `mouseover` 目前只排除了出链 badge，没有排除状态 badge，见 [iotoTasksCenterView.ts:L1152-L1162](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1152-L1162)
  - 如果直接给状态 badge 加 popover，不处理这一层，任务 hover preview 很可能会与 checklist popover 冲突

## Assumptions & Decisions

- 仅在 `task.status.key === 'todo'` 和 `task.status.key === 'in-progress'` 时绑定 checklist popover。
- `completed` 和 `empty` 状态不显示 checklist popover。
- checklist 的“高亮”实现采用你确认的方式：**打开笔记后，在编辑态中选中目标 checklist 那一行/文本范围**。
- popover 中的展示文本规则：
  - 文本长度 `<= 20`：完整显示
  - 文本长度 `> 20`：截取前 20 个字符并追加省略号
- 点击 popover 项时，依赖**解析出的源文件行号**来定位，而不是依赖文本模糊匹配；这样即使多条 checklist 文本相同，也能稳定定位到被点击的那一条。

## Proposed Changes

### 1) 扩展 checklist 解析能力，返回未完成项与位置信息

**文件**：`src/tasks-center/data.ts`

- 在现有 `TASK_LINE_PATTERN` 和状态统计逻辑基础上，新增未完成 checklist 解析函数，而不是重写一套新正则。
- 建议新增导出类型，例如：
  - `IncompleteChecklistItem`
- 建议至少包含这些字段：
  - `text`: checklist 原始有效文本（不含 `- [ ]` 前缀）
  - `line`: 所在行号（0-based，便于直接传给 Editor）
  - `lineText`: 原始整行文本（用于必要时兜底选中整行）
  - `selectionStartCh` / `selectionEndCh`: 文本在该行中的选区范围
- 建议新增导出函数：
  - `getIncompleteChecklistItemsFromContent(content: string): IncompleteChecklistItem[]`
  - `getIncompleteChecklistItems(app: App, file: TFile): Promise<IncompleteChecklistItem[]>`
- 解析规则：
  - 忽略 `%% %%` 和 `<!-- -->` 注释块内的 checklist，保持与现有状态统计一致
  - 只返回未完成项（`[ ]`）
  - 忽略空白 checklist 内容
  - 保留原始行号与内容位置，供后续点击定位使用

### 2) 新增专用 checklist popover 组件

**文件**：新增 `src/ui/task-status-checklist-popover.ts`

- 不直接改造 `task-outlink-popover.ts` 为通用组件，避免影响已有出链 hover/ctrl-preview 行为。
- 组件结构参考现有 outlink popover，但保持职责单一：
  - `open({ anchorEl, title, emptyText, items, onItemClick })`
  - `scheduleClose() / cancelClose() / close() / destroy()`
- checklist item 结构建议包含：
  - `text`
  - `displayText`
  - `line`
  - `selectionStartCh`
  - `selectionEndCh`
- `displayText` 建议通过一个小 helper 统一生成，例如：
  - `truncateChecklistPreview(text, 20)`
- 这样测试可以只覆盖纯函数，不需要写重 UI 测试。

### 3) 在状态 badge 上绑定 popover，并避免与任务 hover preview 冲突

**文件**：`src/views/iotoTasksCenterView.ts`

- 在状态 badge 创建后：
  - 仅当 `task.status.key` 为 `todo` / `in-progress` 时调用新的绑定方法，例如：
    - `bindTaskStatusChecklistPopover(statusEl, task)`
- 新增字段：
  - `private taskStatusChecklistPopover: TaskStatusChecklistPopover | null = null;`
- 在 [onOpen](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L267-L292) 中实例化该 popover
- 在 [onClose](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L294-L311) 中销毁该 popover
- 绑定逻辑：
  - `mouseenter`：读取目标任务文件的未完成 checklist，打开 popover
  - `mouseleave`：延迟关闭，允许鼠标移入 popover
- 必须同步修改任务行 `mouseover` 的排除条件：
  - 当前只排除 `.ioto-tasks-center__task-outlink-count`
  - 需要额外排除 `.ioto-tasks-center__task-status`
  - 避免状态 badge hover 时同时出现任务 hover preview 与 checklist popover

### 4) 点击 checklist 后打开任务并在编辑态选中目标项

**文件**：`src/views/iotoTasksCenterView.ts`

- 新增方法，例如：
  - `private async openTaskFileAtChecklist(taskPath: string, item: IncompleteChecklistItem): Promise<void>`
- 实现流程：
  1. 根据 `taskPath` 取到 `TFile`
  2. 复用当前 preview leaf 打开逻辑，优先在现有右侧 leaf 中打开该任务
  3. 打开成功后获取该 leaf 的 `MarkdownView`
  4. 使用 `view.editor.setSelection(...)` 选中目标 checklist 的文本范围
  5. `editor.focus()`，让选区可见并形成明确高亮
- 选中策略：
  - 优先选中 checklist 文本内容（不含 `- [ ]`）
  - 如果定位信息失效，则兜底选中整行
- 回退策略：
  - 如果目标 leaf/view/editor 不可用，至少仍执行现有 `openFileInPreview(file)`，保证点击能打开文件

### 5) 样式与文案

**文件**：
- `styles.css`
- `src/lang/locale/en.ts`
- `src/lang/locale/zh-cn.ts`
- `src/lang/locale/zh-tw.ts`

- 新增 checklist popover 样式，建议与现有 outlink popover 保持相似的面板语言：
  - `.ioto-tasks-center__status-checklist-popover`
  - `.ioto-tasks-center__status-checklist-popover-title`
  - `.ioto-tasks-center__status-checklist-popover-empty`
  - `.ioto-tasks-center__status-checklist-popover-list`
  - `.ioto-tasks-center__status-checklist-popover-item`
- 文案建议新增：
  - `task.status.popover.todoTitle`
  - `task.status.popover.inProgressTitle`
  - `task.status.popover.empty`
- 标题建议分别体现当前状态，如：
  - 待开始：未完成 checklist
  - 进行中：未完成 checklist
  - 或者“待开始任务的未完成 checklist / 进行中任务的未完成 checklist”

### 6) 测试策略

**文件**：
- `tests/task-status.test.mjs`
- 如有必要，可新增轻量测试文件，例如 `tests/task-status-checklist-popover.test.mjs`

- 在 `task-status.test.mjs` 中新增覆盖：
  - 能正确提取未完成 checklist
  - 已完成 checklist 不会进入结果
  - 注释块中的 checklist 不会进入结果
  - 空白 checklist 不会进入结果
  - 返回的行号与顺序正确
- 若把 20 字截断提炼成纯函数，则给该 helper 加一个轻量测试：
  - 20 字以内不截断
  - 超过 20 字时截断并追加省略号

## Verification Steps

- 自动化：
  - `npm test`
  - `npm run build`
  - `npm run lint`
- 手动（Obsidian）：
  1. 在任务列表中找到状态为“待开始”的任务
  2. 鼠标悬停到状态 badge，确认出现 checklist popover
  3. 确认只显示未完成 checklist
  4. 对于很长的 checklist，确认 popover 中只显示前 20 个字符
  5. 点击其中一条 checklist，确认打开对应任务笔记
  6. 确认打开后进入编辑态，并选中对应 checklist
  7. 对状态为“进行中”的任务重复同样验证
  8. 对“已完成”或“空”状态任务验证，确认不会出现 checklist popover

