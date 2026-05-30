## Summary
- 修复任务列表在某个 tab 下只剩一个任务文件时，点击该文件无法在右侧 pane 打开的 Bug。
- 问题核心在于当前点击短路条件过于宽松，只依据 `openedTaskPath` 和 `previewLeaf` 是否存在来判断“已经打开”，没有确认右侧 pane 当前实际展示的文件是否就是该任务。
- 修复后，任务行只有在右侧 pane 确实打开了对应文件时才会被视为已打开；否则点击应继续触发右侧 pane 打开逻辑。

## Current State Analysis
- `src/views/iotoTasksCenterView.ts`
  - 任务列表行的高亮依赖 `task.path === this.openedTaskPath`。
  - `loadTasks()` 会在每次切换项目/刷新时通过 `getCachedTaskPath()` 恢复 `openedTaskPath`，该值来自 `lastOpenedTaskByProject` 缓存。
  - `openTaskFile()` 当前的短路条件为：
    - `task.path === this.openedTaskPath`
    - `this.previewLeaf` 存在
    - `this.isLeafAvailable(this.previewLeaf)` 为真
  - 这意味着只要缓存路径和当前点击任务相同，并且右侧 leaf 仍存在，就会跳过真正的 `openFile()`，即使该 leaf 当前实际展示的文件不是这一个。
- 结合 `activeTaskFilterTab` 的筛选后，当某个 tab 下只剩一个任务文件，而它又恰好命中缓存的 `openedTaskPath` 时：
  - 列表会把该任务渲染为 `is-active`
  - 点击时又会命中 `openTaskFile()` 的提前返回
  - 最终表现为“点击唯一任务没有在右侧 pane 打开”
- 当前仓库没有专门针对视图点击短路逻辑的测试文件，现有测试集中在：
  - `tests/task-status.test.mjs`
  - `tests/project-sort.test.mjs`
  - `tests/task-creation.test.mjs`
  - `tests/project-creation.test.mjs`
- 因此这次修复若想补回归测试，最合适的方式是抽一个纯函数/轻量 helper 来判断“是否真的已经在 preview pane 打开目标文件”，避免直接 mock 整个 Obsidian 视图层。

## Proposed Changes
### 1. `src/views/iotoTasksCenterView.ts`
- 收紧任务点击的短路条件，不再只凭 `openedTaskPath` 和 leaf 是否存在决定跳过打开。
- 新增一个基于右侧 pane 实际视图状态的判断流程，例如：
  - 从 `previewLeaf.view` 读取当前打开文件
  - 仅当该 view 是 `FileView`，且 `view.file?.path === task.path` 时，才认为“已经打开，无需重复打开”
- 对应调整任务行的激活态来源：
  - 继续保留 `openedTaskPath` 作为状态来源，或进一步让它与 preview pane 的真实文件保持同步
  - 关键是避免“视觉上显示已激活，但实际右侧没有打开对应文件”的状态漂移
- 目标结果：
  - 即使 tab 下只有一个任务文件，只要右侧 pane 当前不是该文件，点击仍会触发 `openFileInPreview()`
  - 若右侧 pane 当前确实已经打开同一个文件，则点击才安全 no-op

### 2. 抽离一个可测试的判断 helper
- 为了给这个回归 Bug 补自动化测试，建议抽一个小型纯逻辑 helper，例如放到：
  - `src/views/task-preview-state.ts`
  - 或 `src/tasks-center/task-preview-state.ts`
- 该 helper 只负责回答一个问题：
  - “当前是否可以跳过重新打开任务文件？”
- 输入可设计为纯数据，而不是直接依赖真实 `WorkspaceLeaf` 实例，例如：
  - `targetTaskPath`
  - `openedTaskPath`
  - `previewLeafAvailable`
  - `previewedFilePath`
- 输出为布尔值，供 `openTaskFile()` 使用。
- 这样可以在不引入复杂 Obsidian mock 的前提下，为这次 bug 增加回归测试。

### 3. 新增测试
- 新增测试文件，例如 `tests/task-preview-state.test.mjs`
- 覆盖以下回归场景：
  - 当 `openedTaskPath` 命中，但 `previewedFilePath` 为空或不同于目标任务时，不应跳过打开
  - 当 `openedTaskPath` 命中，且 `previewedFilePath` 与目标任务一致时，才允许跳过打开
  - 当 preview leaf 不可用时，不应跳过打开
- 保持测试聚焦在“点击短路条件”本身，不对整个 `ItemView` 做高成本 mock

### 4. 验证与兼容性
- 修复后需确认不影响已有的右侧 pane 复用逻辑：
  - 同一文件已在右侧 pane 打开时，不重复触发无意义的打开
  - 右侧 pane 已存在但当前文件不同，点击新任务时仍能正常切换
- 确认切换 tab、刷新项目、以及从缓存恢复 `openedTaskPath` 时不会再造成“假激活”

## Assumptions & Decisions
- 本次只修复“点击唯一可见任务无法打开”的问题，不调整 tab 筛选规则、不改任务排序逻辑。
- 右侧 pane 是否“已打开目标任务”的判断，以 preview leaf 当前真实 `FileView.file?.path` 为准，而不是仅靠缓存路径。
- 若缓存的 `openedTaskPath` 与 preview pane 实际文件不一致，应优先信任 preview pane 的真实状态。
- 本次优先采用“抽小 helper + 单测”的方式补回归覆盖，不引入完整视图层集成测试。

## Verification Steps
- 代码层
  - 确认 `openTaskFile()` 的短路逻辑已经依赖 preview pane 的真实文件路径，而不只是缓存路径。
  - 确认任务行激活态不会再因为过期 `openedTaskPath` 造成假高亮。
- 自动化验证
  - 新增对应回归测试
  - 运行 `npm test`
  - 运行 `npm run build`
  - 运行 `npm run lint`
  - 对新增/修改文件执行 diagnostics 检查
- 手动验证
  - 在某个项目下切到一个只剩 1 个任务文件的 tab
  - 点击该唯一任务，确认右侧 pane 能正常打开
  - 让右侧 pane 先打开别的文件，再点击该唯一任务，确认仍会切换为正确文件
  - 当右侧 pane 已经打开该任务文件时，再点击该任务，确认不会异常重复打开或创建新 pane
