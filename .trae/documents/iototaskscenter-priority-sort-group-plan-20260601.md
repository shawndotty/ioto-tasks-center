# 任务列表优先级排序与分组计划

## Summary

目标是在任务列表设置中，新增“按优先级排序”和“按优先级分组”能力。

本次已确认的产品规则：

- 优先级排序提供两个新选项：
  - 优先级（高到低）
  - 优先级（低到高）
- 优先级分组新增一个新选项：
  - 按优先级分组
- 没有 `Priority` 的任务：
  - 排序时排在最后
  - 分组时进入单独的“未设置优先级”组，并排在最后
- 默认设置保持现状不变：
  - 默认排序仍为“创建时间（从新到旧）”
  - 默认分组仍为“不分组”
- 按优先级分组时，分组顺序跟随当前优先级排序方向：
  - 若当前排序为高到低，则分组顺序为 `P0`、`P1`、`P2`...、`未设置优先级`
  - 若当前排序为低到高，则分组顺序为低优先级在前，`未设置优先级`仍在最后

本次不包含：

- 修改优先级 badge 的显示样式
- 新增按优先级显示/隐藏之外的其他优先级设置
- 在任务创建流程中自动写入 `Priority`
- 多级联合排序

## Current State Analysis

### 1. 当前任务数据模型已具备 `priority` 字段

文件：

- `src/tasks-center/types.ts`
- `src/tasks-center/data.ts`

已确认现状：

- `TaskFileEntry` 当前已经包含：
  - `priority?: number`
- `listProjectTaskFiles()` 已在扫描任务文件时解析 `Priority`
- 当前 `Priority` 解析规则已经明确：
  - 只接受非负整数
  - 缺失或非法值返回 `undefined`

结论：

- 本次不需要再改数据层结构
- 可以直接在列表呈现层基于 `task.priority` 扩展排序与分组逻辑

### 2. 当前任务列表排序与分组逻辑都集中在 `task-list-presentation.ts`

文件：

- `src/views/task-list-presentation.ts`

已确认现状：

- `TaskListSortMode` 当前只支持：
  - 创建时间新到旧 / 旧到新
  - 更新时间新到旧 / 旧到新
  - 文件名 A 到 Z / Z 到 A
- `TaskListGroupMode` 当前只支持：
  - `none`
  - `status`
- `buildTaskPresentationSections()` 当前执行顺序为：
  - 先排序
  - 再分组
- `groupTasksForPresentation()` 当前只支持按任务状态分组

结论：

- 新增优先级排序与分组，最佳接入点仍是 `task-list-presentation.ts`
- 当前“先排序再分组”的结构很适合扩展“分组顺序跟随当前优先级排序方向”

### 3. 当前设置菜单和文案已经支持排序 / 分组 / 优先级显示三类配置

文件：

- `src/settings.ts`
- `src/main.ts`
- `src/views/iotoTasksCenterView.ts`

已确认现状：

- 任务列表设置当前已有三段：
  - 排序
  - 分组
  - 优先级显示
- 当前视图说明文案会显示：
  - 当前排序
  - 当前分组
  - 是否显示优先级
- `main.ts` 中已有统一设置更新链路

结论：

- 只需扩展排序 / 分组枚举与菜单项，不需要重新设计设置入口
- 说明文案也应同步支持“按优先级排序 / 分组”的新 label

### 4. 当前测试已经覆盖普通排序 / 分组与 Priority 解析

文件：

- `tests/task-list-presentation.test.mjs`
- `tests/task-priority.test.mjs`

已确认现状：

- `task-list-presentation.test.mjs` 已覆盖：
  - 现有六种排序
  - 不分组
  - 按任务状态分组
  - 组内顺序
- `task-priority.test.mjs` 已覆盖：
  - `Priority` 解析
  - frontmatter 与 metadata 回退

结论：

- 本次最适合扩展 `task-list-presentation.test.mjs`
- 不需要再为 `Priority` 解析单独增加新方向的测试

## Proposed Changes

### 1. 扩展任务列表排序与分组设置枚举

文件：

- `src/settings.ts`

变更内容：

- 扩展 `TaskListSortMode`，新增：
  - `priority-desc`
  - `priority-asc`
- 扩展 `TaskListGroupMode`，新增：
  - `priority`
- 更新 `TASK_LIST_SORT_MODE_OPTIONS`
- 更新 `TASK_LIST_GROUP_MODE_OPTIONS`
- 更新 `isTaskListSortMode()`
- 更新 `isTaskListGroupMode()`

原因：

- 设置菜单、文案、视图和纯逻辑模块都依赖这些枚举作为单一事实来源

实现要点：

- 默认值不变，仍为：
  - `taskListSortMode: 'created-desc'`
  - `taskListGroupMode: 'none'`

### 2. 在纯逻辑模块中增加优先级排序

文件：

- `src/views/task-list-presentation.ts`

变更内容：

- 扩展 `compareTasks()`，新增：
  - `priority-desc`
  - `priority-asc`

排序规则明确为：

- `priority-desc`
  - 更高优先级在前，即 `P0`、`P1`、`P2`...
  - `undefined` 始终排最后
- `priority-asc`
  - 更低优先级在前，即优先级数值更大的在前，或更直观地说“数字小的高优先级在后”
  - `undefined` 仍始终排最后

建议实现方式：

- 新增 `comparePriority(left, right, direction)` 辅助函数
- 对有值和无值分支显式处理，避免 `undefined` 参与普通数值比较
- 当优先级比较相等时，继续使用现有兜底顺序：
  - 文件名
  - 或沿用当前各模式已有的稳定兜底方式

原因：

- 当前所有排序都集中在一个纯函数中，新增优先级排序应保持同样风格

实现要点：

- 无优先级的任务始终排最后，不受排序方向影响
- 同优先级任务要保持稳定顺序，避免列表抖动

### 3. 在纯逻辑模块中增加按优先级分组

文件：

- `src/views/task-list-presentation.ts`

变更内容：

- 扩展 `groupTasksForPresentation()`，支持 `groupMode === 'priority'`
- `buildTaskPresentationSections()` 需要把当前 `sortMode` 传入分组逻辑，供“分组顺序跟随排序方向”使用

建议的数据规则：

- 组 key：
  - `priority-0`
  - `priority-1`
  - `priority-2`
  - ...
  - `priority-unset`
- 组 label：
  - `P0`
  - `P1`
  - `P2`
  - ...
  - `未设置优先级`

分组规则明确为：

- 只对当前可见任务集合分组
- 优先级有值的任务按数值分组
- 没有 `priority` 的任务进入“未设置优先级”组
- “未设置优先级”组始终放在最后
- 其他优先级组的顺序：
  - 若当前排序为 `priority-desc`，则按 `P0`、`P1`、`P2`... 排列
  - 若当前排序为 `priority-asc`，则按反向排列
  - 若当前排序不是优先级排序，则采用默认高到低，即 `P0`、`P1`、`P2`...

原因：

- 用户要求“按优先级分组时，顺序跟随当前优先级排序方向”
- 但当当前排序不是优先级排序时，仍需有一个稳定默认行为

实现要点：

- 分组前仍应先排序，这样每个优先级组内也会遵循当前排序模式
- 当分组模式为 `priority` 且排序并非优先级排序时：
  - 组顺序高到低
  - 组内仍遵循当前排序模式，例如按创建时间

### 4. 扩展设置菜单中的排序与分组选项

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 在排序菜单中加入：
  - 优先级（高到低）
  - 优先级（低到高）
- 在分组菜单中加入：
  - 按优先级分组

原因：

- 用户明确要求“都加入到任务列表的设置中”

实现要点：

- 保持当前菜单结构不变：
  - 排序一段
  - 分组一段
  - 优先级显示一段
- 当前选中项仍用“（当前）”标识

### 5. 更新任务列表说明文案

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 当前文案已根据 `TASK_LIST_SORT_MODE_OPTIONS` 和 `TASK_LIST_GROUP_MODE_OPTIONS` 动态拼接
- 只需确保新增的优先级排序 / 分组 label 会自然反映到文案中

原因：

- 避免“实际按优先级排序 / 分组，但说明文案未更新”的不一致

实现要点：

- 不额外增加新的文案拼装分支，尽量复用已有映射表

### 6. 补充纯逻辑测试

文件：

- `tests/task-list-presentation.test.mjs`

变更内容：

- 新增测试覆盖：
  - `priority-desc` 排序
  - `priority-asc` 排序
  - 无优先级任务始终排最后
  - 按优先级分组时会生成 `P0`、`P1`... 和“未设置优先级”组
  - “未设置优先级”组始终最后
  - 分组顺序在 `priority-desc` / `priority-asc` 下会切换
  - 当分组模式是优先级但排序模式不是优先级时，分组顺序默认高到低
  - 组内任务仍遵循当前排序模式

原因：

- 本次新增逻辑主要集中在纯函数层，适合用现有测试体系直接覆盖

### 7. 执行阶段手动验证视图行为

文件：

- 无新增源码文件，仅为执行阶段验证范围

验证重点：

- 任务列表设置菜单中出现新的排序 / 分组选项
- 默认仍是创建时间排序、不分组
- 选择“优先级（高到低）”后：
  - `P0` 在前
  - 无优先级任务在最后
- 选择“优先级（低到高）”后：
  - 更低优先级任务在前
  - 无优先级任务仍在最后
- 选择“按优先级分组”后：
  - 能显示 `P0`、`P1`... 及“未设置优先级”组
  - 分组顺序跟随当前优先级排序方向
- 与现有：
  - 搜索
  - tab 筛选
  - 分组折叠
  - 优先级 badge 显示开关
  共存正常

## Assumptions & Decisions

- 新增排序选项为：
  - 优先级（高到低）
  - 优先级（低到高）
- 新增分组选项为：
  - 按优先级分组
- 无 `Priority` 的任务：
  - 排序时始终排最后
  - 分组时进入“未设置优先级”组，并且该组始终最后
- 默认设置保持不变
- 当分组模式为优先级且当前排序不是优先级排序时，分组顺序默认高到低
- 分组顺序只跟随“优先级排序方向”，不跟随其他排序模式
- 组内排序始终跟随当前排序模式，不因分组模式改变

## Verification Steps

1. 设置默认值验证
   - 旧配置升级后默认排序和分组保持不变
   - 新增选项只作为额外可选能力出现

2. 排序行为验证
   - 选择“优先级（高到低）”后，`P0` 在前、未设置优先级在最后
   - 选择“优先级（低到高）”后，低优先级组在前、未设置优先级仍在最后

3. 分组行为验证
   - 选择“按优先级分组”后，任务按 `P0`、`P1`... 和“未设置优先级”分组
   - “未设置优先级”组始终最后
   - 分组顺序会根据当前优先级排序方向切换

4. 兼容性验证
   - 与搜索共存
   - 与 tab 筛选共存
   - 与分组折叠共存
   - 与优先级 badge 显示开关共存

5. 自动化与静态检查
   - 运行 `npm test`
   - 运行 `npm run build`
   - 运行 `npm run lint`
   - 对修改文件执行 diagnostics 检查

## Planned File Touch Points

- `src/settings.ts`
- `src/views/task-list-presentation.ts`
- `src/views/iotoTasksCenterView.ts`
- `tests/task-list-presentation.test.mjs`
