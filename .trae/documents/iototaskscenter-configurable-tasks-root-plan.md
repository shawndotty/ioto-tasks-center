## Summary
- 将当前写死的任务根目录 `3-任务` 改为插件设置项，让用户可以自定义。
- 默认值仍保持为 `3-任务`，以兼容现有行为。
- 配置化后，任务中心的项目扫描、任务文件读取、项目/任务创建、界面提示文案，以及 vault 刷新监听都要统一使用该设置值。

## Current State Analysis
- `src/tasks-center/types.ts`
  - 当前直接导出常量 `TASKS_ROOT_PATH = '3-任务'`。
  - 多个模块都直接依赖这个常量，说明当前实现是全局硬编码，而不是运行时配置。
- `src/settings.ts`
  - 当前设置模型只有：
    - `projectListSortMode`
    - `hiddenProjectNames`
    - `taskTemplatePath`
  - 设置页已经有一个“任务根目录”说明项，但只是只读文案，不可编辑。
  - 文案里也直接引用了 `TASKS_ROOT_PATH`。
- `src/main.ts`
  - 当前只把排序、隐藏项目、任务模板路径传给 `IOTOTasksCenterView`。
  - `shouldRefreshTasksCenter()` 里仍直接写死：
    - `candidate === '3-任务'`
    - `candidate.startsWith('3-任务/')`
  - 这意味着即便 UI 配置化，vault 事件刷新也仍会失效，除非同步改成动态根路径。
- `src/tasks-center/data.ts`
  - `getTasksRootFolder()`、`listProjectFolders()`、`listProjectTaskFiles()` 都依赖 `TASKS_ROOT_PATH`。
  - 当前函数签名没有接收根目录参数，因此要支持配置化，需扩展 API 或引入统一 getter。
- `src/tasks-center/project-creation.ts`
  - 项目创建路径固定拼接在 `TASKS_ROOT_PATH` 下。
- `src/tasks-center/task-creation.ts`
  - 任务创建路径同样固定拼接在 `TASKS_ROOT_PATH` 下。
- `src/views/iotoTasksCenterView.ts`
  - 多处状态文案、空态文案和按钮 tooltip 使用 `TASKS_ROOT_PATH`。
  - 视图逻辑本身通过 `listProjectFolders()` / `listProjectTaskFiles()` 间接依赖硬编码根路径。
- `data.json`
  - 当前运行时配置中尚未出现任务根目录字段，说明这项设置还未落地：
  ```json
  {
    "projectListSortMode": "incomplete-count",
    "hiddenProjectNames": ["Demo"]
  }
  ```

## Proposed Changes
### 1. 扩展设置模型 `src/settings.ts`
- 在 `IOTOTasksCenterSettings` 中新增：
  - `tasksRootPath: string`
- 在 `DEFAULT_SETTINGS` 中设置默认值：
  - `tasksRootPath: '3-任务'`
- 将现有“任务根目录”说明项改为真正可编辑的设置项：
  - 使用文本输入框
  - 占位符与默认值显示 `3-任务`
  - 说明文案明确要求填写 vault 相对路径
- 建议增加一个小型归一化函数，例如：
  - 去除首尾空白
  - 统一路径分隔符
  - 去掉末尾 `/`
  - 若结果为空则回退到默认值 `3-任务`
- 隐藏项目设置区 `displayHiddenProjectSettings()` 也要改为基于当前设置的根目录读取项目列表，而不是常量。

### 2. 扩展插件入口 `src/main.ts`
- 在注册 `IOTOTasksCenterView` 时，新增传入：
  - `getTasksRootPath(): string`
- 新增设置更新方法，例如：
  - `updateTasksRootPath(path: string): Promise<void>`
- 设置变更后继续复用现有：
  - `saveSettings()`
  - `applySettingsToOpenViews()`
- 修改 `shouldRefreshTasksCenter()`，从写死的 `3-任务` 改为基于当前设置的根目录动态判断：
  - `candidate === tasksRootPath`
  - `candidate.startsWith(tasksRootPath + '/')`
- 这样可以保证用户切换根目录后，对应路径下的 create/delete/modify/rename 事件仍能刷新视图。

### 3. 将数据读取逻辑改为可配置根路径
- 修改 `src/tasks-center/data.ts`
- 不再直接使用常量 `TASKS_ROOT_PATH` 作为运行时唯一路径。
- 建议把相关函数改成显式接收 `tasksRootPath` 参数：
  - `getTasksRootFolder(app, tasksRootPath)`
  - `listProjectFolders(app, tasksRootPath)`
  - `listProjectTaskFiles(app, tasksRootPath, projectName)`
- 原因：
  - 这样调用关系清晰，测试也更容易覆盖不同根目录
  - 避免数据层再偷偷依赖全局设置
- `ProjectListResult` / `TaskFileListResult` 里的 `projectPath` 继续返回实际拼接后的路径，便于视图显示空态和错误提示。

### 4. 将创建逻辑改为可配置根路径
- 修改 `src/tasks-center/project-creation.ts`
  - `resolveProjectTargetPath(projectName)` 改为接收 `tasksRootPath`
  - `createProjectFolder(app, projectName)` 改为接收 `tasksRootPath`
- 修改 `src/tasks-center/task-creation.ts`
  - `resolveTaskTargetPath(projectName, fileName)` 改为接收 `tasksRootPath`
  - `CreateTaskFileOptions` 中新增 `tasksRootPath`
  - `createTaskFile(...)` 用传入的根路径拼接项目目录和目标文件路径
- 这样项目创建与任务创建都会落到用户设置的根目录下，而不是固定 `3-任务`。

### 5. 修改视图层 `src/views/iotoTasksCenterView.ts`
- 构造函数新增 `getTasksRootPath: () => string`
- 所有调用以下函数的地方都传入当前根路径：
  - `listProjectFolders(...)`
  - `listProjectTaskFiles(...)`
  - `createProjectFolder(...)`
  - `createTaskFile(...)`
- 视图中所有与根目录相关的文案也改成动态使用当前设置值，例如：
  - “正在扫描 xxx 根目录...”
  - “请先在 vault 中创建 xxx 目录”
  - “正在读取 xxx/项目名 下的 Markdown 文件”
- 与项目数量统计相关的内部调用，例如 `buildProjectIncompleteCounts()`，也要跟着传入当前根路径。

### 6. 处理 `types.ts` 中的常量角色
- 当前 `TASKS_ROOT_PATH` 已不适合作为运行时唯一路径。
- 建议保留一个“默认值”常量，而不是“全局固定路径”常量，例如：
  - `DEFAULT_TASKS_ROOT_PATH = '3-任务'`
- 相关引用文件统一改为：
  - 需要默认值时引用默认常量
  - 需要运行时路径时使用设置值或函数参数
- 这样能保留默认配置语义，同时消除“看似可配置、实际仍有硬编码”的隐患。

### 7. 补充测试
- 现有测试主要覆盖：
  - 排序/隐藏
  - 任务状态
  - 项目创建
  - 任务创建
  - preview 状态
- 本次建议最少补充以下纯逻辑测试：
  - 路径归一化函数测试
  - `resolveProjectTargetPath()` 在自定义根目录下的路径拼接
  - `resolveTaskTargetPath()` 在自定义根目录下的路径拼接
- 如改动了 `data.ts` 的函数签名，也可补一个最小单测覆盖“自定义根目录下 projectPath 拼接正确”，但不强求写高成本 vault mock。

## Assumptions & Decisions
- 用户设置的是 vault 相对路径，不是绝对路径。
- 默认值继续使用 `3-任务`，保证已有用户不配置时行为不变。
- 空字符串或仅空白输入会被归一化回默认值 `3-任务`。
- 本次只做“任务根目录可配置化”，不顺带做多根目录支持、每项目单独根目录或迁移旧目录内容。
- 现有 `hiddenProjectNames` 仍按项目名存储，不因根目录变化而自动清空；它们只会在新根目录下命中同名项目时生效。

## Verification Steps
- 代码层
  - 确认所有原先依赖 `TASKS_ROOT_PATH` 的运行时逻辑都切换为设置值或参数传递
  - 确认 vault 变更监听基于动态根目录，而不是硬编码
  - 确认项目创建和任务创建都使用当前设置的根目录
- 自动化验证
  - 运行 `npm test`
  - 运行 `npm run build`
  - 运行 `npm run lint`
  - 对新增/修改文件执行 diagnostics 检查
- 手动验证
  - 默认不改设置时，任务中心仍正常使用 `3-任务`
  - 在设置中改成其他目录名后，左侧项目列表从新目录读取项目
  - 在新目录下创建项目和任务，确认实际文件/目录落点正确
  - 修改新根目录下的文件后，已打开的任务中心会自动刷新
  - 将设置清空或输入空白，确认会回退为默认 `3-任务`
