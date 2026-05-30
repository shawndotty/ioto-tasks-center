## Summary
- 在任务列表标题右侧新增一个“添加任务”按钮。
- 点击按钮后弹出类型选择菜单，支持 `日期`、`计划`、`主题` 三种固定前缀类型。
- 在当前选中项目对应的 `3-任务/<项目名>/` 下创建新任务文件。
- 在插件设置页新增“任务创建模板”设置，允许用户填写一个 vault 相对路径的模板文件。
- 若检测到已启用 `Templater`，则在创建后自动对新文件执行该模板；若未启用或执行入口不可用，则降级为写入模板原文并提示用户。

## Current State Analysis
- 任务中心视图集中在 `src/views/iotoTasksCenterView.ts`，当前右侧标题区域只有标题、说明文案和 tab，没有任务创建入口。
- 插件设置页位于 `src/settings.ts`，目前已有项目排序和隐藏项目设置，具备持久化设置模型与动态重渲染能力。
- 插件入口位于 `src/main.ts`，当前已通过传入 getter 的方式把排序和隐藏设置下发给 `IOTOTasksCenterView`，并在设置变更后刷新所有已打开视图。
- 任务文件数据访问位于 `src/tasks-center/data.ts`，当前提供项目目录扫描和任务文件列表读取，但没有文件创建与模板处理逻辑。
- 样式集中在 `styles.css`，当前有右侧 pane 的标题、说明、tab 和任务列表样式，但没有标题操作区按钮样式。
- 当前 vault 中已安装 `Templater` 插件，路径为 `.obsidian/plugins/templater-obsidian/`；其本地配置文件 `data.json` 显示 `trigger_on_file_creation` 当前为 `false`，因此仅创建文件不会自动处理模板语法。
- 当前 vault 的 `hotkeys.json` 中存在 `templater-obsidian:<template-path>` 形式的命令 ID，说明本地 Templater 已为启用热键的模板注册命令，可作为自动执行模板的接入点依据。
- 当前 `3-任务/` 目录下任务文件命名习惯主要为：
  - `项目名-YYYY-MM-DD.md`
  - `项目名-计划-自定义名称.md`
  - `项目名-主题-自定义名称.md`

## Proposed Changes
### 1. `src/settings.ts`
- 扩展 `IOTOTasksCenterSettings`：
  - 新增 `taskTemplatePath: string`
- 更新 `DEFAULT_SETTINGS`，默认为空字符串。
- 在现有设置页新增“任务创建”分组：
  - 一个模板路径输入框，保存 vault 相对路径，例如 `0-辅助/IOTO/Templates/Templater/OBIOTO/IOTO-加载器-创建任务.md`
  - 描述文案明确说明支持 Markdown 模板，且模板中可包含 Templater 语法
  - 若检测到 `templater-obsidian`，在描述中附带当前 Templater 的 `templates_folder` 作为提示信息，但不强制绑定
- 输入变更后调用插件层的统一更新方法，持久化并实时刷新已打开视图。

### 2. `src/main.ts`
- 扩展视图构造参数，除现有排序/隐藏 getter 外，再传入：
  - `getTaskTemplatePath(): string`
- 新增设置更新方法：
  - `updateTaskTemplatePath(path: string): Promise<void>`
- 保持当前设置刷新机制不变，复用 `applySettingsToOpenViews()` 让已打开视图在模板设置变更后立即获取新值。

### 3. 新增 `src/tasks-center/task-creation.ts`
- 新建独立模块，避免把任务创建、命名、模板处理逻辑堆进 `main.ts` 或视图文件。
- 职责拆分为纯函数 + 轻交互服务：
  - `buildTaskFileName(projectName, type, customName?, date)`：
    - `日期` => `${projectName}-${YYYY-MM-DD}.md`
    - `计划` => `${projectName}-计划-${自定义名称}.md`
    - `主题` => `${projectName}-主题-${自定义名称}.md`
  - `normalizeCustomTaskName(input)`：
    - 去除首尾空白
    - 将空字符串判定为无效
    - 对路径非法字符做最小安全处理，避免生成非法文件名
  - `resolveTaskTargetPath(projectName, fileName)`：
    - 目标目录为 `3-任务/${projectName}`
  - `ensureTemplateCommandEnabled(app, templatePath)`：
    - 若检测到 `Templater` 插件且模板路径尚未注册为热键命令，则把模板路径加入 `enabled_templates_hotkeys` 并保存其设置
    - 命令 ID 按当前 vault 已存在的实际格式使用 `templater-obsidian:${templatePath}`
  - `createTaskFile(...)`：
    - 校验目标项目目录是否存在
    - 处理重名策略
    - 创建新文件
    - 按模板与 Templater 状态决定后续写入/执行方式
- 重名处理规则定为：
  - 若目标文件已存在，则不覆盖，直接打开已有文件并提示“该任务文件已存在”
  - 该规则对 `日期`、`计划`、`主题` 统一适用，避免误覆盖用户文件
- 模板处理规则定为：
  - 若模板路径为空：创建空白文件
  - 若模板路径存在且 `Templater` 已启用：
    - 先创建空白文件
    - 在右侧固定 pane 打开新文件并临时激活该 leaf
    - 确保模板命令已可执行后，调用 `app.commands.executeCommandById('templater-obsidian:<templatePath>')`
    - 命令执行成功后保留新文件打开状态
  - 若模板路径存在但 `Templater` 未启用，或命令不可用：
    - 读取模板文件原文写入新文件
    - 给出 Notice，说明“模板已插入原文，未自动执行 Templater 语法”
- 模块内封装 Templater 适配接口与 Notice 文案，视图层只管触发和更新 UI。

### 4. 新增轻量交互模块
- 新增 `src/ui/taskTypeMenu.ts` 或直接在 `src/tasks-center/task-creation.ts` 中封装菜单逻辑：
  - 使用 Obsidian `Menu`
  - 点击“添加任务”按钮后弹出 `日期 / 计划 / 主题` 三项
- 新增 `src/ui/taskNameModal.ts`：
  - 仅在用户选择 `计划` 或 `主题` 时弹出输入框
  - 用户确认后返回自定义名称
  - 用户取消则中止创建
- 之所以拆成独立 UI 文件，是因为 `src/views/iotoTasksCenterView.ts` 已较长，继续叠加 modal/menu 代码会让维护成本上升。

### 5. `src/views/iotoTasksCenterView.ts`
- 右侧标题区域从纯文本标题改为“标题 + 操作按钮”的头部布局：
  - 标题仍为“任务列表”
  - 右侧新增“添加任务”按钮
- 仅在有当前选中项目且不处于项目/任务加载中时启用按钮；否则按钮禁用并显示相应 tooltip/aria label。
- 点击按钮流程：
  - 若无选中项目，则不打开菜单
  - 打开类型选择菜单
  - 选择 `日期` 时直接创建
  - 选择 `计划` / `主题` 时弹出命名输入 modal，确认后创建
  - 创建成功后：
    - 刷新当前项目任务列表
    - 刷新左侧项目未完成计数
    - 在右侧固定 pane 打开刚创建或已存在的目标文件
    - 设置 `openedTaskPath` 与 `lastOpenedTaskByProject`
- 若当前选中项目在创建期间被隐藏或失效，直接中止并提示，不做隐式恢复。

### 6. `styles.css`
- 为右侧标题区新增操作布局样式，例如：
  - `.ioto-tasks-center__section-header`
  - `.ioto-tasks-center__section-actions`
  - `.ioto-tasks-center__add-task-button`
- 保持与当前插件风格一致：
  - 轻量按钮
  - hover / disabled 状态
  - 窄屏下按钮不挤压标题，必要时允许换行

### 7. 测试
- 新增 `tests/task-creation.test.mjs`
- 覆盖以下纯逻辑场景：
  - `日期` 类型命名：`项目名-YYYY-MM-DD.md`
  - `计划` 类型命名：`项目名-计划-名称.md`
  - `主题` 类型命名：`项目名-主题-名称.md`
  - 自定义名称为空白时判定为无效
  - 隐藏或排序逻辑不受新建任务命名逻辑影响
  - 模板命令 ID 生成规则：`templater-obsidian:<templatePath>`
- 保留现有 `tests/project-sort.test.mjs` 和 `tests/task-status.test.mjs` 不动，只补充新测试文件。

## Assumptions & Decisions
- “添加任务”按钮只有一个，点击后通过菜单选择 `日期 / 计划 / 主题` 三种固定前缀类型。
- `日期` 类型不再额外询问名称，直接按当天日期生成。
- `计划` / `主题` 类型必须要求用户输入自定义名称；若取消或输入为空，则不创建文件。
- 若目标文件已存在，则直接打开已有文件，不覆盖也不生成副本。
- 模板文件路径使用 vault 相对路径，由用户在本插件设置页手动填写，不在本次实现中额外引入文件选择器。
- “自动执行 Templater” 的具体定义为：
  - 优先调用当前 vault 中已注册的 `templater-obsidian:<templatePath>` 命令
  - 若该命令不可用，则自动降级为将模板原文写入新文件并提示
- 由于当前 `Templater` 的 `trigger_on_file_creation` 已关闭，本方案不依赖全局开启该设置，也不修改用户现有的 Templater 全局行为。
- 本次实现不扩展为多模板、多默认类型或按项目配置模板，只支持单一全局模板路径。

## Verification Steps
- 自动化验证
  - 运行 `npm test`
  - 运行 `npm run build`
  - 运行 `npm run lint`
  - 对新增/修改文件执行 VS Code diagnostics 检查
- 手动验证
  - 在设置页填写一个有效模板路径并保存，重载插件后确认路径仍保留
  - 打开任务中心，确认右侧标题出现“添加任务”按钮
  - 选择不同项目后点击按钮：
    - `日期`：直接在 `3-任务/<项目名>/` 下创建 `项目名-YYYY-MM-DD.md`
    - `计划` / `主题`：输入名称后创建对应文件
  - 若创建的文件已存在，确认不会覆盖，而是直接打开已有文件
  - 右侧固定 pane 中应打开新建或已存在文件，左侧项目列表与中间任务列表应同步刷新
  - 模板路径有效且 Templater 可执行时，确认模板语法已被处理
  - 模板路径有效但 Templater 被禁用时，确认文件仍创建成功，且内容为模板原文并伴随提示
