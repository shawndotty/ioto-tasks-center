# 根据模板批量创建任务 执行计划

## Summary

为 IOTO Task Center 插件新增“根据用户配置的批量任务模板批量创建任务”的能力。用户在设置中维护若干个批量模板（每个模板是一个 Markdown 列表，支持缩进表示父子关系），通过命令面板或项目右键菜单触发，依次完成「模板选择 → 前缀输入 → 确认预览 → 批量创建」，自动建立父子关系（UpTask）。

本计划基于 [plans/根据模板批量创建任务.md](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/plans/根据模板批量创建任务.md) 方案设计，并结合代码现状做了以下关键决策：

- **任务类型仅支持 `normal` / `topic` / `plan`**：`date` 类型文件名由日期自动生成，不接受 customName，同一批会全部同名冲突，故排除。
- **触发方式仅实现「命令面板 + 项目右键菜单」**：工具栏按钮后续再加。
- **前缀不持久化**：每次批量创建时输入，不写入设置。

## Current State Analysis

### 1. 任务创建核心链路（已存在，可复用）

- [src/tasks-center/task-creation.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-creation.ts)
  - `buildTaskFileName(projectName, type, date, dateTaskDateFormat, customName?)`：按类型生成文件名；`normal/topic/plan` 都使用 `customName`，`date` 忽略 customName。
  - `resolveTaskTargetPath(tasksRootPath, projectName, fileName, targetDirectoryPath?)`：解析最终路径。
  - `createTaskFile(options)`：创建空文件 → 应用模板 → 应用 `Project`/`Subject`/`Plan` 属性，返回 `{ file, created, templaterApplied }`。
  - `normalizeCustomTaskName(input)`：清洗非法文件名字符。
- [src/tasks-center/up-task-assignment.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/up-task-assignment.ts)
  - `assignUpTaskToFile(app, file, parentTaskTitle)`：向子任务文件写入 `UpTask: [[父任务标题]]`。
  - `buildUpTaskWikilink(title)`：构造 wikilink（注意：用的是任务标题，不是路径）。

### 2. 设置层（需扩展）

- [src/settings.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts)
  - `IOTOTasksCenterSettings` 当前不含任何批量模板字段。
  - `DEFAULT_SETTINGS` 需新增默认值。
  - `IOTOTasksCenterSettingTab.display()` 使用 `TabbedSettings`，当前有 3 个 tab：`basic` / `taskTypes` / `taskTemplates`。
  - 已有 `renderTaskTemplateSettings()` 作为“每个类型一块设置卡片”的参考样式。

### 3. 视图层（需扩展）

- [src/views/iotoTasksCenterView.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)
  - 构造函数通过大量 getter/setter 回调与插件通信（见 main.ts 的 `registerView`）。
  - `showProjectContextMenu(event, project)`：项目右键菜单当前只有“编辑规范/存档”，需在此追加“批量创建任务”。
  - `handleCreateTask(type)` 和 `handleCreateSubtask(parentTask, type)` 是现有创建流程的参考样板（含 previewLeaf、Templater、刷新逻辑）。
  - `selectedProject` / `projects` 字段可用于批量入口的前置校验。

### 4. 插件入口（需扩展）

- [src/main.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts)
  - `onload()` 中通过 `this.addCommand(...)` 注册命令。
  - `registerView(IOTO_TASKS_CENTER_VIEW_TYPE, ...)` 向视图注入回调；要新增「批量模板列表 getter」与「批量模板更新方法」两个回调。
  - `loadSettings()` 中对每个字段做 normalize，需新增批量模板的 normalize。

### 5. 弹窗与 i18n（需新增/扩展）

- [src/ui/confirmModal.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/confirmModal.ts)：`ConfirmModal` 只支持纯文本描述，预览列表需自定义弹窗。
- [src/ui/taskCreationModal.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/taskCreationModal.ts) / [src/ui/taskNameModal.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/taskNameModal.ts)：Promise-based Modal 的标准范式（`openAndGetValue()` + `resolvePromise` + `isResolved`）。
- [src/lang/helpter.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/helpter.ts)：`t(key, args?)`，key 必须存在于 en.ts。
- 三份 locale：[en.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts) / [zh-cn.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts) / [zh-tw.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts)。

### 6. 测试约定

- 测试位于 `tests/*.test.mjs`，使用 `node:test` + `jiti` 直接 import `.ts` 源码（见 [tests/task-creation.test.mjs](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/task-creation.test.mjs)）。
- 纯函数（解析、命名、normalize）必须配测试。

---

## Proposed Changes

### Step 1: 新增批量模板数据结构与纯函数模块

**新增文件**：`src/tasks-center/batch-task-template.ts`

职责：类型定义 + 列表解析 + normalize + CRUD 辅助。

```typescript
import type { TaskCreationType } from './task-template-config';

// 批量模板支持的任务类型（排除 date）
export const BATCH_TASK_TYPES: readonly TaskCreationType[] = ['normal', 'topic', 'plan'] as const;
export type BatchTaskType = (typeof BATCH_TASK_TYPES)[number];

export interface BatchTaskTemplate {
  id: string;           // 唯一标识
  name: string;         // 显示名称
  taskType: BatchTaskType;
  listContent: string;  // Markdown 列表
}

export interface BatchTemplateConfig {
  enabled: boolean;
  templates: BatchTaskTemplate[];
}

// 解析后的单条任务
export interface BatchTaskItem {
  name: string;                 // 清洗后的任务名（不含前缀）
  level: number;                // 0 = 顶级
  parentIndex: number | null;   // 父项在数组中的索引
}

export const DEFAULT_BATCH_TEMPLATE_CONFIG: BatchTemplateConfig = {
  enabled: false,
  templates: [],
};

// 生成唯一 id（crypto.randomUUID 不可用时回退）
export function createBatchTemplateId(): string;

// 解析 Markdown 列表为 BatchTaskItem[]
export function parseBatchList(content: string): BatchTaskItem[];

// 将 BatchTaskItem[] 还原为缩进预览文本（用于确认弹窗）
export function formatBatchItemsForPreview(
  items: BatchTaskItem[],
  prefix: string,
): string[];

// 应用前缀
export function applyPrefix(name: string, prefix: string): string;

// normalize 整个配置（用于 loadSettings 与 UI 编辑）
export function normalizeBatchTemplateConfig(input: unknown): BatchTemplateConfig;

// 校验单个模板是否有效（name 非空 + listContent 能解析出至少 1 条）
export function isBatchTemplateValid(template: BatchTaskTemplate): boolean;
```

**解析规则**（`parseBatchList`）：
- 仅匹配 `^\s*-\s+(.+)$` 的行。
- 缩进层级 = `前导空格数 / 2`（向下取整）；tab 按 2 空格折算。
- `parentIndex`：向上找第一个 `level < 当前行 level` 的行。
- 任务名 `trim()`，空名行忽略。
- 空行与非列表行忽略。

**前缀规则**（`applyPrefix`）：直接字符串拼接 `prefix + name`，prefix 不强制带分隔符（由用户输入决定）。

**测试要求**：在 `tests/batch-task-template.test.mjs` 覆盖：
- 平级列表 / 多层缩进 / tab 与空格混用 / 空行与文本行忽略 / 空内容 / 仅一级父子 / 多级嵌套的 parentIndex。
- `applyPrefix` 空前缀与非空前缀。
- `normalizeBatchTemplateConfig` 对未知字段、缺失 enabled、非法 taskType 的回退。

---

### Step 2: 扩展设置层

**修改文件**：[src/settings.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts)

1. `IOTOTasksCenterSettings` 新增字段：
   ```typescript
   batchTemplateConfig: BatchTemplateConfig;
   ```
2. `DEFAULT_SETTINGS` 新增：
   ```typescript
   batchTemplateConfig: { ...DEFAULT_BATCH_TEMPLATE_CONFIG },
   ```
3. 新增 normalize 导出：`normalizeBatchTemplateConfig`（从 step 1 模块 re-export 或在本文件写薄包装）。

**修改文件**：[src/main.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts)

1. `loadSettings()` 末尾追加：
   ```typescript
   this.settings.batchTemplateConfig = normalizeBatchTemplateConfig(
     loadedData?.batchTemplateConfig,
   );
   ```
2. 新增方法：
   ```typescript
   async updateBatchTemplateConfig(config: BatchTemplateConfig): Promise<void>
   ```
   逻辑：比较 → 赋值 → `saveSettings()` → `applySettingsToOpenViews()`。
3. `registerView(IOTO_TASKS_CENTER_VIEW_TYPE, ...)` 的视图构造参数末尾追加两个回调：
   - `() => this.settings.batchTemplateConfig`（getter）
   - `(config) => this.updateBatchTemplateConfig(config)`（不需要，视图只读不写设置；命令入口在 main.ts 直接处理）

   **决策**：批量创建命令的「模板选择/前缀/确认」流程需要访问当前 `selectedProject`，而 `selectedProject` 只存在于视图实例中。因此：
   - 视图暴露一个公开方法 `triggerBatchCreateFromTemplate()`，内部读取自己的 `selectedProject`，并调用注入的 `getBatchTemplateConfig()` 与 `createTaskFile`。
   - main.ts 的命令 callback 通过 `getOrCreateIOTOTasksCenterLeaf()` 找到视图实例并调用该方法。

---

### Step 3: 新增批量创建弹窗（3 个 Modal）

**新增文件**：`src/ui/batchTaskModals.ts`

统一放置三个 Promise-based Modal，遵循 [taskCreationModal.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/taskCreationModal.ts) 的范式。

#### 3.1 `BatchTemplateSelectModal`
- 入参：`templates: BatchTaskTemplate[]`。
- 渲染：标题 + 描述 + 每个 template 一行（名称 + 任务类型标签），点击选中并关闭。
- 返回：`Promise<BatchTaskTemplate | null>`。

#### 3.2 `BatchPrefixModal`
- 基于 `TaskNameModal` 的样式，单行输入。
- 入参：默认描述、确认按钮文案。
- 返回：`Promise<string | null>`（null 表示取消；空字符串视为无前缀，允许确认）。
- **注意**：与 `TaskNameModal` 不同，允许返回空字符串 → 在 modal 内部区分「取消（返回 null）」与「留空确认（返回 ''）」。

#### 3.3 `BatchCreateConfirmModal`
- 入参：`templateName`、`prefix`、`projectName`、`items: BatchTaskItem[]`、`totalCount`。
- 渲染：标题 + 摘要（模板/前缀/项目/总数）+ 预览列表（按 `level` 缩进展示 `applyPrefix(name, prefix)`）+ 取消/确认按钮。
- 返回：`Promise<boolean>`（直接复用 `ConfirmModal` 的 resolve 模式）。

---

### Step 4: 视图层实现批量创建流程

**修改文件**：[src/views/iotoTasksCenterView.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)

1. 构造函数新增依赖：
   ```typescript
   private readonly getBatchTemplateConfig: () => BatchTemplateConfig;
   ```
   并在 main.ts `registerView` 中传入 `() => this.settings.batchTemplateConfig`。

2. 新增公开方法 `triggerBatchCreateFromTemplate(): Promise<void>`，编排整个流程：

   ```
   1. 校验 selectedProject 存在且在 projects 中
   2. 读取 getBatchTemplateConfig()
      - enabled === false → Notice 提示未启用，return
      - templates 为空 → Notice 提示无模板，return
   3. 弹 BatchTemplateSelectModal → 取得 template（null 则中止）
   4. 弹 BatchPrefixModal → 取得 prefix（null 则中止）
   5. parseBatchList(template.listContent) → items
      - items 为空 → Notice 提示模板内容为空，return
   6. 弹 BatchCreateConfirmModal → confirmed（false 则中止）
   7. 执行批量创建（见下）
   ```

3. 新增私有方法 `executeBatchCreate(template, prefix, items): Promise<void>`：

   ```
   - 设置 isCreatingTask = true，render()
   - 取得 previewLeaf = this.ensurePreviewLeaf()
   - 顺序遍历 items（必须串行，因为父子关系依赖父文件已创建）：
     for (let i = 0; i < items.length; i++):
       const item = items[i]
       const fullName = applyPrefix(item.name, prefix)
       const result = await createTaskFile({
         app, tasksRootPath, projectName: selectedProject,
         type: template.taskType,
         customName: fullName,
         templateConfig: getTaskTemplateConfig(template.taskType),
         dateTaskDateFormat,
         targetLeaf: previewLeaf,
         sourceLeaf: this.leaf,
       })
       // 建立父子关系
       if (item.parentIndex !== null):
         const parentItem = items[item.parentIndex]
         const parentFullName = applyPrefix(parentItem.name, prefix)
         // 父任务的 title 即文件 basename（无 .md）
         await assignUpTaskToFile(this.app, result.file, parentFullName)
       // 记录最后一个任务的路径用于预览
   - 完成后：
       - this.previewLeaf = previewLeaf
       - await this.refreshFromVaultChange()
       - 打开最后一个创建的任务（或第一个，二选一；建议第一个顶级任务）
       - Notice 成功提示（创建数量）
   - catch: Notice 错误
   - finally: isCreatingTask = false, render()
   ```

   **关键细节**：
   - **父任务标题来源**：`assignUpTaskToFile` 接收的是「任务标题」（写入 `UpTask: [[标题]]`）。任务标题 = 文件 basename（无扩展名）。对于 `normal` 类型 = `fullName`；对于 `topic`/`plan` 类型 = `${projectName}-${typeLabel}-${fullName}`。
     - 为避免在视图层重复构造文件名规则，**推荐**在 `batch-task-template.ts` 中导出一个辅助函数 `buildBatchTaskTitleForUpTask(projectName, taskType, fullName)`，内部调用现有的 `buildTaskFileName` 后去掉 `.md`，保证与实际文件标题一致。
   - **串行执行**：因 Templater 路径会切换活动 leaf，并发会导致竞争；现有 `createTaskFile` 本身就是为单次调用设计。
   - **部分失败处理**：单个任务创建失败时 `Notice` 提示并 `continue`（不中断整批），但子任务因父任务缺失会导致 `assignUpTaskToFile` 失败 → 在该处 try/catch 单独提示。

4. 项目右键菜单 `showProjectContextMenu(event, project)` 追加菜单项：
   ```typescript
   menu.addItem((item) =>
     item.setTitle(t('view.projectMenu.batchCreateTasks')).onClick(() => {
       // 切换到该项目再触发
       void this.selectProject(project.name).then(() =>
         this.triggerBatchCreateFromTemplate(),
       );
     }),
   );
   ```
   - 仅当 `getBatchTemplateConfig().enabled && templates.length > 0` 时显示（否则菜单项隐藏或 disabled）。

---

### Step 5: 命令面板入口

**修改文件**：[src/main.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts)

在 `onload()` 中新增命令：

```typescript
this.addCommand({
  id: 'batch-create-tasks-from-template',
  name: t('command.batchCreateTasksFromTemplate'),
  callback: () => {
    const leaf = this.app.workspace.getLeavesOfType(IOTO_TASKS_CENTER_VIEW_TYPE)[0];
    const view = leaf?.view;
    if (view instanceof IOTOTasksCenterView) {
      void view.triggerBatchCreateFromTemplate();
      return;
    }
    // 视图未打开时先激活再触发
    void this.activateIOTOTasksCenterView().then(() => {
      const leaf = this.app.workspace.getLeavesOfType(IOTO_TASKS_CENTER_VIEW_TYPE)[0];
      const view = leaf?.view;
      if (view instanceof IOTOTasksCenterView) {
        void view.triggerBatchCreateFromTemplate();
      }
    });
  },
});
```

---

### Step 6: 设置 UI — 新增「批量任务模板」标签页

**修改文件**：[src/settings.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts)

在 `display()` 中新增第 4 个 tab：

```typescript
tabbedSettings.addTab(t('settings.tabs.batchTemplates'), (containerEl) => {
  this.renderBatchTemplateSettings(containerEl);
});
```

新增私有方法 `renderBatchTemplateSettings(containerEl)`：

1. 启用开关（toggle）→ `updateBatchTemplateConfig({ enabled, templates })`。
2. 标题 + 描述。
3. 模板列表：遍历 `this.plugin.settings.batchTemplateConfig.templates`，每项一行：
   - 显示 `name` + `taskType` 标签。
   - 「编辑」按钮 → 打开 `BatchTemplateEditModal`（见下）。
   - 「删除」按钮 → 二次确认（复用 `ConfirmModal`）后从 templates 移除并保存。
4. 「+ 添加新模板」按钮 → 打开 `BatchTemplateEditModal`（空模板）。

**新增文件**：`src/ui/batchTemplateEditModal.ts`

`BatchTemplateEditModal`：
- 字段：`name`（TextComponent）、`taskType`（Dropdown，仅 `normal/topic/plan`）、`listContent`（TextArea）。
- 实时校验：name 非空、listContent 能解析出 ≥1 条。
- 返回 `Promise<BatchTaskTemplate | null>`（保存时带上 id；新增时用 `createBatchTemplateId()`）。
- 提供「取消 / 保存」按钮。

---

### Step 7: i18n 文案

**修改文件**（三份 locale，en.ts 为基准）：
- [src/lang/locale/en.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)
- [src/lang/locale/zh-cn.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts)
- [src/lang/locale/zh-tw.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts)

新增 key（示例，以 en 为准，zh-cn/zh-tw 对应翻译）：

```
'command.batchCreateTasksFromTemplate': 'Batch create tasks from template'
'settings.tabs.batchTemplates': 'Batch Templates'
'settings.batchTemplates.heading': 'Batch Task Templates'
'settings.batchTemplates.enabled.name': 'Enable batch templates'
'settings.batchTemplates.enabled.desc': 'When enabled, you can batch-create tasks from a Markdown list template.'
'settings.batchTemplates.empty': 'No batch templates yet. Click "Add template" to create one.'
'settings.batchTemplates.add': 'Add template'
'settings.batchTemplates.edit': 'Edit'
'settings.batchTemplates.delete': 'Delete'
'settings.batchTemplates.deleteConfirm.title': 'Delete batch template'
'settings.batchTemplates.deleteConfirm.desc': 'Delete the template "{0}"? This cannot be undone.'
'settings.batchTemplates.deleteConfirm.confirm': 'Delete'
'settings.batchTemplates.editModal.title.new': 'New batch template'
'settings.batchTemplates.editModal.title.edit': 'Edit batch template'
'settings.batchTemplates.editModal.name': 'Template name'
'settings.batchTemplates.editModal.taskType': 'Task type'
'settings.batchTemplates.editModal.content': 'Template content (Markdown list)'
'settings.batchTemplates.editModal.contentPlaceholder': '- First task\n    - Sub task\n- Second task'
'settings.batchTemplates.editModal.invalid': 'Template name cannot be empty and content must contain at least one list item.'
'view.projectMenu.batchCreateTasks': 'Batch create tasks'
'modal.batchSelect.title': 'Select a batch template'
'modal.batchSelect.desc': 'Choose a template to batch-create tasks under the current project.'
'modal.batchSelect.empty': 'No templates available. Please configure one in settings first.'
'modal.batchPrefix.title': 'Task name prefix (optional)'
'modal.batchPrefix.desc': 'Add a prefix to every task name in this batch. Leave empty to skip.'
'modal.batchPrefix.placeholder': 'e.g. Sprint1-'
'modal.batchConfirm.title': 'Confirm batch creation'
'modal.batchConfirm.summary': 'Template: {0} | Prefix: {1} | Project: {2}'
'modal.batchConfirm.count': 'Will create {0} task(s):'
'modal.batchConfirm.confirm': 'Create'
'notice.batchCreate.disabled': 'Batch templates are disabled. Enable them in settings first.'
'notice.batchCreate.noTemplates': 'No batch templates configured.'
'notice.batchCreate.emptyContent': 'The selected template has no list items.'
'notice.batchCreate.success': 'Created {0} task(s).'
'notice.batchCreate.partialFail': 'Created {0} task(s); {1} failed.'
'notice.batchCreate.failed': 'Batch creation failed: {0}'
'notice.batchCreate.parentAssignFailed': 'Failed to link subtask "{0}" to its parent.'
```

---

### Step 8: 测试

**新增文件**：`tests/batch-task-template.test.mjs`

参照 [tests/task-creation.test.mjs](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/task-creation.test.mjs) 的 `node:test` + `jiti` 模式。

覆盖：
- `parseBatchList`：平级 / 多层 / tab+空格 / 空行过滤 / 非列表行过滤 / 空 content。
- `applyPrefix`：空 / 非空。
- `normalizeBatchTemplateConfig`：合法 / 缺字段 / 非法 taskType（回退 normal）/ templates 非数组。
- `isBatchTemplateValid`：空 name / 空 content / 合法。
- `buildBatchTaskTitleForUpTask`：三种类型与 `buildTaskFileName` 的一致性（去 `.md`）。

---

## Assumptions & Decisions

1. **任务类型限制**：批量模板 `taskType` 仅 `normal/topic/plan`，UI 下拉不出现 `date`。理由见 Summary。
2. **前缀不持久化**：每次调用时输入。
3. **父子关系建立方式**：子任务创建后立即调用 `assignUpTaskToFile(file, parentTitle)`，其中 `parentTitle` 由 `buildBatchTaskTitleForUpTask` 计算（= 父文件 basename）。依赖**串行创建**保证父文件已存在。
4. ** Templater 兼容**：复用 `createTaskFile` 的既有 Templater 执行链路；批量场景下因串行执行，不会出现 leaf 竞争。
5. **部分失败策略**：单个任务创建失败不中断整批，但父子链接失败单独 Notice；最终 Notice 汇总成功/失败计数。
6. **视图未打开时**：命令先 `activateIOTOTasksCenterView()` 再触发；若仍无视图实例则静默失败（理论上 activate 后必存在）。
7. **不引入新依赖**：全部基于 Obsidian API + 现有工具函数。
8. **设置 tab 顺序**：basic → taskTypes → taskTemplates → **batchTemplates**（新增放最后）。
9. **id 生成**：优先 `crypto.randomUUID()`，回退 `Date.now() + Math.random()`。

---

## Verification

1. **单元测试**：
   ```bash
   npm test -- --test-name-pattern="batch"
   ```
   （或直接 `node --test tests/batch-task-template.test.mjs`，按现有脚本约定执行）
2. **构建**：
   ```bash
   npm run build
   ```
   确保 `main.js` 生成且无 TS 报错。
3. **Lint**：
   ```bash
   npm run lint
   ```
4. **手动验证**（在 Obsidian 中）：
   - 设置 → 启用批量模板 → 新增一个含多级缩进的模板（如方案中的入职 SOP）。
   - 任务中心选中项目 → 命令面板执行「批量创建任务」→ 选模板 → 输入前缀 → 确认 → 验证：
     - 文件按预期命名生成在项目目录下。
     - 子任务文件的 frontmatter 含 `UpTask: [[父任务标题]]`。
     - 视图刷新后能看到层级关系。
   - 项目右键菜单出现「批量创建任务」项；未启用/无模板时不出现。
   - 重复执行同名前缀 → 因 `createTaskFile` 检测到同名文件会 Notice「文件已存在」并跳过，不报错中断。
