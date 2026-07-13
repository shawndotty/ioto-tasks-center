# Summary

为任务中心中的任务条目增加一个新的点击分支：默认点击仍保持现有行为，在任务中心相邻的预览 pane 中打开任务文件；当用户按住 `Alt/Option` 再点击任务条目时，改为在任务中心所在的同一个 pane（同一 tab group）中新开一个 Markdown tab 打开该任务文件。

# Current State Analysis

- `src/views/tasks-center/task-row-renderer.ts`
  - 当前任务行点击逻辑是固定的：
    - [task-row-renderer.ts:L198-L200](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/tasks-center/task-row-renderer.ts#L198-L200)
    - 代码直接监听 `click`，无条件执行 `view.openTaskFile(task)`。
  - 当前没有读取 `MouseEvent.altKey`，也没有为“同 pane 新 tab”定义任何分支逻辑。

- `src/views/iotoTasksCenterView.ts`
  - 当前 `openTaskFile(task)` 是任务条目打开文件的唯一入口：
    - [iotoTasksCenterView.ts:L1170-L1192](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1170-L1192)
  - 该方法只会把目标文件交给 `openFileInPreview(file)`。
  - `openFileInPreview(file)` 固定使用 `ensurePreviewLeaf()` 获取目标 leaf：
    - [iotoTasksCenterView.ts:L1295-L1328](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1295-L1328)

- `src/views/tasks-center/preview-leaf.ts`
  - `ensurePreviewLeaf(view)` 的实现会优先复用 `view.previewLeaf`，否则调用 `app.workspace.createLeafBySplit(view.leaf, 'vertical')`：
    - [preview-leaf.ts:L35-L51](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/tasks-center/preview-leaf.ts#L35-L51)
  - 这解释了为什么当前点击任务时会稳定在任务中心相邻的 pane 中打开，而不是当前 pane。

- `node_modules/obsidian/obsidian.d.ts`
  - `Workspace.getLeaf('tab')` 支持创建一个新的 tab leaf。
  - `OpenViewState` 带有 `group?: WorkspaceLeaf`，可以指定新打开的 leaf 归入哪个 leaf 所在的 tab group。
  - 这为“在任务中心所在的同一个 pane 里新开 tab”提供了可行的 Obsidian 原生实现路径。

- 当前调用面
  - `openTaskFile(task)` 目前仅在 `task-row-renderer.ts` 中被调用一次：
    - [rg 结果](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/tasks-center/task-row-renderer.ts#L199)
  - 这意味着我们可以较安全地给 `openTaskFile` 增加一个可选的打开模式参数，而不会牵动大量调用点。

# Proposed Changes

## 1. 在任务行点击事件中识别 Alt/Option 修饰键

- 文件：`src/views/tasks-center/task-row-renderer.ts`
- 变更：
  - 将当前无参点击监听：
    - `rowEl.addEventListener('click', () => { void view.openTaskFile(task); });`
  - 调整为接收 `MouseEvent`，并根据 `event.altKey` 决定打开模式。
- 实现方式：
  - 使用 `rowEl.addEventListener('click', (event: MouseEvent) => { ... })`。
  - 当 `event.altKey === true` 时，调用类似 `view.openTaskFile(task, { target: 'current-pane-tab' })`。
  - 否则保持现有 `view.openTaskFile(task)` 逻辑不变。
- 原因：
  - `Alt/Option` 是这次需求的唯一触发条件，最适合在最靠近用户交互的地方做分流。

## 2. 为任务打开行为增加显式目标模式

- 文件：`src/views/iotoTasksCenterView.ts`
- 变更：
  - 给 `openTaskFile` 增加一个可选参数，用来表达目标打开位置。
  - 推荐签名：
    - `async openTaskFile(task: TaskFileEntry, options?: { target?: 'adjacent-preview' | 'current-pane-tab' }): Promise<void>`
  - 默认值仍为 `'adjacent-preview'`，确保现有调用语义不变。
- 实现方式：
  - 保留现有“重复点击已打开文件时跳过重新打开”的判定，仅用于默认预览路径。
  - 当 `target === 'current-pane-tab'` 时，跳过 `shouldSkipOpeningTask(...)` / `activatePreviewLeaf()` 这一套预览叶复用逻辑，直接进入新的“当前 pane 新 tab 打开”分支。
  - 当 `target !== 'current-pane-tab'` 时，继续沿用现有默认逻辑。
- 原因：
  - 把分支判断集中在 view 层，可以避免 renderer 直接触碰 workspace 细节，也便于后续继续扩展其他打开方式。

## 3. 新增“当前 pane 新 tab 打开任务”的专用方法

- 文件：`src/views/iotoTasksCenterView.ts`
- 变更：
  - 新增一个专用方法，例如：
    - `private async openFileInCurrentPaneTab(file: TFile): Promise<void>`
- 实现方式：
  - 使用 `const leaf = this.app.workspace.getLeaf('tab');`
  - 通过 `await leaf.openFile(file, { active: true, group: this.leaf })` 将新 leaf 归入任务中心当前 leaf 所在的 tab group。
  - 打开后调用 `this.app.workspace.setActiveLeaf(leaf, { focus: true })`，确保新 tab 成为前台 tab。
  - 与现有 `openFileInPreview(file)` 一样，复用 `openingTaskPath` 的 loading/render 流程，保证点击时任务行 loading 态一致。
  - 与现有打开流程保持一致地更新：
    - `this.openedTaskPath = file.path`
    - 若存在 `this.selectedProject`，同步更新 `this.lastOpenedTaskByProject`
  - 不更新 `this.previewLeaf`，避免把“默认点击打开到相邻 pane”的既有预览叶行为污染成当前 pane tab。
- 原因：
  - 这是最直接贴合需求的实现点。
  - `group: this.leaf` 明确表达“新 tab 属于任务中心所在 pane”，比仅调用 `getLeaf('tab')` 更符合“同一个 pane”的要求。

## 4. 保持搜索关键词高亮逻辑只作用于默认预览路径

- 文件：`src/views/iotoTasksCenterView.ts`
- 变更：
  - `openFileInCurrentPaneTab(file)` 不复用当前 `openFileInPreview(file)` 里的“带搜索词时切 source 模式并选中首个匹配”的逻辑。
- 决策：
  - Alt/Option+点击的新需求目标是“在同一个 pane 新开 tab”，而不是“复制相邻预览 pane 的所有搜索高亮行为”。
  - 默认点击继续保留现有搜索高亮/定位实现。
- 原因：
  - 当前搜索高亮实现与 `previewLeaf` 绑定紧密，直接搬到“当前 pane 新 tab”路径会扩大改动范围，并引入更多状态耦合。
  - 这次实现先聚焦用户明确提出的交互差异，避免一次性混入新的行为变化。

## 5. 不修改 `preview-leaf.ts` 的默认预览机制

- 文件：`src/views/tasks-center/preview-leaf.ts`
- 变更：
  - 本次不改 `ensurePreviewLeaf(view)`、`activatePreviewLeaf(view)`、`resolveActiveTaskPath(...)` 的默认设计。
- 原因：
  - 当前默认点击行为已经稳定依赖这些函数。
  - Alt/Option+点击是新增分支，不应反向改变原有“相邻 pane 预览”的主流程。

# Assumptions & Decisions

- 决策：普通点击继续保持现有行为，不做任何交互变化。
- 决策：`Alt`（Windows/Linux）与 `Option`（macOS）统一按 `MouseEvent.altKey` 处理。
- 决策：Alt/Option+点击时，在任务中心所在的同一个 tab group 中新建并激活一个 Markdown tab。
- 决策：Alt/Option+点击路径不会覆盖 `previewLeaf`，以保护默认点击仍然打开到相邻 pane。
- 决策：Alt/Option+点击路径会更新 `openedTaskPath` 和 `lastOpenedTaskByProject`，让“最近打开任务”状态仍可被记录。
- 决策：本次不额外增加右键菜单、提示文案、tooltip 或设置项。
- 假设：Obsidian 当前桌面端对 `openFile(file, { group: this.leaf })` 的行为与类型声明一致，能够把新建 tab 放进当前 leaf 所在的 tab group。
- 假设：即使存在旧的 `previewLeaf`，Alt/Option+点击也只被视为一条临时替代打开路径，不要求同步重置预览 pane 的选中文件状态。

# Verification Steps

## 代码验证

1. 运行 `./node_modules/.bin/tsc --noEmit`，确认类型检查通过。
2. 运行 `npm run lint`，确认无新增 lint 问题。
3. 运行 `npm run build`，确认打包通过。

## 手动验证

1. 打开 Tasks Center，并确保它和其他笔记 tab 同处一个标准 tab pane。
2. 普通点击任意任务条目：
   - 仍应在任务中心相邻的 pane 中打开任务文件。
   - 若当前存在搜索词，仍应保留现有搜索高亮/定位行为。
3. 按住 `Alt/Option` 点击任意任务条目：
   - 应在任务中心所在的同一个 pane 中新建一个 tab 打开该任务文件。
   - 新打开的任务 tab 应成为当前激活 tab。
   - 任务中心 tab 应仍然保留在原 pane 的 tab 栏中，而不是被替换。
4. 在已经打开过相邻 preview pane 的前提下，再执行 `Alt/Option` 点击：
   - 不应破坏之后普通点击仍继续打开到相邻 preview pane 的默认行为。
5. 连续对多个任务执行 `Alt/Option` 点击：
   - 应连续创建多个同 pane tab，不应退化成相邻 pane 打开。

## 回归验证

1. 右键任务条目，确认优先级上下文菜单不受影响。
2. 拖拽任务条目，确认 `dragstart/dragover/drop` 行为不受影响。
3. 搜索结果场景下普通点击任务，确认先前已实现的“source 模式定位关键词”逻辑不回退。
