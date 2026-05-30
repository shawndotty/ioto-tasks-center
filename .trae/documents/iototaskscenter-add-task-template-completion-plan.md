## Summary
- 为任务中心右侧“任务列表”标题区补齐“添加任务”创建链路，让用户能在当前选中项目的 `3-任务/<项目名>/` 下新建任务文件。
- 创建入口采用单按钮 + 类型菜单，支持 `日期任务`、`计划任务`、`主题任务` 三类固定命名规则。
- 新文件创建时支持读取插件设置页配置的模板文件；若本地已启用 `Templater` 且命令可执行，则自动执行模板语法，否则降级为写入模板原文。
- 当前仓库里这项能力已经实现了一半以上，本次执行重点是补全缺失细节、补测试、跑构建/诊断并收口。

## Current State Analysis
- `src/views/iotoTasksCenterView.ts`
  - 已新增标题右侧操作区和“添加任务”按钮。
  - 已接入 `Menu` 类型选择、`TaskNameModal` 命名弹窗、`handleCreateTask()` 创建流程。
  - 已在创建后调用 `refreshFromVaultChange()` 和 `openFileInPreview()`，说明列表刷新与右侧预览复用已纳入设计。
- `src/tasks-center/task-creation.ts`
  - 已存在独立任务创建模块。
  - 已实现文件命名、目标路径解析、重名时直接打开已有文件、模板原文回填、尝试走 `templater-obsidian:<templatePath>` 命令自动执行模板。
  - 已包含 `ensureTemplateCommandEnabled()`，会把模板路径加入 `Templater` 的 `enabled_templates_hotkeys`，与当前 vault 的命令注册模式一致。
- `src/settings.ts`
  - 已新增 `taskTemplatePath` 设置项和设置页输入框。
  - 已增加读取 `Templater` 的 `templates_folder` 作为提示文案。
- `src/main.ts`
  - 已把 `taskTemplatePath` 以 getter 形式传给视图。
  - 已新增 `updateTaskTemplatePath()` 并接入已有的设置持久化和视图刷新机制。
- `src/ui/taskNameModal.ts`
  - 已新增计划/主题任务命名输入弹窗，支持确认与取消。
- `styles.css`
  - 已新增标题操作区、按钮、modal 的样式。
- `tests/`
  - 现有 `task-status.test.mjs`、`project-sort.test.mjs` 仍在。
  - 缺少针对 `task-creation.ts` 的测试文件，当前没有自动化覆盖命名规则、名称归一化、Templater 命令 ID 生成等纯逻辑。
- 验证状态
  - 当前未看到 `npm test`、`npm run build`、`npm run lint` 的最新执行结果。
  - 当前未看到针对新增文件的 diagnostics 回归结果。

## Proposed Changes
### 1. 收口并校正 `src/views/iotoTasksCenterView.ts`
- 核对并补齐创建流程的边界处理，确保以下行为稳定：
  - 仅在当前项目有效、视图不在加载中、未处于创建中时启用按钮。
  - 选择 `日期任务` 时直接创建。
  - 选择 `计划任务` / `主题任务` 时先打开 `TaskNameModal` 获取名称，取消则中止。
  - 创建成功或命中重名时，都刷新列表并在右侧固定 pane 打开目标文件。
  - 若创建期间当前项目失效、目录不存在或名称为空，统一走 `Notice` 提示，不做隐式兜底创建。
- 复查 `ensurePreviewLeaf()`、`openFileInPreview()` 与创建流程的配合，避免新建文件时破坏已有的右侧 pane 复用逻辑。

### 2. 收口并校正 `src/tasks-center/task-creation.ts`
- 保留现有模块边界，不把创建逻辑回塞到视图层。
- 明确并保证以下规则：
  - `buildTaskFileName()`
    - `date` => `${projectName}-YYYY-MM-DD.md`
    - `plan` => `${projectName}-计划-${name}.md`
    - `topic` => `${projectName}-主题-${name}.md`
  - `normalizeCustomTaskName()`
    - 去首尾空白。
    - 折叠连续空格。
    - 替换非法文件名字符，避免生成非法路径。
    - 空结果返回 `null`。
  - `createTaskFile()`
    - 目标项目目录不存在时抛错。
    - 目标路径已有同名 `TFile` 时不覆盖，直接返回已有文件。
    - 模板路径为空时创建空白文件。
    - 模板路径有效时优先尝试自动执行 Templater。
    - 自动执行失败时，降级为把模板原文写入新文件，并给出 Notice。
- 保持当前方案不依赖 `Templater` 的全局 `trigger_on_file_creation`，只依赖模板命令执行链路。

### 3. 完成测试 `tests/task-creation.test.mjs`
- 新增纯逻辑测试文件，沿用当前测试风格：`node:test` + `jiti` 动态导入 TypeScript 模块。
- 至少覆盖以下场景：
  - `buildTaskFileName()` 的三种命名规则。
  - `normalizeCustomTaskName()` 对空白、非法字符、连续空格的处理。
  - `resolveTaskTargetPath()` 返回 `3-任务/<项目名>/<文件名>`。
  - `getTemplaterCommandId()` 生成 `templater-obsidian:<templatePath>`。
  - `buildTaskFileName()` 在 `plan/topic` 名称为空时抛出错误。
- 不为难以稳定 mock 的 Obsidian 运行时链路写高噪声测试；自动化测试聚焦纯逻辑与命名/路径规则。

### 4. 样式与设置页做最终一致性检查
- `styles.css`
  - 检查标题操作区在窄宽度下的换行和按钮禁用态是否仍与现有 tab 样式兼容。
- `src/settings.ts`
  - 确认模板设置文案清楚表达“支持 Templater 语法，优先自动执行，失败则降级为写入原文”。
  - 保持只使用文本输入，不新增文件选择器。

### 5. 完整验证
- 自动化验证
  - `npm test`
  - `npm run build`
  - `npm run lint`
  - 对新增/修改文件执行 diagnostics 检查
- 手动验证
  - 在设置页填写有效模板路径并保存，确认重开后仍保留。
  - 进入任务中心，确认“添加任务”按钮仅在有有效项目时可点。
  - 在选中项目下依次测试三种类型的创建。
  - 若同名文件已存在，确认不会覆盖，而是直接打开已有文件。
  - 若模板有效且 Templater 命令可执行，确认新文件中的模板语法被处理。
  - 若模板存在但 Templater 不可执行，确认新文件写入模板原文且有降级提示。

## Assumptions & Decisions
- 文件类型交互保持为单个“添加任务”按钮后弹出菜单，不改成多个独立按钮。
- 文件命名规则保持与 vault 现有习惯一致：
  - `项目名-日期`
  - `项目名-计划-名称`
  - `项目名-主题-名称`
- 模板设置保持全局单一路径，不扩展为按项目或按类型配置模板。
- 自动执行 Templater 的实现以当前 vault 里已验证存在的命令格式 `templater-obsidian:<templatePath>` 为准。
- 若自动执行链路不可用，不阻塞创建流程，直接降级写入原文。
- 本次只补齐用户明确要求的“添加任务 + 模板 + Templater”能力，不顺带扩展更多任务类型、批量创建或高级模板选择。

## Verification Steps
- 代码层
  - 确认 `src/main.ts`、`src/settings.ts`、`src/views/iotoTasksCenterView.ts`、`src/tasks-center/task-creation.ts`、`src/ui/taskNameModal.ts` 的类型与调用链闭合。
  - 新增 `tests/task-creation.test.mjs` 后，确保测试目录结构与现有脚本 `node --test tests/**/*.test.mjs` 兼容。
- 命令层
  - 运行 `npm test`，确认新增测试和既有测试全部通过。
  - 运行 `npm run build`，确认 TypeScript 和 esbuild 均通过。
  - 运行 `npm run lint`，确认新增模块未引入 ESLint 问题。
  - 对最近编辑文件跑 diagnostics，清掉新增错误。
- 交互层
  - 从命令面板打开任务中心，选择任一项目后验证按钮状态。
  - 创建三种类型文件并确认文件实际落在 `3-任务/<项目名>/`。
  - 确认中间任务列表与左侧未完成计数会在创建后刷新。
  - 确认右侧固定预览 pane 继续复用，不因创建流程额外拆出新的 pane。
