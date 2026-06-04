# 日期型任务格式放宽计划（对齐 Obsidian 日记插件思路）

## Summary

- 目标：让日期型任务的“日期格式”设置不再受当前白名单 token 限制，改为像 Obsidian 自带日记插件那样，允许用户直接使用 Moment.js 风格格式字符串。
- 行为边界：
  - 空白输入仍回退到默认值 `YYYY-MM-DD`
  - 非空格式字符串按原样保留，不再做“是否支持”的白名单判定
  - 最终生成文件名时，只需要保证文件名合法；若格式化结果中出现非法字符，则统一替换为 `-`
- 重点支持的场景：
  - 时间 token，如 `HH:mm`
  - 本地化 token，如 `dddd`、`MMM`、`MMMM`
  - 普通字符与中文混排
  - `[]` 字面量语法，例如 `YYYY[年]M[月]D[日]`

## Current State Analysis

### 1. 当前限制的真实来源

- 文件 [date-task-format.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/date-task-format.ts) 目前使用手写 token 解析器：
  - 仅支持 `YYYY`、`YY`、`MM`、`M`、`DD`、`D`
  - `isSupportedDateTaskDateFormat()` 会拒绝英文字母和 `[]`
- 这导致用户无法使用：
  - 时间格式：`HH:mm`
  - `[]` 字面量
  - 更完整的 Moment token
  - 本地化日期显示

### 2. 设置页本身已允许自由输入

- 文件 [settings.ts:L201-L215](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts#L201-L215) 的日期格式输入框已经是自由文本输入。
- 当前问题不在 UI 控件，而在保存后被 [main.ts:L221-L229](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts#L221-L229) 调用的 `normalizeDateTaskDateFormat()` 强行收窄。

### 3. 日期任务文件名目前没有日期结果专用合法化处理

- 文件 [task-creation.ts:L46-L55](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-creation.ts#L46-L55) 中，日期任务直接把 `formatDate(...)` 的结果拼进文件名。
- 当前已有的 `normalizeCustomTaskName()` 只用于普通/计划/主题任务名称，不用于日期格式输出。
- 这意味着一旦未来支持 `YYYY/MM/DD` 或 `HH:mm`，就可能生成非法路径或非法文件名。

### 4. 当前测试仍绑定旧行为

- 文件 [task-creation.test.mjs:L127-L136](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/task-creation.test.mjs#L127-L136) 目前断言：
  - 空白格式回退默认值
  - `"[invalid-format]"` 也回退默认值
- 这和本次目标冲突，因为新行为会改成“非空值原样保留”。

### 5. 现有可复用的语言/时间上下文

- 文件 [helpter.ts:L24-L27](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/helpter.ts#L24-L27) 已通过 `moment.locale()` 读取当前 Obsidian 语言。
- 这为后续日期格式化跟随当前语言提供了现成入口。

## Assumptions & Decisions

- 对齐 Obsidian 日记插件的核心原则：用户输入格式字符串时，插件尽量少做限制。
- 仅保留一条强制回退规则：输入为空白时回退 `YYYY-MM-DD`。
- 非空格式字符串一律按原样保存和使用，不在设置保存阶段做复杂校验。
- 文件名合法性优先于格式字面完全保真：
  - 若格式化结果中出现 `/`、`\\`、`:`、`*`、`?`、`"`、`<`、`>`、`|` 等非法字符，统一替换为 `-`
- 本次范围仅限日期型任务文件名的日期格式能力，不扩展到其他任务类型命名规则。

## Proposed Changes

### 1. 重写日期格式化核心，改为直接使用 Moment

文件：

- [date-task-format.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/date-task-format.ts)

变更内容：

- 移除当前手写 token 白名单解析逻辑，包括：
  - `DATE_FORMAT_TOKENS`
  - `isSupportedDateTaskDateFormat(...)`
  - `formatDateToken(...)`
- `normalizeDateTaskDateFormat(format)` 改为最小归一化：
  - `trim`
  - 若为空白则返回 `DEFAULT_DATE_TASK_DATE_FORMAT`
  - 否则直接返回用户输入
- `formatDateByPattern(date, format)` 改为委托给 Moment 执行格式化，而不是自己逐字符解析。
- 格式化时应使用当前 Obsidian 语言环境，以保证 `dddd`、`MMMM` 这类 token 输出与界面语言一致。

原因：

- 这是从根源解除日期格式限制的唯一正确位置。
- 可以自然支持用户提出的：
  - 中文字符混排
  - `[]` 语法
  - 时间 token
  - 更完整的 Moment 语法

### 2. 为日期格式输出增加文件名合法化处理

文件：

- [task-creation.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-creation.ts)

变更内容：

- 在 `formatDate(...)` 或相邻辅助函数处，增加“日期文件名片段合法化”步骤。
- 规则：
  - 对日期格式化结果执行 `trim`
  - 把文件名非法字符统一替换为 `-`
  - 可以折叠连续 `-`
  - 去掉首尾多余的 `-` 和空白，避免文件名脏数据
- `buildTaskFileName()` 的日期任务分支继续保留现有输出结构：
  - `${projectName}-${dateSegment}.md`

原因：

- 用户明确表示“只要确保最终生成的文件名是合法的就行”。
- 这一步是支持自由格式后必须补上的安全兜底。

### 3. 保持设置接口不变，仅修正文案与语义

文件：

- [main.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts)
- [settings.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts)
- 多语言文案文件：
  - [en.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)
  - [zh-cn.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts)
  - [zh-tw.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts)

变更内容：

- 保留现有设置字段 `dateTaskDateFormat`、保存方法和视图传参方式，不改数据结构。
- 让 `main.ts` 中 `loadSettings()` / `updateDateTaskDateFormat()` 继续调用 `normalizeDateTaskDateFormat()`，但归一化逻辑改为“仅空白回退”。
- 更新设置说明文案，使其与真实行为一致：
  - 支持 Moment 风格格式
  - 支持 `[]`
  - 支持时间格式
  - 非法文件名字符会自动转为 `-`

原因：

- 现有设置链路已经足够，不需要新增配置项。
- 真正需要修正的是“当前说明和底层能力不一致”的问题。

### 4. 更新并补充测试，锁定新的行为边界

文件：

- [task-creation.test.mjs](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/task-creation.test.mjs)
- 视实现需要可新增：
  - `tests/date-task-format.test.mjs`

测试应覆盖：

- 空白日期格式仍回退默认值 `YYYY-MM-DD`
- `YYYY[年]M[月]D[日]` 可以正常输出
- `[截止] YYYY-MM-DD` 可以正常输出
- `YYYY-MM-DD HH:mm` 可用，且 `:` 被替换为 `-`
- `YYYY/MM/DD` 可用，且 `/` 被替换为 `-`
- 非空“奇怪格式”不再自动回退默认值
- 本地化 token 跟随当前语言输出，例如：
  - 英文环境下 `MMMM dddd`
  - 中文环境下 `MMMM dddd`

原因：

- 这次需求的风险点集中在格式解释与文件名安全，不在 UI。
- 需要把旧的“非法格式回退”测试改成新的行为断言，避免后续回归。

## Verification Steps

### 自动化验证

- 运行 `npm test`
  - 确认日期格式相关测试全部通过
  - 若存在与本次改动无关的既有失败，应单独标明
- 运行 `npm run build`
  - 确认新的日期格式化实现不会引入类型或打包问题
- 运行 `npm run lint`
  - 确认没有新增 lint 问题
- 对以下文件执行 diagnostics 检查：
  - `src/tasks-center/date-task-format.ts`
  - `src/tasks-center/task-creation.ts`
  - `src/settings.ts`
  - `src/main.ts`
  - `tests/task-creation.test.mjs`
  - `tests/date-task-format.test.mjs`（若新增）

### 手动验收

- 在设置页输入 `YYYY[年]M[月]D[日]`
  - 创建日期任务，确认生成如 `项目A-2026年5月30日.md`
- 在设置页输入 `[截止] YYYY-MM-DD`
  - 创建日期任务，确认文件名含 `截止`
- 在设置页输入 `YYYY-MM-DD HH:mm`
  - 创建日期任务，确认时间中的 `:` 被转成 `-`
- 在设置页输入 `YYYY/MM/DD`
  - 创建日期任务，确认 `/` 被转成 `-`
- 切换 Obsidian 语言后使用 `dddd` 或 `MMMM`
  - 确认输出随语言变化
- 把设置清空为空白
  - 确认自动恢复为默认格式 `YYYY-MM-DD`
