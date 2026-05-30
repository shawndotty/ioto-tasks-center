## Summary
- 在“添加任务”菜单中新增一个“普通任务”选项。
- 当用户选择“普通任务”时：
  - 仍然弹出输入框收集任务名称
  - 生成的任务文件名只使用用户输入内容，不再自动拼接项目名称
  - 该任务文件仍然写入 `Project` 属性
- 额外确认规则：
  - 如果模板中原本带有 `Subject` 或 `Plan` 属性，创建普通任务时需要删除这两个属性，最终只保留普通任务应有的属性集合。

## Current State Analysis
- `src/tasks-center/task-creation.ts`
  - 当前 `TaskCreationType = 'date' | 'plan' | 'topic'`
  - 当前命名规则：
    - `date`：`项目名-YYYY-MM-DD.md`
    - `plan`：`项目名-计划-名称.md`
    - `topic`：`项目名-主题-名称.md`
  - 当前属性写入规则：
    - 所有任务都写 `Project`
    - `topic` 额外写 `Subject`
    - `plan` 额外写 `Plan`
  - 当前不会主动清理“不属于当前任务类型”的属性，因此如果普通任务复用模板，模板里已有 `Subject` / `Plan` 会残留，必须显式处理。
- `src/views/iotoTasksCenterView.ts`
  - 任务创建菜单来源于 `TASK_CREATION_OPTIONS`
  - 当前只有：
    - 日期任务
    - 计划任务
    - 主题任务
  - 当前 `handleCreateTask(type)` 中：
    - 只有 `date` 不需要输入名称
    - `plan` / `topic` 会弹 `TaskNameModal`
  - 因此新增普通任务后，交互上应与 `plan` / `topic` 一样，先收集用户输入。
- `tests/task-creation.test.mjs`
  - 当前已覆盖：
    - 现有三种命名规则
    - `Project` / `Subject` / `Plan` 注入与覆盖
  - 尚未覆盖：
    - 普通任务的文件命名
    - 普通任务只保留 `Project`
    - 普通任务会移除模板残留的 `Subject` / `Plan`

## Proposed Changes
### 1. 扩展任务类型与创建菜单
- 修改 `src/tasks-center/task-creation.ts`
  - 将 `TaskCreationType` 扩展为：
    - `'date' | 'plan' | 'topic' | 'normal'`
- 修改 `src/views/iotoTasksCenterView.ts`
  - 在 `TASK_CREATION_OPTIONS` 中新增“普通任务”
  - 位置建议与现有命名任务放在一起，菜单中清晰区分：
    - 日期任务
    - 普通任务
    - 计划任务
    - 主题任务
- 在 `handleCreateTask(type)` 中：
  - `normal` 与 `plan` / `topic` 一样，需要弹出输入框
  - 标题和输入提示应改成面向普通任务的文案，例如：
    - 标题：`新建普通任务`
    - 占位或标签：`输入任务名称`

### 2. 修改普通任务的命名规则
- 修改 `buildTaskFileName(...)`
- 新规则：
  - `date`：保持 `项目名-YYYY-MM-DD.md`
  - `plan`：保持 `项目名-计划-名称.md`
  - `topic`：保持 `项目名-主题-名称.md`
  - `normal`：使用 `用户输入名称.md`
- 这里仍复用现有 `normalizeCustomTaskName(...)` 进行合法化处理，避免非法字符和空白名称问题。
- 普通任务不应自动拼接项目名前缀，也不应带“普通”类型前缀。

### 3. 调整属性写入逻辑
- 修改 `src/tasks-center/task-creation.ts` 的任务属性后处理逻辑。
- 普通任务的最终属性规则应为：
  - 保留/写入 `Project`
  - 不写入 `Subject`
  - 不写入 `Plan`
- 已确认的额外规则：
  - 如果模板里已有 `Subject` 或 `Plan`，创建普通任务时需要删除这两个属性
- 因此建议把当前“只做 upsert”的逻辑扩展为：
  - 能够删除指定 List 属性，例如增加 `removeListProperty(...)`
  - 或增加“按任务类型收口属性集合”的统一后处理函数
- 最终各类型的属性规则应明确为：
  - `date`：`Project`
  - `normal`：`Project`
  - `topic`：`Project` + `Subject`
  - `plan`：`Project` + `Plan`
- 同时避免跨类型残留：
  - `normal` 删除 `Subject` / `Plan`
  - `topic` 可删除 `Plan`
  - `plan` 可删除 `Subject`
- 即使这次用户只明确要求普通任务清理 `Subject` / `Plan`，也建议在实现时统一收口当前类型允许存在的属性集合，避免模板属性污染。

### 4. 补充测试 `tests/task-creation.test.mjs`
- 在现有测试文件中新增以下覆盖：
  - 普通任务命名符合 `用户输入.md`
  - 普通任务名称为空时仍会抛错
  - 普通任务路径拼接仍落在 `任务根目录/项目名/文件名`
  - 普通任务最终会保留 `Project`
  - 普通任务不会新增 `Subject` / `Plan`
  - 若模板内容已有 `Subject` / `Plan`，普通任务后处理后会删除它们
- 若属性后处理逻辑被重构为更通用的纯函数，测试可直接验证该纯函数，不必引入文件系统 mock。

### 5. 验证与回归
- 自动化验证
  - `npm test`
  - `npm run build`
  - `npm run lint`
  - 对修改文件执行 diagnostics 检查
- 手动验证
  - 在任务中心中点击“添加任务”，确认菜单新增“普通任务”
  - 选择普通任务后输入任务名，确认生成文件名只有输入内容，不带项目名前缀
  - 打开生成文件，确认有 `Project` 属性
  - 若使用带 `Subject` / `Plan` 的模板创建普通任务，确认最终这两个属性已被删除

## Assumptions & Decisions
- 普通任务仍然创建在当前选中项目对应的项目文件夹内，只是文件名不再包含项目名前缀。
- 普通任务与计划/主题任务一样，需要用户输入名称。
- 普通任务仍然保留 `Project` 属性，值规则与其他任务相同。
- 若模板里已有 `Subject` / `Plan`，普通任务最终要删除这两个属性。
- 本次只新增“普通任务”类型，不调整现有日期/计划/主题任务的命名规则和入口位置以外的交互。

## Verification Steps
- 代码层
  - 确认 `TaskCreationType` 已支持 `normal`
  - 确认普通任务命名不再拼接项目名前缀
  - 确认普通任务最终属性只保留 `Project`
  - 确认模板残留的 `Subject` / `Plan` 会被清理
- 自动化验证
  - `npm test`
  - `npm run build`
  - `npm run lint`
  - diagnostics 检查 `src/tasks-center/task-creation.ts`、`src/views/iotoTasksCenterView.ts` 和 `tests/task-creation.test.mjs`
- 手动验证
  - 菜单中可见普通任务选项
  - 普通任务文件名正确
  - 普通任务 frontmatter 正确
  - 使用带专用属性的模板创建普通任务时无残留属性
