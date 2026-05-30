## Summary
- 为 `UpTask` 属性增加对 Obsidian `[[...]]` 语法的兼容。
- 当用户在 `UpTask` 中填写 `[[任务标题]]` 时，任务中心在做父子任务匹配前，需要先去掉外层 `[[` 和 `]]`，再按任务标题进行匹配。
- 该兼容应同时适用于：
  - `UpTask` 为单个字符串
  - `UpTask` 为 YAML List

## Current State Analysis
- `src/tasks-center/data.ts`
  - 当前 `UpTask` 的读取入口在 `getUpTaskTitles(app, file)`。
  - 实际解析逻辑集中在 [parseUpTaskFrontmatterValue](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/data.ts)。
  - 目前仅做了：
    - `string` → `trim`
    - `array` → 过滤非字符串、`trim`、过滤空字符串
  - 还没有处理 Obsidian wikilink 语法，因此 `[[父任务]]` 目前会被原样保留，导致无法匹配当前任务标题 `父任务`。
- `src/views/task-hierarchy.ts`
  - 当前父子匹配逻辑通过 `task.upTaskTitles` 直接查找 `firstTaskPathByTitle`。
  - 这里已经假设 `upTaskTitles` 是可直接匹配标题的标准化结果。
  - 因此 `[[...]]` 的剥离应放在数据层解析，而不应放在层级构建层。
- `tests/task-hierarchy.test.mjs`
  - 当前已经覆盖：
    - `UpTask` 单值
    - `UpTask` 列表
    - 层级展开、外部父任务、自引用、循环引用
  - 但还没有覆盖：
    - `[[父任务]]` 这种 wikilink 形式
    - wikilink 与普通纯文本混用时的解析结果

## Proposed Changes
### 1. 在 `src/tasks-center/data.ts` 中新增 `UpTask` 标准化逻辑
- 在 `parseUpTaskFrontmatterValue(value)` 内部增加一个小型标准化函数，例如：
  - `normalizeUpTaskTitle(value: string): string`
- 标准化规则：
  - 先 `trim`
  - 若字符串整体符合 `[[...]]` 形式，则剥离最外层的 `[[` 和 `]]`
  - 剥离后再次 `trim`
  - 若最终为空字符串，则丢弃
- 这样无论用户写：
  - `父任务`
  - `[[父任务]]`
  - ` [[父任务]] `
  最终都会归一化为同一个可匹配标题：`父任务`

### 2. 保持层级匹配逻辑不变
- `src/views/task-hierarchy.ts` 不需要修改匹配策略。
- 原因：
  - 当前它已经基于标准化后的 `upTaskTitles` 工作
  - 若在数据层归一化到位，这里可以继续直接按任务标题匹配
- 这样可避免把解析责任散落到多个模块。

### 3. 明确兼容边界
- 本次仅处理“排除 `[[` 和 `]]`”这一需求，不额外扩展以下高级 wikilink 语法：
  - `[[笔记名|别名]]`
  - `[[笔记名#标题]]`
  - `[[文件夹/笔记名]]`
- 若后续用户希望支持这些语法，再单独规划。
- 当前实现只针对最直接的 `[[任务标题]]` 形式做兼容，保持规则简单、稳定、可测试。

### 4. 补充测试 `tests/task-hierarchy.test.mjs`
- 建议新增以下测试：
  - `UpTask` 为 `[[父任务]]` 时，会解析成 `父任务`
  - `UpTask` 列表中混合普通标题和 `[[标题]]` 时，会统一解析成纯标题数组
  - 使用 `[[父任务]]` 作为 `UpTask` 值时，层级匹配仍然生效
- 这样可以同时覆盖：
  - 解析层
  - 层级构建层

## Assumptions & Decisions
- `UpTask` 仍按“任务文件标题”匹配。
- `[[...]]` 只做最外层剥离，不做别名、标题锚点、路径等扩展解析。
- 标准化发生在数据层解析阶段，而不是视图层匹配阶段。
- 若 `UpTask` 既不是普通标题，也不是简单 `[[标题]]` 形式，则继续按现有纯文本逻辑处理。

## Verification Steps
- 代码层
  - 确认 `parseUpTaskFrontmatterValue()` 输出的 `upTaskTitles` 已去掉 `[[` 和 `]]`
  - 确认 `task-hierarchy.ts` 无需额外修改也能正确匹配父任务
- 自动化验证
  - `npm test`
  - `npm run build`
  - `npm run lint`
  - diagnostics 检查 `src/tasks-center/data.ts` 和 `tests/task-hierarchy.test.mjs`
- 手动验证
  - 在某个子任务文件中把 `UpTask` 设置为 `[[父任务标题]]`
  - 回到任务中心，确认该任务仍会缩进显示在对应父任务下面
