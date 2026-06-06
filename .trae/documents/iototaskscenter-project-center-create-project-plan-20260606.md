# Project Center 新建项目按钮 - 开发计划（2026-06-06）

## Summary

在 **项目中心（Project Center）** 顶部右上角的操作区（刷新按钮附近）新增一个 **“新建项目”** 按钮，用于在任务根目录下创建新的一级项目文件夹，并在创建后自动刷新项目中心表格。

## Current State Analysis

- Project Center 视图实现： [iotoProjectCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoProjectCenterView.ts)
  - 顶部操作区目前只有刷新按钮：`ioto-project-center__actions` + `refresh-cw` 图标按钮。
  - 项目列表来自 `listProjectFolders(this.app, tasksRootPath)`。
- 已存在项目创建能力（任务中心侧边栏“+”）：
  - 创建目录逻辑： [createProjectFolder](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/project-creation.ts#L28-L63)
  - 输入弹窗： [TaskNameModal](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/taskNameModal.ts)
  - 相关文案 key 已存在（可复用）：
    - `modal.newProject.*`、`modal.create`
    - `view.notice.projectAlreadyExists`、`view.notice.createProjectFailed`
- 样式：
  - Project Center 顶部按钮使用 `.ioto-project-center__icon-button`，适合复用以保持 UI 一致。

## Proposed Changes

### 1) Project Center 顶部新增“新建项目”按钮

修改文件： [iotoProjectCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoProjectCenterView.ts)

- 在 `render()` 的 `ioto-project-center__actions` 内新增一个按钮，位置在刷新按钮右侧（符合“右上方/刷新按钮旁”要求）。
- 按钮形态：
  - class：`ioto-project-center__icon-button`
  - icon：`plus`（使用 `setIcon`）
  - ariaLabel/title：新增 i18n key（见下文）或复用 `view.projectsPane.addProject`（更偏任务中心语义，建议新增更准确的 Project Center 文案）。
- 可用性：
  - 当 `status === 'root-missing'` 或 `status === 'loading'` 时禁用（避免错误交互）。

### 2) 新建流程与异常处理

修改文件： [iotoProjectCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoProjectCenterView.ts)

- 点击按钮后：
  1. 打开 `TaskNameModal`，复用现有文案：
     - title: `t('modal.newProject.title')`
     - placeholder: `t('modal.newProject.placeholder')`
     - description: `t('modal.newProject.desc')`
     - confirmButtonText: `t('modal.create')`
  2. 用户取消则直接返回。
  3. 调用 `createProjectFolder(this.app, tasksRootPath, projectName)` 创建项目文件夹。
  4. 处理创建结果：
     - `created === false`：`new Notice(t('view.notice.projectAlreadyExists'))`
  5. 成功/已存在都执行 `refreshFromVaultChange()`，确保表格出现/选中（本期仅刷新，不做额外滚动定位）。
- 异常：
  - 捕获 Error，`new Notice(error.message)`；否则 fallback 使用新增 i18n key（见下文）。

### 3) i18n 文案补齐（新增最小集合）

修改文件：
- [zh-cn.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts)
- [en.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)
- [zh-tw.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts)

新增 key（建议）：
- `projectCenter.action.createProject`：按钮 ariaLabel/title（例如 “新建项目” / “Create project”）
- `projectCenter.notice.createProjectFailed`：创建失败的通用 fallback（当 error 非 Error 或 message 不可用时使用）

说明：弹窗与“已存在”提示复用既有 key，减少重复文案。

### 4) 测试与验证

#### 单元测试（Node）

优先复用已有 `tests/project-creation.test.mjs` 覆盖创建逻辑，本次新增内容主要是 UI 组合；因此单测建议最小化：

- 可选：新增一个轻量测试校验 i18n key 存在（如果已有类似模式则复用；否则不新增）。

#### 手工验收（Obsidian 内）

- 打开 **项目中心**
- 顶部右侧出现 “+” 新建按钮（在刷新按钮右侧）
- 点击后弹出“新建项目”输入框：
  - 输入新名称 → 创建成功 → 表格出现该项目行，任务数量为 0
  - 输入已存在名称 → 提示“该项目已存在…” → 表格刷新不报错
- 当任务根目录不存在时：
  - Project Center 显示 root missing 状态
  - 新建按钮禁用

## Assumptions & Constraints

- “新建项目”语义与任务中心一致：创建 `${tasksRootPath}/${projectName}` 一级文件夹。
- 本期仅要求“创建并刷新”，不额外实现创建后自动定位/高亮新行（可后续增强）。

