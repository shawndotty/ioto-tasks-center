# 任务列表“今天”Tab 计划

## Summary

目标是在任务中心右侧任务列表中新增一个名为“今天”的 tab，并将它放在所有 tab 的第一位。

该 tab 的显示规则为：

- 仅显示“创建日期是今天”的任务文件
- 与当前项目选择联动
- 继续兼容现有搜索功能
- 继续沿用当前任务列表的排序和层级展示逻辑

基于当前代码结构，这项改动可以只在视图层完成，不需要扩展数据模型，因为：

- `TaskFileEntry` 已经包含 `ctime`
- tab 过滤、tab 计数、tab 常量、view state 恢复都集中在 `src/views/iotoTasksCenterView.ts`
- 当前搜索和层级构建都建立在 tab 过滤结果之上

本次计划采用的时间判定规则为：

- 使用任务文件的 `ctime`
- 按本地时间判断是否与“今天”同一天

## Current State Analysis

### 1. 当前任务条目已包含创建时间字段

文件：

- `src/tasks-center/types.ts`
- `src/tasks-center/data.ts`

已确认现状：

- `TaskFileEntry` 中已有 `ctime`
- `listProjectTaskFiles()` 已把 `file.stat.ctime` 写入每个任务条目

结论：

- 新增“今天”筛选不需要修改任务扫描返回结构
- 只需要消费现有 `ctime`

### 2. 当前 tab 逻辑集中在视图层

文件：

- `src/views/iotoTasksCenterView.ts`

已确认现状：

- `TaskFilterTab` 当前只包含：
  - `incomplete`
  - `completed`
  - `all`
- `renderTaskTabs()` 负责渲染 tab UI
- `getTaskFilterCounts()` 负责统计数量
- `matchesTaskFilterTab()` 负责筛选逻辑
- `TASK_FILTER_TABS` 负责 tab 顺序与文案
- `parseViewState()` 和 `isTaskFilterTab()` 负责状态恢复

结论：

- 新增“今天”tab 的主改动点就在这个文件
- 需要同步更新：
  - 类型定义
  - 常量顺序
  - 过滤逻辑
  - 计数逻辑
  - 视图状态恢复

### 3. 当前搜索与层级构建链路天然可复用

文件：

- `src/views/iotoTasksCenterView.ts`

已确认现状：

- `getVisibleTasks()` 是在 `getTasksForActiveTab()` 结果上继续做搜索过滤
- `buildVisibleTaskHierarchy()` 在最终可见任务上构建层级

结论：

- 只要“今天”tab 能正确筛选出今天创建的任务
- 搜索、层级显示、打开预览等现有能力都会自然复用
- 不需要额外改搜索模块或层级模块

### 4. 当前仓库没有现成的“今天日期判断”工具

文件：

- 全仓探索结果

已确认现状：

- 当前没有独立的日期比较工具专门处理“是否为今天”
- 也没有任务列表 tab 的时间筛选抽象模块

结论：

- 这次应在视图文件中新增一个小型纯辅助函数
- 用本地时间比较 `Date` 的年/月/日是否等于今天

## Proposed Changes

### 1. 扩展 `TaskFilterTab`，新增 `today`

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 把 `TaskFilterTab` 从：
  - `incomplete | completed | all`
- 扩展为：
  - `today | incomplete | completed | all`

同时更新：

- `activeTaskFilterTab` 默认值
- `IOTOTasksCenterViewState.activeTaskFilterTab`
- `isTaskFilterTab()`

原因：

- 这是新增 tab 的基础类型入口

实现决策：

- 默认激活 tab 保持现状为 `incomplete`
- 本次只新增“今天”tab，不改变初始打开行为

### 2. 调整 tab 常量顺序，将“今天”放到第一位

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 调整 `TASK_FILTER_TABS` 为：
  - `today`
  - `incomplete`
  - `completed`
  - `all`

原因：

- 用户明确要求“今天”tab 放到第一位

### 3. 在 tab 过滤逻辑中加入“今天”规则

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 扩展 `matchesTaskFilterTab()`
- 当 tab 为 `today` 时，判断 `task.ctime` 是否属于今天

建议新增的小型辅助函数：

- `isTaskCreatedToday(task: TaskFileEntry): boolean`
- `isSameLocalDate(left: Date, right: Date): boolean`

判断规则：

- `new Date(task.ctime)` 与 `new Date()` 比较本地年/月/日

原因：

- 这样可以直接基于当前文件系统时间戳工作
- 不依赖文件名命名规则，也不会只局限于日期任务

### 4. 更新 tab 数量统计

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 扩展 `getTaskFilterCounts()` 返回值
- 增加 `today` 数量

原因：

- 当前 tab UI 固定展示右侧数量
- 新 tab 需要完整接入现有计数展示逻辑

### 5. 保持搜索、层级和空状态链路不变

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 不重构 `getVisibleTasks()` 链路
- 继续保持：
  - 先按 tab 过滤
  - 再按搜索过滤
  - 最后构建层级

原因：

- 当前链路清晰且可复用
- 新需求只是新增一个 tab 过滤条件

补充说明：

- “今天”tab 下如果没有任务：
  - 继续复用现有 tab 空状态文案机制
  - tab 文案会自动显示为“今天”

### 6. 补充回归测试

文件：

- 建议新增：`tests/task-filter-tabs.test.mjs`
- 或扩展现有与视图筛选相关测试文件

建议覆盖：

- `today` tab 会匹配今天创建的任务
- 非今天创建的任务不会出现在 `today` tab
- `today` tab 不改变原始排序顺序
- `today` tab 与搜索叠加时仍然只在“今天任务”范围内搜索
- `isTaskFilterTab('today')` 为真

如不方便直接测试视图实例，可将“今天”筛选逻辑抽成纯函数并单测。

原因：

- 现在 tab 逻辑主要写在视图类里
- 为了避免 UI 测试成本过高，执行阶段推荐把“今天过滤判定”拆成轻量纯函数后做单测

### 7. 最小文档补充

文件：

- `README.md`

变更内容：

- 在任务列表使用说明中补一条：
  - `今天` tab 会显示当前项目中创建日期为今天的任务文件

原因：

- 这个 tab 属于用户可见功能，需要最小同步说明

## Assumptions & Decisions

- “今天”的判定基于文件创建时间 `ctime`，不是文件名中的日期文本
- 时间比较采用本地日期维度比较，不做 UTC 归一化
- 默认进入任务中心后，激活 tab 仍保持当前的 `未完成`
- “今天”tab 只改变筛选范围，不改变排序规则
- 搜索、层级渲染、任务点击打开、拖拽设置 `UpTask` 等功能继续复用现有链路
- 本次不新增设置项，不让用户自定义“今天”的判定规则

## Verification Steps

执行阶段应完成以下验证：

1. 基础验证
   - 打开任务中心
   - 确认任务列表 tab 顺序为：
     - 今天
     - 未完成
     - 已完成
     - 全部

2. 今天筛选验证
   - 准备一个今天创建的任务文件和一个非今天创建的任务文件
   - 切换到“今天”tab
   - 仅显示今天创建的任务文件

3. 数量验证
   - 确认“今天”tab 右侧数量与今天创建任务数一致

4. 联动验证
   - 在“今天”tab 下使用搜索
   - 确认搜索仅作用于今天的任务范围
   - 确认层级显示仍正常

5. 回归验证
   - 未完成 / 已完成 / 全部 tab 行为不变
   - 任务点击打开、拖拽设置父任务、拖拽移除父任务不受影响

6. 自动化验证
   - 运行 `npm test`
   - 运行 `npm run build`
   - 运行 `npm run lint`
   - 对修改文件执行 diagnostics 检查

## Planned File Touch Points

- `src/views/iotoTasksCenterView.ts`
- 可能新增一个轻量视图筛选纯函数模块，若执行阶段认为有必要
- `tests/` 下新增或扩展与 tab 过滤相关测试
- `README.md`

执行阶段如发现视图文件中的 tab 筛选逻辑已经过于集中，优先把“tab 匹配判定”抽成纯函数模块来测试，但不扩大范围到无关 UI 重构。
