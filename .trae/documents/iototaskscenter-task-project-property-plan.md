## Summary
- 在创建任务文件时，自动为新文件写入 Obsidian Properties 中的 `Project` 属性。
- `Project` 属性使用 List 类型，值固定为当前选中项目名，例如：
  ```yaml
  ---
  Project:
    - 项目A
  ---
  ```
- 若模板文件中已经存在 `Project` 属性，则创建时强制覆盖为当前选中项目的单项 List。
- 该规则需同时适用于：
  - 未使用模板创建的任务文件
  - 使用模板原文回填的任务文件
  - 使用 Templater 自动执行模板创建的任务文件

## Current State Analysis
- `src/tasks-center/task-creation.ts`
  - 当前是任务创建的核心模块。
  - 现有流程为：
    - 根据项目名和类型生成文件名
    - 创建空白文件
    - 若无模板则直接返回空文件
    - 若有模板则优先尝试执行 Templater
    - 若 Templater 不可用则回退为写入模板原文
  - 当前没有任何 frontmatter / Properties 注入逻辑，也没有对 YAML 头进行解析或更新。
- `src/views/iotoTasksCenterView.ts`
  - 当前在 `handleCreateTask()` 中把 `projectName` 传入 `createTaskFile(...)`，因此“当前选中项目”已经是现成输入，不需要额外从视图层补采集。
- `src/tasks-center/data.ts`
  - 当前只负责任务状态解析，与 frontmatter/Properties 无直接关系，本次不应改动。
- `tests/task-creation.test.mjs`
  - 当前已覆盖：
    - 文件命名
    - 名称归一化
    - 目标路径
    - Templater 命令 ID
  - 还没有覆盖“自动注入/覆盖 `Project` 属性”的逻辑。
- 当前插件运行时配置 `data.json` 中尚未配置 `taskTemplatePath`，说明计划需要以代码链路为准，而不是依赖现成模板样例。

## Proposed Changes
### 1. 在 `src/tasks-center/task-creation.ts` 中加入 Properties 注入能力
- 保持当前任务创建主流程不变，在内容最终写入完成后追加一步：
  - 将当前项目名写入/覆盖为 `Project` List 属性
- 建议新增一组小型纯函数，集中处理 frontmatter：
  - `buildProjectPropertyFrontmatter(projectName: string): string`
  - `upsertProjectProperty(content: string, projectName: string): string`
- 处理规则明确如下：
  - 若文件没有 frontmatter：
    - 在文件顶部插入新的 YAML frontmatter，包含 `Project` List
  - 若文件已有 frontmatter 但没有 `Project`：
    - 在现有 frontmatter 内补入 `Project` List
  - 若文件已有 `Project`：
    - 无论原来是单值、List、空值还是其他格式，都覆盖为当前项目的单项 List
- 属性名固定为用户要求的 `Project`，不做大小写配置化扩展。

### 2. 明确注入时机，覆盖所有创建路径
- 在 `createTaskFile(...)` 中统一保证 `Project` 属性最终存在且正确。
- 时机建议为“内容最终成型之后”：
  - 无模板：创建空文件后，立即写入 frontmatter
  - 模板原文回填：`app.vault.modify(file, content)` 之后，再进行 `Project` 属性注入
  - Templater 自动执行：模板命令执行结束后，再读取最终文件内容并覆盖/补写 `Project`
- 这样能避免：
  - 模板原文覆盖掉注入的属性
  - Templater 执行后把前面写入的 `Project` 又改没

### 3. 兼容已有模板 frontmatter
- 本次实现按已确认的规则处理：
  - 如果模板已经带有 `Project` 属性，最终仍覆盖为当前项目对应的单项 List
- 需要注意的边界情况：
  - frontmatter 中 `Project: 项目A`
  - frontmatter 中 `Project: [项目A, 项目B]`
  - frontmatter 中多行 List
  - frontmatter 中 `project:` 小写键
- 本次仅强制处理精确键名 `Project` 是否存在与覆盖，不额外把小写 `project` 自动迁移成 `Project`，除非在实现时发现不处理会明显留下重复属性风险；若要处理，也应在计划执行时保持规则简单且可测试。

### 4. 补充测试 `tests/task-creation.test.mjs`
- 在现有测试文件基础上补充 frontmatter 相关纯逻辑测试，避免新建单独大测试文件。
- 建议新增导出并覆盖以下场景：
  - 空内容文件会插入带 `Project` List 的 frontmatter
  - 已有 frontmatter 且无 `Project` 时，会补入 `Project`
  - 已有 `Project` 单值时，会覆盖为当前项目的 List
  - 已有 `Project` List 时，会覆盖为仅包含当前项目的单项 List
  - 普通正文内容在插入 frontmatter 后仍保持不丢失
- 若需要，为 `task-creation.ts` 额外导出一个纯函数用于测试，例如 `upsertProjectProperty(...)`

### 5. 验证与回归
- 自动化验证
  - 运行 `npm test`
  - 运行 `npm run build`
  - 运行 `npm run lint`
  - 对新增/修改文件执行 diagnostics 检查
- 手动验证
  - 不使用模板创建任务，确认生成文件顶部自动含有 `Project` List
  - 使用普通 Markdown 模板创建任务，确认最终文件含有 `Project` List
  - 使用已带 `Project` 属性的模板创建任务，确认最终属性被覆盖为当前选中项目
  - 使用 Templater 模板创建任务，确认 Templater 执行后 `Project` 仍存在且值正确

## Assumptions & Decisions
- `Project` 指 Obsidian 的 YAML frontmatter Properties，而不是正文中的内联字段。
- `Project` 的最终格式固定为 List，即使只有一个项目值也使用数组表达。
- 当前选中项目名直接来自 `createTaskFile(...)` 已接收的 `projectName` 参数。
- 若模板已有 `Project`，最终一律覆盖为当前项目的单项 List。
- 本次只增加 `Project` 属性自动注入，不顺带增加其他属性或通用属性映射配置。

## Verification Steps
- 代码层
  - 确认 `createTaskFile(...)` 所有返回前都已经完成 `Project` 属性注入/覆盖
  - 确认模板执行链路不会在注入后再次覆盖掉 `Project`
- 自动化验证
  - `npm test`
  - `npm run build`
  - `npm run lint`
  - diagnostics 检查 `src/tasks-center/task-creation.ts` 和相关测试文件
- 手动验证
  - 在任务中心选择项目后新建日期任务，确认文件含 `Project` List
  - 切换到另一个项目再创建任务，确认 `Project` 值随项目变化
  - 用带 frontmatter 模板和带 `Project` 的模板分别创建，确认最终都被覆盖为当前项目
