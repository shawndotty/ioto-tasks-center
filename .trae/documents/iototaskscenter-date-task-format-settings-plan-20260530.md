# 日期型任务日期格式配置化计划

## Summary

目标是让“日期型任务”的日期命名格式不再写死，而是由用户在插件设置中自行配置。

基于当前仓库检查结果，这项能力实际上已经落地在当前工作区中，覆盖了：

- 设置模型与设置页输入项
- 插件主入口的设置加载、归一化与视图同步
- 日期任务文件名生成逻辑
- 轻量日期格式解析/格式化模块
- 单元测试回归

因此，后续执行阶段的重点不是重新设计，而是：

1. 保持现有实现方案
2. 若发现与计划不一致的细节再做最小修正
3. 运行验证并完成最终交付说明

## Current State Analysis

### 已确认的现状

- `src/settings.ts`
  - `IOTOTasksCenterSettings` 已新增 `dateTaskDateFormat`
  - `DEFAULT_SETTINGS` 已提供默认值 `YYYY-MM-DD`
  - 设置页已新增“日期任务日期格式”输入框
  - 文案已说明支持 Moment/Day.js 风格格式，且无效输入会回退默认值

- `src/main.ts`
  - `loadSettings()` 已对 `dateTaskDateFormat` 做归一化
  - 已存在 `updateDateTaskDateFormat(format: string)` 用于保存设置并刷新打开中的视图
  - 任务中心视图构造时，已把当前日期格式设置通过 getter 传入

- `src/tasks-center/task-creation.ts`
  - `CreateTaskFileOptions` 已新增 `dateTaskDateFormat`
  - `buildTaskFileName()` 在 `type === 'date'` 时已改为按配置格式生成文件名
  - `resolveValidDateTaskDateFormat()` 已统一复用日期格式归一化逻辑

- `src/tasks-center/date-task-format.ts`
  - 已抽出纯逻辑模块，避免 UI 设置模块与 Node 测试环境耦合
  - 当前支持的 token 为：
    - `YYYY`
    - `YY`
    - `MM`
    - `M`
    - `DD`
    - `D`
  - 空白或非法格式会回退到 `YYYY-MM-DD`

- `tests/task-creation.test.mjs`
  - 已覆盖默认日期格式
  - 已覆盖自定义日期格式
  - 已覆盖空白格式回退
  - 已覆盖无效格式回退

### 当前方案的技术结论

- 不直接依赖 `moment` npm 包
  - 原因：现有 lint 规则限制、项目未声明该依赖

- 不依赖 `obsidian` runtime 导出的 `moment`
  - 原因：Node 单测环境下不可稳定直接调用

- 最终采用本地轻量格式模块
  - 优点：纯函数、可测试、无运行时外部依赖、满足本需求的常用格式场景

## Proposed Changes

### 1. 设置层保持当前方案

文件：

- `src/settings.ts`

执行内容：

- 保留 `dateTaskDateFormat` 设置项
- 保留默认值 `YYYY-MM-DD`
- 保留设置页输入框及说明文案

原因：

- 该层已经满足“用户可在设置中自行设置日期格式”的核心需求
- 现有交互与插件其余设置项风格一致

实现要点：

- 输入框展示当前保存值
- 用户修改后调用 `updateDateTaskDateFormat`
- 设置展示始终回显归一化后的有效格式

### 2. 主入口继续负责归一化与分发

文件：

- `src/main.ts`

执行内容：

- 保留 `loadSettings()` 中对 `dateTaskDateFormat` 的归一化
- 保留 `updateDateTaskDateFormat()` 的持久化与视图刷新逻辑
- 保留向 `IOTOTasksCenterView` 传递 `getDateTaskDateFormat` getter

原因：

- 该层是插件设置状态的唯一可信来源
- 可确保插件重启后配置仍生效
- 可确保已打开视图拿到最新设置值

实现要点：

- 保存前统一归一化
- 新旧值相同则不重复保存
- 设置变化后对打开中的任务中心视图执行刷新

### 3. 任务创建链路继续读取设置值生成日期文件名

文件：

- `src/views/iotoTasksCenterView.ts`
- `src/tasks-center/task-creation.ts`

执行内容：

- 保留视图层在创建任务时把 `dateTaskDateFormat` 传入创建参数
- 保留 `buildTaskFileName()` 对日期任务的动态格式化命名

原因：

- 文件命名行为属于任务创建链路，必须在真正创建文件前完成
- 视图层只负责传递当前设置，命名规则集中在任务创建模块更清晰

实现要点：

- 日期任务命名规则为：`项目名-格式化日期.md`
- 非日期任务继续保持现有命名规则不变
- 若传入格式为空白或非法，统一回退默认格式再生成文件名

### 4. 继续使用纯日期格式模块，不引入外部依赖

文件：

- `src/tasks-center/date-task-format.ts`

执行内容：

- 保留现有轻量格式解析与格式化实现
- 保持支持的 token 集为当前已实现集合

原因：

- 这是当前最稳妥且已验证可用的方案
- 可规避 Obsidian runtime 与 Node 测试环境差异
- 本需求并不要求完整 Moment 语法兼容

实现要点：

- 合法 token：`YYYY`、`YY`、`MM`、`M`、`DD`、`D`
- 非 token 的普通分隔字符允许原样输出
- 包含非法字母 token 或中括号等不支持语法时回退默认值

### 5. 保留并补足测试闭环

文件：

- `tests/task-creation.test.mjs`

执行内容：

- 保留现有四类核心回归测试
- 若执行阶段发现边界未覆盖，再最小增补测试

原因：

- 该需求的主要风险集中在命名格式与非法输入回退逻辑
- 当前测试位置与职责合理，无需扩散到 UI 测试

建议保留的验收断言：

- 默认配置生成 `项目名-YYYY-MM-DD.md`
- 自定义格式如 `YYYY年MM月DD日` 能正确生成文件名
- 空白输入回退默认值
- 非法格式输入回退默认值

## Assumptions & Decisions

- 日期格式语法按“Moment/Day.js 风格的常用子集”处理，而非完整语法兼容
- 默认日期格式固定为 `YYYY-MM-DD`
- 无效格式的处理策略为“自动回退默认值”，不额外报错打断用户
- 设置值在保存和加载时都进行归一化，避免脏数据长期存在
- 本次不扩展更多高级 token，例如时间、周、季度、时区等
- 本次不改动非日期型任务的命名规则

## Verification Steps

执行阶段应按以下顺序验证：

1. 运行 `npm test`
   - 确认 `tests/task-creation.test.mjs` 中与日期格式相关断言全部通过

2. 运行 `npm run build`
   - 确认 TypeScript 与打包流程通过

3. 运行 `npm run lint`
   - 确认未引入新的 lint 问题，尤其是外部日期库依赖问题

4. 运行 diagnostics 检查最近改动文件
   - 重点检查：
     - `src/settings.ts`
     - `src/main.ts`
     - `src/tasks-center/task-creation.ts`
     - `src/tasks-center/date-task-format.ts`

5. 手动验收
   - 在插件设置中修改“日期任务日期格式”
   - 新建一个日期型任务
   - 确认生成文件名符合设置值
   - 输入空白或非法格式后再次创建日期任务
   - 确认文件名回退为默认 `YYYY-MM-DD`

## Expected Execution Outcome

若执行阶段按本计划推进，预期结果是：

- 用户可在设置中自定义日期型任务的日期格式
- 日期任务创建时使用该设置生成文件名
- 插件重启后设置仍能保留
- 无效输入不会导致报错，而是平滑回退默认值
- 测试、构建、lint 和 diagnostics 均保持通过
