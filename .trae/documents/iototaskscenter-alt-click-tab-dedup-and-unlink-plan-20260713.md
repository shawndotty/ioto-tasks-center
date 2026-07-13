# Summary

优化任务中心任务列表的 Alt/Option+点击打开逻辑，解决两个问题：

1. Alt/Option+点击新开的任务标签不应与任务中心标签形成 Obsidian “链接窗格/联动组（Linked panes）”关联。
2. 若同一个任务笔记已在**任务中心所在的同一标签组（同一 tab bar）**中打开，再次 Alt/Option+点击时不应再开重复标签，而是直接切换到已打开的标签。

# Current State Analysis

- Alt/Option+点击入口在任务行渲染处：
  - [task-row-renderer.ts:L198-L202](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/tasks-center/task-row-renderer.ts#L198-L202)
  - 当前实现会调用 `view.openTaskFile(task, { target: 'current-pane-tab' })`。

- `IOTOTasksCenterView.openTaskFile(...)` 会在 `target === 'current-pane-tab'` 时走 `openFileInCurrentPaneTab(file)`：
  - [iotoTasksCenterView.ts:L1172-L1187](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1172-L1187)

- `openFileInCurrentPaneTab(file)` 当前实现：
  - [iotoTasksCenterView.ts:L1352-L1374](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1352-L1374)
  - 使用 `const leaf = this.app.workspace.getLeaf('tab')` 创建新 leaf。
  - 随后 `leaf.openFile(file, { active: true, group: this.leaf })`。
  - 这里的 `group: this.leaf` 会让新 leaf 与任务中心 leaf 进入同一“联动组”，导致你看到的“标签关联”现象。
  - 另外该路径不做查重，因此重复 Alt/Option+点击同一任务会不断创建重复标签。

- 现有仓库中已经有跨 workspace 查找“指定文件对应 leaf”的工具：
  - `IOTOTasksCenterView.findLeafByFilePath(filePath)` → `src/views/tasks-center/preview-leaf.ts` 的 `findLeafByFilePath(...)`（全局查找，但不限定同一标签组）
  - [iotoTasksCenterView.ts:L1435-L1437](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1435-L1437)

# Proposed Changes

## 1. 移除 Alt/Option 新标签的“联动组”关联

- 文件：`src/views/iotoTasksCenterView.ts`
- 修改点：`openFileInCurrentPaneTab(file)`
- 具体变更：
  - 将 `leaf.openFile(file, { active: true, group: this.leaf })` 改为不传 `group`，即 `leaf.openFile(file, { active: true })`。
- 原因：
  - 你确认“关联”指的是 Obsidian 的 Linked panes 联动组行为，这对任务中心新开的任务标签没有意义，应移除。

## 2. Alt/Option+点击在“同一标签组”内做去重：已打开则切换，不再重复打开

- 文件：`src/views/iotoTasksCenterView.ts`
- 修改点：`openFileInCurrentPaneTab(file)`
- 具体变更：
  - 在创建新 leaf 前，先尝试在**任务中心所在的同一标签组**里查找已打开该文件的 leaf；若找到则直接激活它并返回。
  - “同一标签组”的判定基于 Obsidian 类型定义：桌面端 leaf 的 `parent` 是 `WorkspaceTabs`，同一 tab bar 下 siblings 共享同一个 `parent`。
    - 判定：`candidateLeaf.parent === this.leaf.parent`
  - 为兼容 deferred leaf（后台延迟加载导致 `leaf.view` 不一定是 `FileView`），查重优先用 `leaf.getViewState()` 判断：
    - `leaf.getViewState().type === 'markdown'`
    - `leaf.getViewState().state?.file === file.path`
- 用户选择约束：
  - 你选择“仍在当前组新开”：如果目标笔记只在**其他标签组/其他 pane**中打开，不需要跳转过去；仅在当前 tab bar 内查重。

## 3. 抽一个小型 helper（可选但推荐）

- 文件：`src/views/iotoTasksCenterView.ts`
- 新增私有方法（示例）：
  - `private findLeafInCurrentTabGroupByFilePath(filePath: string): WorkspaceLeaf | null`
- 原因：
  - 避免把遍历 workspace + 同组过滤 + deferred 兼容逻辑堆进 `openFileInCurrentPaneTab`，保持方法职责清晰。

# Assumptions & Decisions

- 决策：Alt/Option+点击仍然要在任务中心所在 tab bar 中创建/复用标签；不改变普通点击打开到相邻预览 pane 的默认行为。
- 决策：仅在当前 tab bar 内去重；目标笔记若仅在别处打开，仍会在当前 tab bar 新开一个（你已确认该偏好）。
- 决策：移除 `openFile(..., { group: this.leaf })`，确保不触发 Linked panes 联动组。
- 决策：如果命中已打开 leaf，则不进入 “openingTaskPath/loading 态” 流程，直接切换 leaf（减少不必要的 UI 闪烁）。

# Verification Steps

## 自动化验证

1. 运行 `./node_modules/.bin/tsc --noEmit`
2. 运行 `npm run lint`
3. 运行 `npm run build`

## 手动验证（Obsidian 桌面端）

1. 打开 Tasks Center，确保它所在 pane 的 tab bar 中存在其它标签。
2. Alt/Option+点击某个任务：
   - 应在同一 tab bar 新开任务标签。
   - 新开任务标签不应与任务中心形成 Linked panes 联动组（不出现联动图标/联动行为）。
3. 在不关闭该任务标签的情况下，再次 Alt/Option+点击同一个任务：
   - 不应新建重复标签。
   - 应直接切换并聚焦到已打开的那个任务标签。
4. 若该任务笔记在**其他 pane/tab bar**里也打开着：
   - Alt/Option+点击仍应在当前 tab bar 新开（或复用当前 tab bar 的）标签，而不是跳转到别处（符合你的选择）。

