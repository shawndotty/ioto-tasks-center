# 任务列表右键设置 Priority 计划

## Summary

- 在任务中心右侧任务列表的每个任务项上增加右键菜单。
- 右键菜单支持为当前任务直接设置 `P0` 到 `P9`，并将对应值写入任务笔记 frontmatter 的 `Priority` 属性。
- 如果任务已设置优先级，右键菜单最上方显示“取消优先级”，执行后移除 `Priority` 属性。
- 设置或取消后立即刷新当前任务列表，使优先级徽标、排序和分组结果同步更新。

## Current State Analysis

### 任务列表 UI

- 任务项渲染位于 [iotoTasksCenterView.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts) 的 `renderTaskRows()`，当前每个任务行是一个 `button.ioto-tasks-center__task-row`，已绑定左键打开、拖拽开始/经过/放下等事件。
- 当前视图文件已经使用 Obsidian `Menu` 组件实现了多个菜单，如 `showTaskCreationMenu()`、`showProjectSwitcherMenu()`、`showTaskPresentationMenu()`，因此右键优先级菜单可以沿用同一交互模式。
- 任务行已经能显示 Priority badge，逻辑在 `renderTaskRows()` 中，依赖 `task.priority` 和 `getTaskPriorityClassName()`。

### Priority 数据链路

- 任务列表数据来自 [data.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/data.ts) 的 `listProjectTaskFiles()`。
- `Priority` 当前只读不写：`getTaskFilePriority()` 会从正文 frontmatter 或 metadata cache 解析 `Priority`，解析函数为 `parsePriorityFrontmatterValue()` / `resolvePriorityFromSources()`。
- 当前只接受非负整数，因此 `P0` 到 `P9` 完全兼容现有读取逻辑，无需改变读取规则。

### frontmatter 写回能力

- 仓库当前对 `Project` / `Plan` / `Subject` 的写回主要通过 [task-creation.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-creation.ts) 中的字符串级 frontmatter 处理函数完成。
- 已确认 Obsidian 类型中提供 `app.fileManager.processFrontMatter(file, fn)`，适合本需求直接、稳定地新增 / 更新 / 删除单个 `Priority` 属性。
- 当前没有现成的“更新 Priority”业务函数，也没有任务项右键菜单。

### 国际化现状

- 语言包在 [en.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts) / [zh-cn.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts) / `zh-tw.ts` 中维护。
- 现有语言 key 仅覆盖“显示优先级”设置，不覆盖“设置 Priority / 取消 Priority / 更新失败”等右键菜单文案。

## Proposed Changes

### 1. 新增 Priority frontmatter 写回模块

**文件**: `src/tasks-center/task-priority.ts`（新文件）

- 新增专用业务模块，避免把 Priority 写回逻辑继续堆在 `iotoTasksCenterView.ts` 或 `task-creation.ts` 中。
- 提供如下 API：
  - `const TASK_PRIORITY_VALUES = [0,1,2,3] as const`
  - `export type TaskPriorityValue = (typeof TASK_PRIORITY_VALUES)[number]`
  - `export function isTaskPriorityValue(value: number): value is TaskPriorityValue`
  - `export async function setTaskFilePriority(app: App, file: TFile, priority: TaskPriorityValue): Promise<void>`
  - `export async function clearTaskFilePriority(app: App, file: TFile): Promise<void>`
- 实现方式：
  - 使用 `app.fileManager.processFrontMatter(file, fn)`；
  - 设置时写入 `frontmatter.Priority = priority`；
  - 取消时删除 `Priority` 键，使用 `delete frontmatter.Priority`；
  - 不改动其他 frontmatter 字段。
- 这里不复用 `upsertListProperty`，因为 `Priority` 是标量数值属性，不是列表属性，且 `processFrontMatter` 更稳妥。

### 2. 在任务列表项上增加右键优先级菜单

**文件**: `src/views/iotoTasksCenterView.ts`

- 在 `renderTaskRows()` 为每个任务行增加 `contextmenu` 监听：
  - `event.preventDefault()`
  - 调用新的 `showTaskPriorityMenu(event, task)`。
- 新增 `private showTaskPriorityMenu(event: MouseEvent, task: TaskFileEntry): void`
  - 使用 `new Menu()`
  - 若 `task.priority !== undefined`，菜单最上方加入“取消优先级”
  - 之后依次加入 `P0` 到 `P9`
  - 当前优先级项标题可复用现有“当前项后缀”模式，显示 `（当前）` / `(current)`
- 新增 `private async updateTaskPriority(task: TaskFileEntry, priority: TaskPriorityValue): Promise<void>`
  - 通过 `task.path` 找到 `TFile`
  - 调用 `setTaskFilePriority(...)`
  - 成功后刷新当前项目任务列表
  - 保持当前已选项目、当前筛选、当前搜索、当前打开任务不丢失
- 新增 `private async clearTaskPriority(task: TaskFileEntry): Promise<void>`
  - 调用 `clearTaskFilePriority(...)`
  - 成功后刷新当前项目任务列表
- 错误处理：
  - 任务文件不存在时提示用户
  - 写回失败时显示 Notice
  - 复用当前视图中已有的 `try/catch + Notice` 模式
- 刷新策略：
  - 采用现有 `loadTasks(this.selectedProject)` / `refreshFromVaultChange()` 路径，确保：
    - Priority badge 立即更新
    - 按优先级排序结果立即更新
    - 按优先级分组结果立即更新
  - 不新增单独的内存 patch 逻辑，避免与已有刷新链路分叉。

### 3. 补充国际化文案

**文件**:
- `src/lang/locale/en.ts`
- `src/lang/locale/zh-cn.ts`
- `src/lang/locale/zh-tw.ts`

- 新增菜单与提示所需 key，建议包含：
  - `view.taskPriorityMenu.clear`
  - `view.taskPriorityMenu.set`
  - `view.taskPriorityMenu.currentSuffix`
  - `view.notice.taskFileUnavailable`
  - `view.notice.updateTaskPriorityFailed`
  - `view.notice.clearTaskPriorityFailed`
- 文案约束：
  - “取消优先级”置顶
  - `P0` 到 `P9` 直接作为菜单项标题主体
  - 若需要类别标题，可沿用当前 view/menu 文案风格，但本次不额外增加复杂分组，保持菜单简洁。

### 4. 为 Priority 写回补充测试

**文件**:
- `tests/task-priority.test.mjs`
- 如视图层提炼出纯函数，可按需要新增 `tests/task-priority-menu.test.mjs`；否则不新增视图 UI 测试

- 在 `task-priority.test.mjs` 增加针对新业务模块的单元测试：
  - 设置 `Priority` 时会创建该属性
  - 已有 `Priority` 时可改为另一个值
  - 取消优先级时会移除 `Priority`
  - 不影响其他 frontmatter 字段
- 对 `processFrontMatter` 使用最小 mock app/fileManager 即可，不需要跑真实 Obsidian UI。
- 不计划新增端到端菜单测试，因为当前测试体系以纯逻辑/业务函数为主；本次把可回归风险集中在写回逻辑即可。

## Assumptions & Decisions

- “右键设置面板”按现有代码语境实现为 Obsidian `Menu` 右键菜单。
- 用户消息里的“邮件面板”按上下文理解为“右键菜单面板”，计划按“取消优先级放在菜单最上方”实现。
- 本次 Priority 可选范围固定为 `0` 到 `9`，不提供自由输入。
- 若当前任务没有优先级，则不显示“取消优先级”菜单项。
- 写回时仅操作 frontmatter `Priority`，不新增正文标记，不修改文件名。
- 本次不新增设置项开关；功能默认对所有任务列表项启用。
- 任务行本身仍保留现有左键打开、拖拽排序/父任务分配行为；右键仅新增菜单，不改变已有左键/拖拽交互。

## Verification Steps

- 单元测试：
  - 运行 `node --test tests/task-priority.test.mjs`
- 代码质量：
  - 运行 `npm run lint`
  - 运行 `npm run build`
- 手动回归：
  - 在任务列表中右键一个未设置优先级的任务，选择 `P3`，确认对应文件新增 `Priority: 3`
  - 再次右键同一任务，确认菜单最上方出现“取消优先级”
  - 选择 `P1`，确认 `Priority` 从 `3` 更新为 `1`
  - 选择“取消优先级”，确认 `Priority` 属性被移除
  - 在“显示优先级”开启时确认 badge 立即更新
  - 在“按优先级排序 / 分组”模式下确认列表顺序和分组立即更新
