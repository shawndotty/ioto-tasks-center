# 批量模板支持按层级指定任务类型 执行计划

## Summary

将批量任务模板从「单一 `taskType`（所有层级共用）」升级为「`levelTaskTypes`（按层级分别指定，最多 3 级）」。批量创建时，每个任务根据自身 `level` 解析出对应的任务类型，用于文件名生成、模板应用与父子关系链接。同时编辑弹窗、模板选择弹窗、确认预览弹窗均需适配展示各层级类型。

本计划严格遵循 [plans/批量创建任务时，给不同层级的任务指定不同的模板.md](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/plans/批量创建任务时，给不同层级的任务指定不同的模板.md) 方案设计。

### 关键决策（来自方案 + 代码现状确认）

- **向后兼容**：`normalizeBatchTemplate` 兼容旧版 `taskType` 字段 → 展开为 3 个同值的 `levelTaskTypes`；新版数据读回时优先使用 `levelTaskTypes`。
- **最大 3 级**：超出 3 级（索引 ≥ 3）的任务统一使用 `'normal'`，由 `resolveTaskTypeForLevel` 兜底。
- **编辑弹窗动态渲染**：根据当前 `listContent` 实时解析出的最大层级数，决定显示多少个层级类型下拉框（1~3 个）；内容变化时重渲染该区块。
- **父任务标题类型**：用父任务自身 `level` 解析的类型（而非子任务视角），保证与父文件实际 basename 一致。

## Current State Analysis

### 1. 数据结构（当前为单一类型）

[src/tasks-center/batch-task-template.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/batch-task-template.ts#L15-L20)：
- `BatchTaskTemplate.taskType: BatchTaskType` — 单一字段，所有层级共用。
- `normalizeBatchTemplate` ([L196-217](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/batch-task-template.ts#L196-L217))：读取 `candidate.taskType`，非法时回退 `'normal'`。
- `areBatchTemplateConfigsEqual` ([L229-251](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/batch-task-template.ts#L229-L251))：比较 `template.taskType`。
- `buildBatchTaskTitleForUpTask(projectName, taskType, fullName)` ([L160-173](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/batch-task-template.ts#L160-L173))：接收单一 `taskType` 参数。

### 2. 编辑弹窗（单一下拉）

[src/ui/batchTemplateEditModal.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/batchTemplateEditModal.ts)：
- 字段 `private taskType: BatchTaskType` ([L35](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/batchTemplateEditModal.ts#L35))。
- 构造函数初始化 `this.taskType = existing?.taskType ?? 'normal'` ([L45](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/batchTemplateEditModal.ts#L45))。
- `onOpen` 中单一 `DropdownComponent` ([L73-92](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/batchTemplateEditModal.ts#L73-L92))。
- `confirm()` 输出 `taskType: this.taskType` ([L131](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/batchTemplateEditModal.ts#L131))。

### 3. 模板选择弹窗（显示单一类型标签）

[src/ui/batchTaskModals.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/batchTaskModals.ts#L64-L80)：`BatchTemplateSelectModal` 每行显示 `getBatchTaskTypeLabel(template.taskType)`（[L74](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/batchTaskModals.ts#L74)）。

### 4. 确认预览弹窗（不显示类型）

[src/ui/batchTaskModals.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/batchTaskModals.ts#L171-L263)：`BatchCreateConfirmModal` 当前预览只有名称，无类型标签。`formatBatchItemsForPreview` ([batch-task-template.ts L150-158](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/batch-task-template.ts#L150-L158)) 只返回 `{ indent, text }`。

### 5. 执行层（单一类型贯穿创建与父子链接）

[src/views/iotoTasksCenterView.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)：
- `executeBatchCreate` 创建循环用 `template.taskType`（[L936](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L936)、[L939](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L939)）。
- 父子链接用 `template.taskType` 构造父标题（[L975](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L975)）。

### 6. 测试

[tests/batch-task-template.test.mjs](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/batch-task-template.test.mjs)：导入并测试 `normalizeBatchTemplate`、`areBatchTemplateConfigsEqual` 等，依赖 `taskType` 字段。

---

## Proposed Changes

### Step 1: 数据结构与纯函数升级

**文件**：[src/tasks-center/batch-task-template.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/batch-task-template.ts)

1. 新增常量与默认值：
   ```typescript
   export const MAX_LEVEL_TASK_TYPES = 3;
   export const DEFAULT_LEVEL_TASK_TYPES: readonly BatchTaskType[] = ['normal', 'normal', 'normal'] as const;
   ```

2. `BatchTaskTemplate` 接口：`taskType: BatchTaskType` → `levelTaskTypes: BatchTaskType[]`。

3. 新增辅助函数：
   ```typescript
   // 根据层级解析任务类型（超出范围回退 normal）
   export function resolveTaskTypeForLevel(levelTaskTypes: BatchTaskType[], level: number): BatchTaskType;
   // 计算给定 items 实际使用的最大层级数（用于 UI 决定显示几个下拉框）
   export function resolveMaxLevel(items: BatchTaskItem[]): number;
   // 生成层级类型预览文本（如 "L1: 普通任务, L2: 主题任务"）
   export function formatLevelTaskTypes(levelTaskTypes: BatchTaskType[]): string;
   ```
   - `resolveTaskTypeForLevel`：`level < 0` 或 `level >= levelTaskTypes.length` → `'normal'`；否则 `levelTaskTypes[level]`。
   - `resolveMaxLevel`：遍历 items 取 `Math.max(...item.level)`；items 为空返回 0。

4. `normalizeBatchTemplate` 升级为向后兼容（按方案 §3）：
   - 优先读 `candidate.levelTaskTypes`（数组且非空 → 逐项 `isBatchTaskType` 校验，补齐到 MAX）。
   - 否则读旧版 `candidate.taskType`（合法 → 展开为 3 个同值）。
   - 否则 `DEFAULT_LEVEL_TASK_TYPES`。
   - 最终 `slice(0, MAX_LEVEL_TASK_TYPES)`。
   - 输出字段改为 `levelTaskTypes`。

5. `areBatchTemplateConfigsEqual`：比较项 `template.taskType` → 逐项比较 `levelTaskTypes` 数组（长度 + 每项）。

6. `formatBatchItemsForPreview` 扩展返回值，增加 `taskType` 字段，供确认弹窗显示标签：
   ```typescript
   export function formatBatchItemsForPreview(
     items: BatchTaskItem[],
     prefix: string,
     levelTaskTypes: BatchTaskType[],
   ): Array<{ indent: number; text: string; taskType: BatchTaskType }>;
   ```
   - 每项 `taskType = resolveTaskTypeForLevel(levelTaskTypes, item.level)`。

7. `buildBatchTaskTitleForUpTask` 签名不变（仍接收单一 `taskType`），由调用方传入解析后的类型。

### Step 2: 编辑弹窗改为多层级类型选择器

**文件**：[src/ui/batchTemplateEditModal.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/batchTemplateEditModal.ts)

1. 字段 `taskType` → `levelTaskTypes: BatchTaskType[]`（默认 `['normal','normal','normal']`）。
2. 构造函数初始化：`this.levelTaskTypes = normalizeBatchTemplate(existing)?.levelTaskTypes ?? [...DEFAULT_LEVEL_TASK_TYPES]`（复用 normalize 保证向后兼容；existing 为 null 时用默认）。
3. `onOpen` 中替换原单一下拉 Setting 为「层级类型容器」：
   - 用一个外层 div（带 class `ioto-tasks-center__batch-level-types`）承载。
   - 渲染函数 `renderLevelTypeSettings(container)`：
     - 解析当前 `this.listContent` → items → `resolveMaxLevel(items)` → `displayLevelCount = clamp(maxLevel+1, 1, MAX_LEVEL_TASK_TYPES)`。
     - 循环 `i` 从 0 到 `displayLevelCount-1`，每个创建一个 `Setting`：name = `t('settings.batchTemplates.editModal.levelTaskType', [String(i+1)])`，`addDropdown` 绑定 `this.levelTaskTypes[i]`，onChange 更新 `this.levelTaskTypes[i]`。
     - 若 `displayLevelCount === MAX_LEVEL_TASK_TYPES`，追加一行提示文本 `t('settings.batchTemplates.editModal.levelTaskTypeOverflow')`（第 4 级及之后使用普通任务）。
   - 文本域 `onChange` 时调用 `renderLevelTypeSettings` 重渲染（清空容器后重建），保证层级数随内容动态变化。
4. `confirm()` 输出 `levelTaskTypes: this.levelTaskTypes.slice(0, MAX_LEVEL_TASK_TYPES)`。

### Step 3: 模板选择弹窗显示层级类型摘要

**文件**：[src/ui/batchTaskModals.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/batchTaskModals.ts)

- `BatchTemplateSelectModal.onOpen` ([L64-L80](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/batchTaskModals.ts#L64-L80))：类型标签文本由 `getBatchTaskTypeLabel(template.taskType)` 改为 `formatLevelTaskTypes(template.levelTaskTypes)`（来自 Step 1）。
- 顶部 `getBatchTaskTypeLabel` helper 保留（确认弹窗仍需单标签）。

### Step 4: 确认预览弹窗显示每个任务的类型标签

**文件**：[src/ui/batchTaskModals.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/batchTaskModals.ts)

1. `BatchCreateConfirmModalOptions` 新增 `levelTaskTypes: BatchTaskType[]` 字段。
2. `onOpen` 中调用 `formatBatchItemsForPreview(items, prefix, options.levelTaskTypes)`（新签名），每行预览追加类型标签 span（class `ioto-tasks-center__batch-preview-type`，文本 = `getBatchTaskTypeLabel(entry.taskType)`）。
3. 调用方（视图 `triggerBatchCreateFromTemplate`）传入 `levelTaskTypes: template.levelTaskTypes`。

### Step 5: 执行层按层级解析类型

**文件**：[src/views/iotoTasksCenterView.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)

1. `triggerBatchCreateFromTemplate` ([L894-899](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L894-L899))：构造 `BatchCreateConfirmModal` 时新增 `levelTaskTypes: template.levelTaskTypes`。
2. `executeBatchCreate` ([L907-987](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L907-L987))：
   - 创建循环：`const taskType = resolveTaskTypeForLevel(template.levelTaskTypes, item.level)`；`type: taskType`、`templateConfig: this.getTaskTemplateConfig(taskType)`。
   - 父子链接：`const parentTaskType = resolveTaskTypeForLevel(template.levelTaskTypes, parentEntry.item.level)`；传入 `buildBatchTaskTitleForUpTask(projectName, parentTaskType, parentFullName)`。
3. 导入 `resolveTaskTypeForLevel`。

### Step 6: i18n 文案

**文件**（三份 locale）：
- [en.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)
- [zh-cn.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts)
- [zh-tw.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts)

新增 key（en 为基准）：
```
'settings.batchTemplates.editModal.levelTaskType': 'Task type (Level {0})'
'settings.batchTemplates.editModal.levelTaskTypeOverflow': 'Tasks at level 4 and beyond will use the Normal task type.'
```
- zh-cn：`'任务类型（第 {0} 级）'`、`'第 4 级及之后的任务将使用普通任务类型。'`
- zh-tw：`'任務類型（第 {0} 級）'`、`'第 4 級及之後的任務將使用普通任務類型。'`

### Step 7: 测试更新

**文件**：[tests/batch-task-template.test.mjs](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/batch-task-template.test.mjs)

1. 更新现有用例：所有构造 `BatchTaskTemplate`/normalize 输入从 `taskType` → `levelTaskTypes`（或保留旧 `taskType` 输入以验证兼容）。
2. 新增用例：
   - `resolveTaskTypeForLevel`：level 在范围内/超出范围/负数/空数组。
   - `resolveMaxLevel`：平级/多级/空 items。
   - `formatLevelTaskTypes`：格式正确。
   - `normalizeBatchTemplate` 向后兼容：旧 `taskType: 'topic'` → `levelTaskTypes: ['topic','topic','topic']`；新版 `levelTaskTypes` 优先；非法值回退 normal；超长截断到 3。
   - `formatBatchItemsForPreview` 新签名：返回项含正确 `taskType`。
   - `areBatchTemplateConfigsEqual`：`levelTaskTypes` 不同时返回 false。

### Step 8: CSS（可选微调）

**文件**：[styles.css](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css)

- 为 `.ioto-tasks-center__batch-preview-type` 添加样式（小字号、次要文字色、左侧 margin）。
- 为 `.ioto-tasks-center__batch-level-types` 容器添加间距（如无必要可不加，依赖 Setting 默认间距）。

---

## Assumptions & Decisions

1. **MAX_LEVEL_TASK_TYPES = 3**：与方案一致；超出层级用 normal 兜底，不在 UI 暴露更多下拉框。
2. **向后兼容策略**：normalize 同时识别旧 `taskType` 与新 `levelTaskTypes`；持久化数据升级后只写 `levelTaskTypes`。已保存的旧模板在加载时自动迁移，用户无感。
3. **父任务类型来源**：父任务自身 level 解析的类型（非子任务 level-1），保证 `buildBatchTaskTitleForUpTask` 计算的标题与父文件实际 basename 完全一致。
4. **编辑弹窗动态层级数**：根据 listContent 实时解析的最大 level 决定下拉框数量，避免显示无用层级；内容变更时重渲染该区块（仅层级类型区块，不影响其他字段）。
5. **`formatBatchItemsForPreview` 签名变更**：新增第三参数 `levelTaskTypes`，返回值新增 `taskType`。这是破坏性变更，但所有调用点（确认弹窗）在本计划内同步更新。
6. **不修改 `buildBatchTaskTitleForUpTask` 签名**：它保持接收单一 `taskType`，由调用方负责解析，职责单一。
7. **`getBatchTaskTypeLabel` helper 保留**：确认弹窗逐项标签仍需单类型转文本；`formatLevelTaskTypes` 用于多类型摘要。

---

## Verification

1. **单元测试**：
   ```bash
   node --test tests/batch-task-template.test.mjs
   ```
2. **构建**：
   ```bash
   npm run build
   ```
3. **Lint**：
   ```bash
   npm run lint
   ```
4. **手动验证**（Obsidian 中）：
   - 旧数据兼容：已有含 `taskType` 的模板，加载后编辑弹窗显示 3 个同值下拉框。
   - 新建模板：内容含 2 级缩进 → 编辑弹窗显示 2 个类型下拉框；改为 3 级 → 显示 3 个；改回 1 级 → 显示 1 个。
   - 不同层级设不同类型（如 L1=plan、L2=topic）→ 确认弹窗预览每行显示对应类型标签 → 创建后文件名规则与类型一致，子任务 `UpTask` 指向正确的父标题。
   - 模板选择弹窗显示层级类型摘要（如 "L1: 计划任务, L2: 主题任务"）。
