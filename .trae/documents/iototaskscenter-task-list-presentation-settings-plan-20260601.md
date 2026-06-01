# 任务列表呈现方式设置计划

## Summary

目标是在任务中心右侧“任务列表”区域的 tab 栏最右侧新增一个使用 `Slider` 图标表示的设置按钮。点击按钮后，弹出一个轻量下拉菜单，让用户可以配置当前任务列表的呈现方式。

本次先支持两类呈现配置：

- 排序
  - 创建时间（从新到旧）
  - 创建时间（从旧到新）
  - 更新时间（从新到旧）
  - 更新时间（从旧到新）
  - 文件名（A 到 Z）
  - 文件名（Z 到 A）
- 分组
  - 不分组
  - 按任务状态分组

已确认决策：

- 交互形式使用“下拉菜单”
- 设置结果“全局记住”，保存到插件设置中
- 默认排序为“创建时间（从新到旧）”
- 默认分组为“不分组”

本次不包含：

- 自定义分组规则
- 拖拽改变分组
- 多级排序
- 在插件设置页额外暴露同一组选项

## Current State Analysis

### 1. 任务列表 tab 与任务区渲染都集中在视图类中

文件：

- `src/views/iotoTasksCenterView.ts`

已确认现状：

- 任务区顶部依次渲染：
  - 标题与“添加任务”按钮
  - 当前项目说明文案
  - 搜索框
  - tab 栏
  - 任务列表
- tab 栏由 `renderTaskTabs()` 负责，当前只渲染四个状态筛选 tab：
  - `today`
  - `incomplete`
  - `completed`
  - `all`
- 当前任务列表的可见数据链路为：
  - `this.tasks`
  - `getTasksForActiveTab()`
  - `filterTasksBySearchQuery()`
  - `buildVisibleTaskHierarchy()`
  - 列表渲染

结论：

- 设置按钮最适合接入 `renderTaskTabs()`，并与现有 tab 保持同一行布局
- 排序与分组应接入 `getVisibleTasks()` 之后、最终渲染之前的数据整形阶段

### 2. 任务原始数据已经具备本次排序与分组所需字段

文件：

- `src/tasks-center/types.ts`
- `src/tasks-center/data.ts`

已确认现状：

- `TaskFileEntry` 当前包含：
  - `basename`
  - `title`
  - `ctime`
  - `mtime`
  - `status`
  - `path`
- `listProjectTaskFiles()` 当前在读取一级 Markdown 文件后，会先按“最近更新时间倒序”排序，再以 `basename` 兜底
- `status.key` 当前稳定为：
  - `todo`
  - `in-progress`
  - `completed`
  - `empty`

结论：

- 不需要扩展任务扫描数据结构
- 需要把“任务列表默认按最近修改时间”调整为“数据原始顺序不承载最终展示排序”，由新的呈现逻辑统一决定最终顺序
- “按任务状态分组”可以直接使用 `status.key` / `status.label`

### 3. 当前插件设置仅覆盖项目列表相关选项，没有任务列表呈现设置

文件：

- `src/settings.ts`
- `src/main.ts`

已确认现状：

- `IOTOTasksCenterSettings` 当前只包含：
  - `tasksRootPath`
  - `projectListSortMode`
  - `hiddenProjectNames`
  - `taskTemplateConfigs`
  - `dateTaskDateFormat`
- `main.ts` 通过 getter 将设置传给 `IOTOTasksCenterView`
- 已存在统一的设置更新链路：
  - 更新 settings
  - `saveSettings()`
  - `applySettingsToOpenViews()`
  - 视图执行 `handleSettingsChange()`

结论：

- 本次适合沿用现有设置保存模式，把任务列表排序/分组持久化到插件级 settings
- 视图无需自行决定持久化方案，只需通过 getter 读取当前设置，并在用户点击菜单项后调用新的更新方法

### 4. 现有样式已经为“tab 行 + 操作区”提供了基础，但未包含图标按钮与分组标题

文件：

- `styles.css`

已确认现状：

- 已有与本次直接相关的样式块：
  - `.ioto-tasks-center__section-actions`
  - `.ioto-tasks-center__tabs`
  - `.ioto-tasks-center__tab`
  - `.ioto-tasks-center__task-list`
  - `.ioto-tasks-center__task-row`
- 当前 `.ioto-tasks-center__tabs` 是可换行的 flex 容器
- 没有“tab 栏右侧图标按钮”样式
- 没有“任务分组标题”样式

结论：

- 需要补充 tab 设置按钮样式，保证其在同一行最右侧对齐
- 需要补充分组标题与分组容器样式，且不破坏现有任务行 hover/active/drag 样式

### 5. 当前测试模式更偏向纯逻辑函数，不适合直接堆 UI 集成测试

文件：

- `tests/task-filter-tabs.test.mjs`
- `tests/task-search.test.mjs`

已确认现状：

- 现有测试主要通过 `jiti` 直接导入 TypeScript 纯函数模块
- 已有 `task-filter-tabs.ts`、`task-search.ts` 这样的视图辅助模块
- 目前没有针对 `IOTOTasksCenterView` DOM 交互的集成测试基建

结论：

- 本次应优先把排序/分组的核心逻辑抽成纯函数模块，并通过单测覆盖
- 菜单按钮与视图 wiring 以手动验证为主

## Proposed Changes

### 1. 在设置模型中新增任务列表呈现配置

文件：

- `src/settings.ts`
- `src/main.ts`

变更内容：

- 在 `src/settings.ts` 新增任务列表排序与分组的类型定义，例如：
  - `TaskListSortMode`
  - `TaskListGroupMode`
- 在 `IOTOTasksCenterSettings` 中新增：
  - `taskListSortMode`
  - `taskListGroupMode`
- 在 `DEFAULT_SETTINGS` 中设置默认值：
  - `taskListSortMode: 'created-desc'`
  - `taskListGroupMode: 'none'`
- 导出排序/分组选项文案映射，供视图菜单复用
- 在 `src/main.ts` 中新增更新方法，例如：
  - `updateTaskListSortMode()`
  - `updateTaskListGroupMode()`
- 在注册视图时，把新的 getter 传入 `IOTOTasksCenterView`

原因：

- 用户已明确要求“全局记住”
- 复用当前插件已有的设置更新链路，可以保持实现一致性并减少额外状态分叉

实现要点：

- 为旧数据做兼容：`loadSettings()` 时缺失字段自动回退到默认值
- 类型命名与已有 `ProjectListSortMode` 保持一致的风格

### 2. 抽出任务列表呈现纯逻辑模块，统一处理排序与分组

文件：

- 建议新增 `src/views/task-list-presentation.ts`
- 可能同时新增或复用对应测试文件

变更内容：

- 新增纯函数模块，封装：
  - 任务排序
  - 任务分组
  - 分组顺序定义
- 建议导出函数：
  - `sortTasksForPresentation(tasks, sortMode)`
  - `groupTasksForPresentation(tasks, groupMode)`
  - `buildTaskPresentationSections(tasks, options)`

建议的数据结构：

- 输出为“可直接渲染的 section 数组”，每个 section 包含：
  - `key`
  - `label`
  - `tasks`

排序规则明确为：

- `created-desc`：`ctime` 从大到小，`basename` 作为兜底
- `created-asc`：`ctime` 从小到大，`basename` 作为兜底
- `updated-desc`：`mtime` 从大到小，`basename` 作为兜底
- `updated-asc`：`mtime` 从小到大，`basename` 作为兜底
- `name-asc`：按 `basename.localeCompare(..., 'zh-Hans-CN')`
- `name-desc`：名称倒序

分组规则明确为：

- `none`：输出单个 section，不显示分组标题
- `status`：按以下顺序输出非空分组：
  - `todo` / `待开始`
  - `in-progress` / `进行中`
  - `completed` / `已完成`
  - `empty` / `无任务项`

原因：

- 排序和分组的复杂度已经高于简单内联判断，抽纯函数最利于复用和测试
- 也能避免把 `IOTOTasksCenterView` 继续堆大

实现要点：

- 排序必须在分组前完成，保证每个分组内也遵循当前排序规则
- 分组只处理“当前可见任务”，即 tab 与搜索过滤后的结果
- 不要原地修改输入数组，避免影响拖拽、刷新和其他逻辑

### 3. 在任务列表 tab 栏最右侧加入 Slider 图标设置按钮

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 改造 `renderTaskTabs()` 的 DOM 结构，使其包含：
  - 左侧 tab 按钮区
  - 右侧设置按钮区
- 新增一个图标按钮，使用 `Slider` 图标
- 点击按钮时弹出 `Menu`

菜单内容建议分为两段：

- 排序
  - 创建时间（从新到旧）
  - 创建时间（从旧到新）
  - 更新时间（从新到旧）
  - 更新时间（从旧到新）
  - 文件名（A 到 Z）
  - 文件名（Z 到 A）
- 分组
  - 不分组
  - 按任务状态分组

原因：

- 这是用户明确要求的入口位置和交互方式
- 现有文件中已经使用 `Menu` 实现“添加任务”菜单，风格上可以保持一致

实现要点：

- 优先复用 Obsidian 图标 API，例如 `setIcon()` 或等价方式，为按钮设置 `sliders-horizontal` / 对应 Slider 图标名；执行阶段以 Obsidian 当前可用图标名为准
- 按钮应具备明确的 `aria-label` / `title`，例如“任务列表呈现设置”
- 菜单项点击后直接调用 `main.ts` 中新增的更新方法，并触发视图刷新
- 当前选中的排序/分组选项应在菜单中有可识别状态；执行阶段可根据 `MenuItem` 能力选择勾选、标题追加“当前”或等效视觉提示

### 4. 让任务列表渲染链路接入新的排序与分组 section

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 新增从设置读取任务列表呈现方式的能力，例如：
  - `getTaskListSortMode`
  - `getTaskListGroupMode`
- 在现有 `getVisibleTasks()` 结果基础上，新增“呈现 section”计算层
- 当前渲染流程从：
  - `visibleTasks -> buildVisibleTaskHierarchy() -> 逐项渲染`
  改为：
  - `visibleTasks -> buildTaskPresentationSections() -> section 内 buildVisibleTaskHierarchy() -> 逐组渲染`

原因：

- 这样可以把“tab 过滤/搜索过滤”和“最终呈现方式”分层处理，职责清晰

实现要点：

- `getVisibleTasks()` 继续只负责“筛选”，不负责最终排序与分组
- 当 `groupMode === 'none'` 时，不渲染分组标题，保持列表视觉尽量接近当前样式
- 当 `groupMode === 'status'` 时，为每个 section 先渲染标题，再渲染该组任务
- 为避免破坏现有父子任务展示，应在“每个分组内部”执行 `buildVisibleTaskHierarchy()`
- 需要注意父子任务跨状态时的展示边界：
  - 本次按“当前分组只显示属于该状态的任务”处理
  - 不跨组补齐父任务或子任务
  - 这是最可预测、也最容易解释的规则

### 5. 更新任务列表说明文案，使其反映当前排序/分组状态

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 当前说明文案固定写着“按最近修改时间排序”
- 需要改为根据真实设置动态显示，例如：
  - `当前项目：xxx，共 N 个文件，按创建时间从新到旧排序`
  - 若启用分组，可补充为：
    - `当前项目：xxx，共 N 个文件，按创建时间从新到旧排序，按任务状态分组`

原因：

- 否则文案会与实际展示不一致

实现要点：

- 文案映射应与菜单选项共用同一套 label 常量，避免维护两份文本

### 6. 为新按钮、tab 布局和分组标题补充样式

文件：

- `styles.css`

变更内容：

- 为 tab 栏拆分布局，例如新增：
  - `.ioto-tasks-center__tabs-bar`
  - `.ioto-tasks-center__tabs-list`
  - `.ioto-tasks-center__tabs-settings`
- 为设置图标按钮新增样式，例如：
  - `.ioto-tasks-center__tab-settings-button`
- 为分组标题与分组块新增样式，例如：
  - `.ioto-tasks-center__task-group`
  - `.ioto-tasks-center__task-group-title`

原因：

- 需要确保“最右侧按钮”在视觉和布局上稳定存在
- 分组标题需要与任务项形成明确层次，但不能压过任务内容

实现要点：

- 保持与现有按钮、tab 的圆角、边框、hover 风格一致
- 按钮在窄宽度下也应保持可点击，不要被 tab 挤压到换行后失真
- 分组标题建议使用较轻背景或较弱文字色，体现辅助层级

### 7. 补充纯逻辑测试，覆盖排序与分组核心行为

文件：

- 建议新增 `tests/task-list-presentation.test.mjs`

变更内容：

- 以纯函数测试为主，覆盖：
  - 默认排序为创建时间从新到旧
  - 六种排序模式分别生效
  - 文件名排序在中文/英文场景下稳定
  - 分组关闭时只返回单个 section
  - 按状态分组时按既定顺序输出非空组
  - 分组前先排序，组内顺序正确
  - 输入数组不被原地修改

原因：

- 这是本次最容易引入回归的逻辑部分
- 当前仓库已有同类测试模式，接入成本低

### 8. 执行阶段以手动验证补足菜单交互与视图联动

文件：

- 无新增源码文件，仅为执行阶段验证范围

验证重点：

- 点击 tab 栏最右侧 Slider 图标可正常弹出菜单
- 切换排序后，当前项目任务列表立即按新规则重排
- 切换分组后，当前项目任务列表立即以新方式展示
- 关闭并重新打开任务中心后，排序/分组设置被正确保留
- 切换项目、搜索关键词、切换 tab 后，新的排序/分组仍持续生效

## Assumptions & Decisions

- 设置按钮位于任务状态 tab 栏最右侧，不额外放到任务列表标题栏
- 设置结果保存到插件全局 settings，而不是仅保存在单个视图 state
- 排序与分组作用于“当前项目 + 当前 tab + 当前搜索结果”的任务集合
- 默认排序固定为“创建时间（从新到旧）”
- 默认分组固定为“不分组”
- 按状态分组时，分组顺序固定为：
  - 待开始
  - 进行中
  - 已完成
  - 无任务项
- 分组标题仅在 `status` 分组模式下显示；`none` 模式不显示额外标题
- 跨组父子任务不做补齐展示，避免引入超出本次需求的数据联动复杂度
- 本次不在插件设置页新增同名下拉项，入口以任务列表右上角按钮为主

## Verification Steps

1. 设置默认值验证
   - 首次安装或旧设置缺失新字段时，任务列表默认按“创建时间（从新到旧）”显示
   - 默认不分组

2. 菜单交互验证
   - tab 栏最右侧显示 Slider 图标按钮
   - 点击按钮可弹出排序/分组菜单
   - 当前选项在菜单中可识别

3. 排序行为验证
   - 六种排序模式都能立即生效
   - 同时间戳任务使用文件名稳定兜底
   - 搜索结果与 tab 过滤结果在排序切换后顺序正确

4. 分组行为验证
   - 不分组时保持单列表
   - 按任务状态分组时，分组标题和任务内容正确对应
   - 仅有任务的状态组会显示

5. 状态持久化验证
   - 修改排序/分组后关闭并重新打开任务中心
   - 确认设置已被记住
   - 重启 Obsidian 后再次打开，确认设置仍存在

6. 兼容性验证
   - 与现有“今天 / 未完成 / 已完成 / 全部” tab 共存
   - 与任务搜索共存
   - 与子任务层级显示共存
   - 与拖拽父任务逻辑共存，至少不出现明显渲染异常

7. 自动化与静态检查
   - 运行 `npm test`
   - 运行 `npm run build`
   - 运行 `npm run lint`
   - 对修改文件执行 diagnostics 检查

## Planned File Touch Points

- `src/settings.ts`
- `src/main.ts`
- `src/views/iotoTasksCenterView.ts`
- `src/views/task-list-presentation.ts`
- `styles.css`
- `tests/task-list-presentation.test.mjs`
