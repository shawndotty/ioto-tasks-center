# 任务列表 Priority 显示计划

## Summary

目标是在任务列表中增加基于笔记文件 `Priority` 属性的优先级显示能力，并在任务列表设置中新增“是否显示优先级”的开关。

需求明确如下：

- `Priority` 来自任务笔记文件中的 frontmatter 属性 `Priority`
- 属性值为整数，例如 `0`、`1`、`2`、`3`、`4`、`5`
- 在任务列表中显示为 `P0`、`P1`、`P2`、`P3`、`P4` 等优先级标记
- 优先级标记默认出现在“任务状态标记”的前面
- 使用颜色区分：
  - `P0` 红色
  - `P1` 橙色
  - `P2` 蓝色
  - `P3` 绿色
  - `P4` 及以后也使用绿色
- 在任务列表设置中新增“是否显示优先级”开关
- 默认值为“不显示”

已确认的补充决策：

- 没有 `Priority` 属性，或值不是合法整数时，不显示优先级标记
- `P3` 使用绿色

本次不包含：

- 按优先级排序
- 按优先级分组
- 在任务创建流程中自动写入 `Priority`
- 在插件设置页额外暴露同一开关

## Current State Analysis

### 1. 当前任务扫描数据里还没有 Priority 字段

文件：

- `src/tasks-center/data.ts`
- `src/tasks-center/types.ts`

已确认现状：

- `listProjectTaskFiles()` 当前为每个任务文件收集：
  - `name`
  - `basename`
  - `title`
  - `path`
  - `mtime`
  - `ctime`
  - `size`
  - `status`
  - `upTaskTitles`
- `TaskFileEntry` 目前没有优先级字段
- 当前 `data.ts` 已经具备 frontmatter 读取相关能力：
  - 直接从内容中解析 `UpTask`
  - 在读取失败时回退 `metadataCache`

结论：

- 最自然的做法是在 `TaskFileEntry` 中新增可选 `priority` 字段
- 应在任务扫描阶段统一解析 `Priority`，避免把 frontmatter 解析逻辑放到视图层

### 2. 当前任务列表行只显示标题和状态

文件：

- `src/views/iotoTasksCenterView.ts`
- `styles.css`

已确认现状：

- `renderTaskRows()` 当前渲染顺序为：
  - 任务标题 `.ioto-tasks-center__task-title`
  - 状态标记 `.ioto-tasks-center__task-status`
- 没有额外的 metadata badge 容器
- 现有状态 badge 已有一套稳定的 pill 样式和颜色语义

结论：

- 优先级标记最适合复用“badge”式视觉，插在状态标记之前
- 需要为任务行补一个轻量 metadata 区，或直接在标题后连续渲染两个 badge

### 3. 当前任务列表设置只包含排序和分组

文件：

- `src/settings.ts`
- `src/main.ts`
- `src/views/iotoTasksCenterView.ts`

已确认现状：

- 全局 settings 当前包含：
  - `taskListSortMode`
  - `taskListGroupMode`
- 设置菜单 `showTaskPresentationMenu()` 只渲染：
  - 排序项
  - 分组项
- `main.ts` 已有统一设置更新链路：
  - 写入 settings
  - `saveSettings()`
  - `applySettingsToOpenViews()`

结论：

- “是否显示优先级”适合沿用当前任务列表设置持久化方式，新增一个布尔型 settings 字段
- 视图层只负责读取当前开关并决定是否渲染 badge

### 4. 当前测试结构适合补 frontmatter 解析与展示逻辑单测

文件：

- `tests/task-status.test.mjs`
- `tests/task-list-presentation.test.mjs`
- 现有其他 `*.test.mjs`

已确认现状：

- 测试方式以 `jiti` 导入 TypeScript 纯函数为主
- `data.ts` 已经有不少可抽测的 frontmatter 解析辅助函数风格
- 当前没有针对 `IOTOTasksCenterView` 的重型 DOM 集成测试基建

结论：

- 应优先把 `Priority` 解析逻辑抽成纯函数，并为其补单测
- 任务行显示和设置菜单交互以手动验证为主

## Proposed Changes

### 1. 扩展任务数据模型，增加可选 `priority` 字段

文件：

- `src/tasks-center/types.ts`

变更内容：

- 在 `TaskFileEntry` 中新增：
  - `priority?: number`

原因：

- 任务视图、排序/分组模块和后续扩展都需要统一的数据结构承载 Priority

实现要点：

- 保持为可选字段，兼容没有 `Priority` 的旧任务文件

### 2. 在任务扫描阶段统一解析 frontmatter 中的 `Priority`

文件：

- `src/tasks-center/data.ts`

变更内容：

- 新增 `Priority` 解析逻辑，读取来源优先级建议为：
  - 优先从文件内容 frontmatter 解析
  - 读取失败时回退到 `metadataCache.getFileCache(file)?.frontmatter?.Priority`
- 在 `listProjectTaskFiles()` 构造 `TaskFileEntry` 时附带 `priority`

建议新增纯函数：

- `parsePriorityFrontmatterValue(value: unknown): number | undefined`
- `getPriorityFromContent(content: string): number | undefined`
- `resolvePriorityFromSources(options): number | undefined`

解析规则明确为：

- 仅接受整数值
- 可接受内容类型：
  - number 且为整数
  - string 且去空白后可安全解析为整数
- 非法值不展示，例如：
  - 空字符串
  - 小数
  - 非数字文本
  - 数组 / 对象
- 当前不额外限制上下界，因此：
  - `0`、`1`、`2`、`3`、`4`、`5` 都合法
  - 负数是否允许需在执行时明确收敛；建议视为非法并返回 `undefined`

原因：

- 这样可以把“解析责任”固定在数据层
- 视图只消费 `task.priority`

实现要点：

- frontmatter 中 `Priority: 2` 与 `Priority: "2"` 都应能识别
- 若内容读取成功，应尽量以正文 frontmatter 为准，保持与 `UpTask` 解析策略一致
- 若执行阶段需要避免正则重复实现，可复用现有 `extractFrontmatterBody()` 能力

### 3. 在设置模型中新增“是否显示优先级”开关

文件：

- `src/settings.ts`
- `src/main.ts`

变更内容：

- 在 `IOTOTasksCenterSettings` 中新增：
  - `showTaskPriority: boolean`
- 在 `DEFAULT_SETTINGS` 中默认：
  - `showTaskPriority: false`
- 在 `main.ts` 中新增更新方法，例如：
  - `updateShowTaskPriority(show: boolean)`
- 在创建 `IOTOTasksCenterView` 时新增 getter 与更新回调注入

原因：

- 用户要求在任务列表设置中开关显示，并且默认不显示
- 复用现有全局 settings 持久化链路最一致

实现要点：

- 旧设置数据自动回退默认值 `false`
- 命名保持与现有 settings 风格一致

### 4. 扩展任务列表设置菜单，加入“优先级显示”开关

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 在 `showTaskPresentationMenu()` 中，在排序和分组之外新增“优先级显示”设置项
- 建议作为独立段落，例如：
  - 显示优先级
  - 不显示优先级

原因：

- 用户明确要求“在任务列表的设置中加入优先级设置”

实现要点：

- 采用与排序/分组一致的菜单风格
- 当前选择状态应可识别，例如：
  - `优先级：显示（当前）`
  - `优先级：不显示（当前）`
- 点击后调用新的 `updateShowTaskPriority()` 并刷新视图

### 5. 在任务列表行中渲染 Priority 标记

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 在 `renderTaskRows()` 中，位于状态标记之前加入优先级 badge 渲染
- 渲染条件：
  - `showTaskPriority === true`
  - `task.priority` 为合法整数
- 文本格式：
  - `P${task.priority}`

原因：

- 这是用户明确要求的展示位置与格式

实现要点：

- 推荐顺序：
  - 标题
  - Priority badge
  - 状态 badge
- 无合法优先级时，不留空占位
- 组折叠、拖拽、激活态等现有交互不应受影响

### 6. 为 Priority badge 增加颜色映射与样式

文件：

- `styles.css`

变更内容：

- 新增通用类，例如：
  - `.ioto-tasks-center__task-priority`
  - `.ioto-tasks-center__task-priority--p0`
  - `.ioto-tasks-center__task-priority--p1`
  - `.ioto-tasks-center__task-priority--p2`
  - `.ioto-tasks-center__task-priority--p3-plus`
- 颜色规则明确为：
  - `P0` 红色
  - `P1` 橙色
  - `P2` 蓝色
  - `P3` 绿色
  - `P4+` 绿色

原因：

- 需要让 Priority 在视觉上与状态 badge 区分开，同时保持一致的 badge 语言

实现要点：

- 建议沿用现有状态 badge 的 pill 风格：
  - 小号圆角
  - 半透明背景
  - 对应主题色文字
- `P3` 与 `P4+` 可共用同一绿色样式类
- 样式应兼容窄宽度，避免挤压标题导致布局错位

### 7. 适度更新任务列表说明文案

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 当前说明文案已反映排序与分组状态
- 可补充优先级显示状态，例如在开启时追加：
  - `，显示优先级`

原因：

- 让当前列表设置与实际展示保持一致

实现要点：

- 仅在开关开启时追加说明，关闭时保持现有文案简洁

### 8. 补充 Priority 解析相关单测

文件：

- 建议新增 `tests/task-priority.test.mjs`

变更内容：

- 覆盖以下情况：
  - `Priority: 0`、`1`、`2`、`3`、`4`、`5` 正常解析
  - 字符串形式 `"2"` 正常解析
  - 空值 / 空白值返回 `undefined`
  - 小数、负数、非数字文本返回 `undefined`
  - metadata cache 值可作为回退来源
  - 读取内容优先于 metadata cache

原因：

- 这是本次最容易出现边界问题的新逻辑

### 9. 执行阶段进行手动验证

文件：

- 无新增源码文件，仅为执行阶段验证范围

重点检查：

- 打开任务列表设置后，可看到“优先级显示”设置项
- 默认不显示优先级 badge
- 打开后，存在合法 `Priority` 的任务显示 `P0`/`P1`/`P2`/`P3`/`P4...`
- badge 出现在状态标记前面
- 不存在 `Priority` 或值非法的任务不显示 badge
- 分组、折叠、搜索、切换 tab、切换项目后展示正常

## Assumptions & Decisions

- `Priority` 只从笔记 frontmatter 的 `Priority` 属性读取
- 显示文本固定为 `P${priority}`
- 无 `Priority` 或非法值时完全不显示标记
- `P0` 红色，`P1` 橙色，`P2` 蓝色，`P3` 绿色，`P4+` 绿色
- 优先级显示开关保存到插件全局 settings 中，默认关闭
- 优先级 badge 默认位于任务状态 badge 之前
- 本次只增加“是否显示优先级”，不增加“按优先级排序/分组”
- 负数优先级视为非法值，不显示

## Verification Steps

1. 数据解析验证
   - frontmatter 中存在合法整数 `Priority` 时可正确解析
   - 字符串数字可正确解析
   - 小数、负数、空值、非法文本不显示

2. 设置默认值验证
   - 首次安装或旧设置缺失字段时，默认“不显示优先级”

3. 菜单交互验证
   - 任务列表设置菜单中出现“优先级显示”设置
   - 切换显示/隐藏后，列表立即刷新
   - 当前选项在菜单中可识别

4. 列表展示验证
   - 开启后 badge 出现在状态标记前
   - `P0` 红色、`P1` 橙色、`P2` 蓝色、`P3/P4+` 绿色
   - 无合法优先级的任务不显示 badge

5. 兼容性验证
   - 与分组、分组折叠共存
   - 与任务搜索共存
   - 与 tab 筛选共存
   - 与拖拽父任务交互共存

6. 自动化与静态检查
   - 运行 `npm test`
   - 运行 `npm run build`
   - 运行 `npm run lint`
   - 对修改文件执行 diagnostics 检查

## Planned File Touch Points

- `src/tasks-center/types.ts`
- `src/tasks-center/data.ts`
- `src/settings.ts`
- `src/main.ts`
- `src/views/iotoTasksCenterView.ts`
- `styles.css`
- `tests/task-priority.test.mjs`
