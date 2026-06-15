## 概要

在任务中心任务列表中：

- 当任务“出链 Badge”（input/output/outcome）数量为 0 时，不显示对应 Badge
- 当任务“子任务数量 Badge”数量为 0 时，不显示对应 Badge（当前实现已是该行为，但会补充确保不会被增量更新逻辑写出 0）
- 数量变化时仍可实时更新（出链使用现有 metadataCache changed 增量更新机制；子任务随任务列表刷新更新）

## 现状分析（基于实际代码）

### 出链 Badge 目前为何会显示 0

- 在 [iotoTasksCenterView.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1114-L1178) 中，只要开启了某类出链计数，就会创建对应 Badge，并把 `counts.*` 的数值直接写入 `text`，即使为 0 也会显示。
- 出链数量的“实时更新”使用 metadataCache 的 `changed` 事件 + `updateTaskOutlinkBadges()` 增量更新：
  - [iotoTasksCenterView.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L303-L315)
  - [iotoTasksCenterView.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1463-L1500)
  - 当前增量更新逻辑同样会把 badge 文本更新成 `0`，且不会移除/隐藏 badge。

### 子任务数量 Badge 当前行为

- 子任务数量 Badge 的创建已经是 `childTasks.length > 0` 才创建：
  - [iotoTasksCenterView.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1100-L1113)
- 子任务数量没有单独的增量更新逻辑，依赖任务列表刷新重算，因此理论上不会出现 “0 badge”。

## 目标与验收标准

- 开启出链计数时：
  - `input/output/outcome` 任一类别若数量为 0，不渲染对应 badge
  - 若三个类别全部为 0，则不渲染出链 badge 容器（避免出现空白间距）
- 在编辑任务文件导致出链数量从 0→N 或 N→0 时：
  - 列表无需整页刷新也能正确新增/移除 badge（保持当前的增量更新体验）
- 子任务数量 badge 维持 `0 不显示` 的一致规则

## 改动方案

### 1) 任务列表渲染：初始化时不渲染 0 的出链 badge

**文件**
- 修改：`src/views/iotoTasksCenterView.ts`

**做法**
- 在 `renderTaskRows(...)` 中计算 `counts` 后：
  - 仅当某类别 `count > 0` 时才创建对应 badge
  - 只有当至少一个类别需要显示时才创建 `.ioto-tasks-center__task-outlink-counts` 容器

### 2) 增量更新：当数量变为 0 时移除 badge；当从 0 变为 >0 时补创建 badge

**文件**
- 修改：`src/views/iotoTasksCenterView.ts`

**做法**
- 扩展 `updateTaskOutlinkBadges(taskPath)`：
  - 同时读取 `showInput/showOutput/showOutcome`
  - 对每个类别执行 “同步”：
    - `value === 0` 或该类别开关关闭 → 移除对应 badge（如果存在）
    - `value > 0` 且 badge 不存在 → 创建 badge 并绑定 popover
    - `value > 0` 且 badge 存在 → 更新文本与 ariaLabel
  - 当某个任务的 outlink 容器内已没有任何 badge 时，移除 `.ioto-tasks-center__task-outlink-counts` 容器

### 3) 子任务 badge：保持现状（0 不创建）

**文件**
- 不改或仅做极小的防御性检查（若出现展示 0 的情况再补）

## 验证方式

- `npm run build`
- `npm run lint`
- `npm run test`
- Obsidian 手动验证：
  - 某任务无出链时不显示出链 badge
  - 给该任务增加/删除指向 input/output/outcome 根目录的链接，badge 会实时出现/消失
  - 无子任务的任务不显示子任务 badge；创建/删除子任务后数量正确更新（随列表刷新）

