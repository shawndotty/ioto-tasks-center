## Summary
- 在创建任务文件时，除已有的 `Project` 属性外：
  - 创建主题型任务时，额外自动写入 `Subject` 属性
  - 创建计划型任务时，额外自动写入 `Plan` 属性
- `Subject` 与 `Plan` 都使用 Obsidian Properties 的 List 类型，值为用户输入的主题/计划名称。
- 若模板中已存在同名属性，则按已确认规则强制覆盖为当前用户输入的单项 List。
- 日期型任务不增加 `Subject` / `Plan`，仍只写入 `Project`。

## Current State Analysis
- `src/tasks-center/task-creation.ts`
  - 当前已经实现：
    - 任务文件命名规则
    - Templater 模板执行与原文回退
    - `Project` 属性的 frontmatter 注入/覆盖
  - 当前 `CreateTaskFileOptions` 里已经有：
    - `projectName`
    - `type`
    - `customName`
  - 对本次需求来说，`customName` 正好就是：
    - 主题型任务的主题内容
    - 计划型任务的计划内容
  - 因此不需要额外新增输入参数来源，只需在 frontmatter 注入阶段根据 `type` 条件性写入 `Subject` 或 `Plan`。
- `src/views/iotoTasksCenterView.ts`
  - 当前在 `handleCreateTask()` 中：
    - `date` 类型不收集自定义名称
    - `plan` / `topic` 类型通过 `TaskNameModal` 收集用户输入，并作为 `customName` 传给 `createTaskFile(...)`
  - 这意味着当前视图层已经具备注入 `Subject` / `Plan` 所需的全部输入。
- `tests/task-creation.test.mjs`
  - 已覆盖：
    - 命名规则
    - `Project` 属性注入/覆盖
    - 内容保留
  - 还没有覆盖：
    - `Subject` / `Plan` 的条件性注入
    - 同名属性覆盖行为
- 当前 frontmatter 更新逻辑在 `task-creation.ts` 中偏“单属性定制”，即 `buildProjectPropertyFrontmatter()`、`upsertProjectProperty()` 和 `removeProjectPropertyFromFrontmatter()`。
  - 若继续照此方式硬扩展，会出现重复代码。
  - 本次更适合把它收敛成可复用的“属性 List frontmatter upsert”能力。

## Proposed Changes
### 1. 重构 `src/tasks-center/task-creation.ts` 的 frontmatter 注入逻辑
- 将当前只处理 `Project` 的逻辑，收敛为可复用的 List 属性 upsert 能力。
- 建议新增/调整为以下纯函数：
  - `buildListPropertyFrontmatter(propertyName: string, value: string): string`
  - `upsertListProperty(content: string, propertyName: string, value: string): string`
  - `upsertTaskProperties(content, options)` 或类似封装
- 在此基础上保留 `Project` 现有行为，同时支持：
  - `Subject`
  - `Plan`
- 处理规则统一为：
  - 没有 frontmatter：创建新的 frontmatter
  - 有 frontmatter 但无目标属性：补入该属性
  - 有同名属性：强制覆盖为当前输入的单项 List

### 2. 在任务创建链路中统一写入条件属性
- 在 `createTaskFile(...)` 最终内容成型后，统一执行属性注入。
- 建议将原来的 `applyProjectPropertyToFile(...)` 升级为更通用的后处理，例如：
  - `applyTaskPropertiesToFile(app, file, { projectName, type, customName })`
- 属性写入规则：
  - 所有任务都写入 `Project`
  - `type === 'topic'` 且 `customName` 有效时，额外写入 `Subject`
  - `type === 'plan'` 且 `customName` 有效时，额外写入 `Plan`
  - `type === 'date'` 不写入 `Subject` / `Plan`
- 为了保证模板链路一致，这一步仍然放在最终内容完成之后执行：
  - 无模板空文件后
  - 模板原文写入后
  - Templater 执行后

### 3. 明确覆盖策略
- 已确认的产品规则如下：
  - 若模板里已有 `Subject`，创建主题任务时覆盖为本次输入内容的单项 List
  - 若模板里已有 `Plan`，创建计划任务时覆盖为本次输入内容的单项 List
  - 若模板里已有 `Project`，继续沿用现有规则，覆盖为当前项目的单项 List
- 额外约束：
  - 本次只处理精确键名 `Project` / `Subject` / `Plan`
  - 不引入别名兼容，如 `project` / `subject` / `plan`
  - 不做“自动迁移小写键名”的额外逻辑，保持实现简单和可测试

### 4. 补充测试 `tests/task-creation.test.mjs`
- 在现有测试文件上补充 frontmatter 场景，继续沿用 `node:test` + `jiti`。
- 至少覆盖以下场景：
  - 主题任务会额外写入 `Subject` List
  - 计划任务会额外写入 `Plan` List
  - 日期任务不会写入 `Subject` / `Plan`
  - 已有 `Subject` 时，主题任务会覆盖为当前输入
  - 已有 `Plan` 时，计划任务会覆盖为当前输入
  - 在已有 `Project` + 正文内容的情况下，新增 `Subject` / `Plan` 后正文仍保留
- 如有必要，可导出一个通用纯函数供测试，而不是直接测文件系统写入。

### 5. 验证与回归
- 自动化验证
  - `npm test`
  - `npm run build`
  - `npm run lint`
  - diagnostics 检查新增/修改文件
- 手动验证
  - 创建主题任务，确认文件同时拥有：
    - `Project`
    - `Subject`
  - 创建计划任务，确认文件同时拥有：
    - `Project`
    - `Plan`
  - 创建日期任务，确认文件只有：
    - `Project`
  - 使用带同名属性的模板分别创建主题/计划任务，确认最终属性被覆盖为本次输入

## Assumptions & Decisions
- `Subject` 与 `Plan` 都是 YAML frontmatter Properties，而不是正文中的普通字段。
- 两者都固定使用 List 格式，即使只有一个值也用数组表示。
- 主题任务的属性值取自用户输入的主题名称，也就是当前 `customName`。
- 计划任务的属性值取自用户输入的计划名称，也就是当前 `customName`。
- 若模板已有 `Subject` / `Plan`，最终一律覆盖为当前输入的单项 List。
- 本次只增加 `Subject` / `Plan` 自动注入，不顺带扩展更多任务属性或通用属性配置 UI。

## Verification Steps
- 代码层
  - 确认任务创建最终内容写入阶段会根据 `type` 自动决定是否补写 `Subject` / `Plan`
  - 确认 `Project` 现有逻辑不被回归破坏
  - 确认模板执行后仍能正确覆盖 `Project` / `Subject` / `Plan`
- 自动化验证
  - `npm test`
  - `npm run build`
  - `npm run lint`
  - diagnostics 检查 `src/tasks-center/task-creation.ts` 和 `tests/task-creation.test.mjs`
- 手动验证
  - 分别创建日期/主题/计划任务
  - 检查 frontmatter 是否符合类型要求
  - 使用带同名属性的模板创建主题/计划任务，确认被正确覆盖
