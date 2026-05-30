# IOTOTasksCenter 视图实现计划

## Summary

为插件新增一个全新的 Obsidian 自定义视图类型 `IOTOTasksCenter`，默认通过命令面板在主编辑区标签页打开。视图采用响应式双栏布局：左侧展示 `3-任务` 根目录下的一级项目文件夹列表，右侧根据当前选中项目动态展示该目录下的 Markdown 任务文件列表。实现需覆盖加载态、空态、目录不存在场景，以及 vault 文件变化后的自动刷新逻辑。

## Current State Analysis

- 当前源码只有 `src/main.ts` 与 `src/settings.ts`，仍是 sample plugin 结构。
- `src/main.ts` 目前仅包含示例 Ribbon、状态栏、Modal、编辑器命令与设置注册，没有 `ItemView`、`registerView`、`WorkspaceLeaf` 等自定义视图实现。
- `src/settings.ts` 仅包含示例设置页，与任务中心功能无直接关系。
- `styles.css` 仍是模板注释，没有任何视图样式。
- 当前代码中没有 vault 目录扫描、文件过滤、文件元数据读取、或 vault 文件变化监听逻辑。
- 构建方式为 TypeScript + esbuild，`tsconfig.json` 开启 `strict` 与 `noUncheckedIndexedAccess`，计划中的类型设计需完整、显式。

## Assumptions & Decisions

- 视图唯一标识符固定为 `IOTOTasksCenter`。
- 命令面板执行时优先复用已打开的同类型视图叶子；若不存在，则在主编辑区创建新的标签页叶子并激活。
- 根目录路径固定为 `3-任务`，不通过设置项配置。
- 左侧项目列表仅加载 `3-任务` 下的一级子文件夹，不递归，不显示文件。
- 右侧任务列表仅加载 `3-任务/[项目名]` 下的一级 Markdown 文件，不递归进入更深层子目录。
- 右侧任务列表按“基础元数据”展示：文件标题（`basename`）、相对路径、最后修改时间；不展示正文摘要。这一项以当前确认的偏好为准，覆盖最初“显示摘要”的默认设想。
- 默认选中逻辑采用“首个项目自动选中”；若列表为空则直接显示空状态。
- vault 变化适配范围包括：`create`、`delete`、`rename`、`modify`。其中：
  - 影响 `3-任务` 根目录结构的变更需要刷新左侧项目列表；
  - 影响当前选中项目目录内 Markdown 文件的变更需要刷新右侧任务列表；
  - 若当前选中项目被删除或重命名后不再存在，自动回退到新的首个项目或空状态。
- 本次实现不包含任务项点击打开文件、不包含搜索/排序切换、不改动设置页。

## Proposed Changes

### 1. `src/main.ts`

**做什么**

- 移除 sample plugin 的示例命令、示例 Modal、全局点击通知、定时器、示例 Ribbon/状态栏逻辑。
- 保留插件生命周期与设置加载/保存的基础结构。
- 注册自定义视图类型 `IOTOTasksCenter`。
- 新增一个命令，例如“打开任务中心视图”，用于从命令面板唤起该视图。
- 实现 `activateIOTOTasksCenterView()`，负责查找/创建主编辑区叶子并切换到该视图。
- 注册 vault 事件监听，并把刷新信号传递给已打开的 `IOTOTasksCenterView` 实例。
- 在 `onunload()` 中显式分离已打开视图或依赖 Obsidian 自动清理注册项。

**为什么**

- `main.ts` 应保持为最小生命周期入口，负责视图注册、命令入口与应用级事件桥接。

**怎么做**

- 引入 `WorkspaceLeaf`、视图常量、以及新的视图类。
- 使用 `this.registerView(VIEW_TYPE, (leaf) => new IOTOTasksCenterView(leaf, this.app))` 注册视图。
- 使用 `this.addCommand()` 注册稳定命令 ID，例如 `open-ioto-tasks-center-view`。
- 激活逻辑中先查找 `this.app.workspace.getLeavesOfType(VIEW_TYPE)`，若已有则复用；否则调用 `this.app.workspace.getLeaf(true)` 创建新标签叶子，再执行 `setViewState({ type: VIEW_TYPE, active: true })`。
- 通过 `this.registerEvent(this.app.vault.on(...))` 监听 vault 变化，并遍历当前 `getLeavesOfType(VIEW_TYPE)`，调用每个视图的刷新方法。

### 2. `src/views/iotoTasksCenterView.ts`

**做什么**

- 新增 `ItemView` 实现，承载整个双栏 UI、渲染逻辑、选中态、加载态和空态。
- 维护当前状态：项目列表、当前选中项目、任务列表、是否加载中、当前错误/空态信息。
- 渲染左栏项目列表与右栏任务列表。
- 响应左栏点击切换选中项目，并加载对应目录的 Markdown 文件元数据。
- 提供公开刷新方法供 `main.ts` 在 vault 变化时调用。

**为什么**

- 自定义视图的 DOM 与交互逻辑应封装在独立模块，避免 `main.ts` 变大，也符合当前仓库的模块化要求。

**怎么做**

- 定义视图常量导出，例如 `export const IOTO_TASKS_CENTER_VIEW_TYPE = 'IOTOTasksCenter'`。
- 视图类继承 `ItemView`，实现 `getViewType()`、`getDisplayText()`、`onOpen()`、`onClose()`。
- `onOpen()` 中构建基础 DOM 容器：
  - 最外层根容器；
  - 左侧项目栏；
  - 右侧任务栏；
  - 两侧标题或说明区域；
  - 内容列表容器。
- 内部实现以下方法：
  - `loadProjects()`：读取 `3-任务` 根目录并生成项目列表。
  - `selectProject(projectName: string)`：更新选中状态并触发任务加载。
  - `loadTasks(projectName: string)`：读取 `3-任务/[projectName]` 目录下的 Markdown 文件元数据。
  - `renderProjects()`：绘制左栏列表，给当前项添加选中样式类。
  - `renderTasks()`：绘制右栏任务列表、加载态、空态、目录不存在提示。
  - `refreshFromVaultChange()`：根据当前状态重新加载项目及任务，并尽量保留选中项。
- 交互流程：
  - 视图首次打开时先加载项目列表；
  - 若有项目则自动选中第一项，并加载右侧任务；
  - 点击左栏任一项目后，切换选中态并刷新右栏。
- 状态消息明确区分：
  - `3-任务` 根目录不存在；
  - 根目录存在但无项目文件夹；
  - 选中项目目录不存在；
  - 选中项目目录存在但无 Markdown 任务文件；
  - 正在加载项目或任务。

### 3. `src/tasks-center/data.ts`

**做什么**

- 新增纯数据访问模块，封装 vault 扫描与文件过滤逻辑。
- 提供项目列表与任务列表的读取函数，避免视图类直接堆积文件系统细节。

**为什么**

- 目录扫描与视图渲染分离后，更利于测试、维护和后续扩展，例如增加排序、过滤、摘要解析等。

**怎么做**

- 定义并导出函数：
  - `getTasksRootFolder(app: App): TFolder | null`
  - `listProjectFolders(app: App): ProjectFolderEntry[]`
  - `listProjectTaskFiles(app: App, projectName: string): TaskFileEntryResult`
- `getTasksRootFolder()` 使用 `app.vault.getAbstractFileByPath('3-任务')` 获取根目录，并校验是否为 `TFolder`。
- `listProjectFolders()` 仅遍历根目录的 `children`，筛选 `TFolder`，按名称排序后返回。
- `listProjectTaskFiles()` 拼接 `3-任务/${projectName}`，仅筛选一级 `TFile` 且扩展名为 `md`，按修改时间倒序或文件名升序返回。这里明确采用“最后修改时间倒序”，便于右侧更贴近最近任务。
- 返回结构中显式区分：
  - 根目录不存在；
  - 项目目录不存在；
  - 目录存在但无文件；
  - 成功返回文件列表。

### 4. `src/tasks-center/types.ts`

**做什么**

- 新增共享类型定义，约束视图状态与数据访问模块的返回结构。

**为什么**

- 当前工程使用严格 TypeScript，显式类型能避免视图层大量空值分支散落。

**怎么做**

- 定义类型：
  - `ProjectFolderEntry`
  - `TaskFileEntry`
  - `TaskListState` 或 `TaskFileEntryResult`
  - `ProjectListState`
- `TaskFileEntry` 至少包含：
  - `name`
  - `basename`
  - `path`
  - `mtime`
  - `ctime`
  - `size`

### 5. `styles.css`

**做什么**

- 新增 `IOTOTasksCenter` 视图样式，覆盖双栏布局、响应式行为、选中态、加载态、空态与任务列表卡片样式。

**为什么**

- 当前样式文件为空，必须补齐视觉层实现，才能满足“双栏布局”“选中态可识别”“不同窗口尺寸下正常显示”的需求。

**怎么做**

- 添加独立命名空间类，避免污染全局，例如：
  - `.ioto-tasks-center`
  - `.ioto-tasks-center__projects`
  - `.ioto-tasks-center__tasks`
  - `.is-selected`
  - `.is-empty`
  - `.is-loading`
- 布局策略：
  - 宽屏下使用 CSS Grid 或 Flex 双栏布局，左栏固定比例宽度，例如 `minmax(220px, 28%)`，右栏自适应；
  - 窄屏下切换为单栏堆叠布局，保证移动端或小窗口可用；
  - 左栏列表项提供 hover 与 selected 样式；
  - 右栏任务项采用简洁列表卡片样式，展示文件名、路径、时间元数据。

### 6. `src/settings.ts`

**做什么**

- 本次不新增设置功能，原则上保持不动。

**为什么**

- 用户需求中没有要求任何可配置项；根目录名称、视图行为都已在本轮确认中固定。

**怎么做**

- 如果实现过程中发现示例设置页会造成明显干扰，可在执行阶段一并删除或简化；否则先保持现状，避免引入无关改动。

## Data Flow

1. 用户通过命令面板执行“打开任务中心视图”。
2. 插件入口复用或创建主编辑区叶子，并切换到 `IOTOTasksCenter` 视图。
3. 视图 `onOpen()` 调用 `loadProjects()`。
4. `loadProjects()` 通过数据模块读取 `3-任务` 根目录的一级子文件夹。
5. 若存在项目，视图自动选中首个项目并调用 `loadTasks(selectedProject)`。
6. `loadTasks()` 拼接目录 `3-任务/[项目名]`，加载其中一级 Markdown 文件，并把元数据渲染到右栏。
7. 用户点击左栏其他项目时，视图切换选中状态并重新执行步骤 6。
8. vault 文件发生变化时，插件入口通知所有打开的任务中心视图刷新；视图重新拉取目录数据，并尽量保留当前选中项目。

## Edge Cases & Failure Modes

- `3-任务` 根目录不存在：左栏显示明确提示，右栏不显示任务列表。
- `3-任务` 根目录存在但没有一级子文件夹：左栏显示“暂无项目”，右栏显示引导提示。
- 当前选中项目目录不存在：右栏显示“项目目录不存在”，同时尝试回退到新的有效项目。
- 当前选中项目目录存在但没有 Markdown 文件：右栏显示“暂无任务文件”。
- 当前项目目录中存在非 Markdown 文件：忽略，不渲染。
- vault 中发生重命名：
  - 若重命名的是项目目录，需要刷新项目列表并重新校正选中项；
  - 若重命名的是当前项目内任务文件，需要刷新右栏任务列表。
- 快速连续文件变更：执行阶段可根据复杂度决定是否增加轻量去抖；默认先用直接刷新实现，确保正确性优先。

## Verification Steps

### 构建与静态检查

- 运行类型检查/构建，确保新增模块在严格 TypeScript 下通过。
- 运行 lint，确认没有新增明显风格或类型问题。
- 对最近编辑文件执行诊断检查，确认没有 IDE 级错误。

### 功能验证

- 启用插件后，在命令面板中执行“打开任务中心视图”，确认主编辑区成功打开 `IOTOTasksCenter` 标签页。
- 在 vault 中存在 `3-任务` 根目录且含多个一级项目目录时，确认左栏完整展示全部项目且无误加载文件或更深层目录。
- 首次打开视图时确认默认自动选中首个项目，右栏同步渲染该项目下的 Markdown 文件。
- 点击不同项目时，确认右栏立即切换到 `3-任务/[项目名]` 对应任务列表，路径拼接正确。
- 删除、创建、重命名 `3-任务` 下项目目录时，确认左栏自动刷新，且当前选中项处理正确。
- 在当前项目目录中新增、删除、重命名 Markdown 文件时，确认右栏自动刷新。

### 边界验证

- `3-任务` 不存在时，确认视图显示友好提示且无控制台异常。
- 选中项目目录为空时，确认右栏显示空状态提示。
- 存在非 Markdown 文件时，确认不会被错误显示为任务。
- 缩放 Obsidian 窗口或在窄宽度下打开视图时，确认布局仍可读、不会溢出或重叠。
