# 项目中心表头点击排序 - 开发计划（2026-06-06）

## Summary

在 **项目中心（Project Center）** 的表格中，为每个字段名（表头单元格）加入“点击排序”功能：

- 点击任意表头：按该列 **升序** 排序
- 再次点击同一表头：切换为 **降序**（两态循环：升序⇄降序）
- 排序状态在 **刷新/重开项目中心后保持**（通过 view state 持久化）
- 默认初始排序：**项目名（升序）**

## Current State Analysis

- Project Center 视图： [iotoProjectCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoProjectCenterView.ts)
  - 当前表头使用 `createHeaderCell()` 渲染为普通 `div`，没有交互。
  - 数据源 `this.rows` 在 `refreshFromVaultChange()` 中生成，随后 `renderTable()` 直接遍历 `this.rows` 输出。
  - 当前视图没有实现 `getState()/setState()`，因此无法持久化 UI 状态（比如排序）。
- 任务中心视图有可参考的 state 持久化实现： [iotoTasksCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)
- 已有项目名排序 collator 实现可借鉴： [project-sort.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/project-sort.ts)

## Decisions & Assumptions（已确认/固化）

- 排序方向切换：升序⇄降序（两态循环）
- 排序状态保持：是（view state）
- 默认排序：项目名（升序）

## Proposed Changes

### 1) 为 Project Center 增加排序状态与持久化

修改文件： [iotoProjectCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoProjectCenterView.ts)

- 新增类型：
  - `type ProjectCenterSortKey = 'projectName' | 'category' | 'startDate' | 'dueDate' | 'taskCount' | 'archived'`
  - `type ProjectCenterSortDirection = 'asc' | 'desc'`
  - `interface IOTOProjectCenterViewState { sortKey?: ProjectCenterSortKey; sortDirection?: ProjectCenterSortDirection }`
- 在 view 内新增字段：
  - `private sortKey: ProjectCenterSortKey = 'projectName';`
  - `private sortDirection: ProjectCenterSortDirection = 'asc';`
- 实现 `getState()` / `setState()`：
  - `getState()` 返回当前 `sortKey/sortDirection`
  - `setState()` 从 state 恢复 `sortKey/sortDirection`，并触发 `refreshFromVaultChange()`（与任务中心一致的模式）

### 2) 表头单元格改为可点击并触发排序

修改文件： [iotoProjectCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoProjectCenterView.ts)

- 将 `createHeaderCell()` 从创建 `div` 改为创建 `button`（保持可访问性与可点击提示）：
  - class 仍维持 `ioto-project-center__cell ioto-project-center__cell--${key}`，额外加 `ioto-project-center__header-cell`
  - 绑定 `click`：
    - 若点击列 key 与当前 `sortKey` 不同：`sortKey = key; sortDirection = 'asc'`
    - 若相同：切换 `sortDirection`（asc⇄desc）
    - 调用 `this.render()`（只重绘，不重新扫 vault）
- 在表头显示排序指示（不引入额外依赖）：
  - 在 button 内追加一个 `span` 显示 `▲` / `▼`（仅当该列为当前 sortKey 时显示）

### 3) 渲染数据行时应用排序

修改文件： [iotoProjectCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoProjectCenterView.ts)

- 新增 `private getSortedRows(): ProjectCenterRow[]`：
  - 返回 `this.rows` 的拷贝并排序（不修改原数组）
  - 使用稳定兜底：当比较结果为 0 时，按 `projectName`（collator）作为 tie-breaker，保证排序稳定
- `renderTable()` 改为遍历 `this.getSortedRows()` 输出行

### 4) 排序规则（字段级）

实现点（在同文件内实现比较器，或拆分为可测函数，见下一节）：

- projectName：`Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`
- category：字符串 collator；空值（未设置）排序时视为 `''`（升序时排前，降序时排后）
- startDate / dueDate：
  - 值为 `YYYY-MM-DD` 时可用字符串比较（同格式下等价于时间顺序）；空值视为 `''`
- taskCount：数字比较
- archived：布尔比较（升序：false 在前；降序：true 在前）

### 5) 样式（表头 hover / 指针 / 排序指示间距）

修改文件： [styles.css](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css)

- 新增/调整：
  - `.ioto-project-center__header-cell`：`cursor: pointer; background: transparent; border: none; text-align: left;`
  - hover 时背景与边框的视觉反馈（与现有 icon button 风格一致）
  - 排序箭头 `span` 的间距与对齐（例如 `margin-left: 6px`）

### 6) 测试（建议添加）

为避免 UI 层难测，建议把排序逻辑抽出为纯函数并写单元测试：

- 新增：`src/views/project-center-sort.ts`
  - `export function sortProjectCenterRows(rows, sortKey, sortDirection): ProjectCenterRow[]`
- 新增：`tests/project-center-sort.test.mjs`
  - 覆盖至少：
    - 项目名升序/降序
    - 任务数量升序/降序
    - 存档布尔排序
    - 日期字符串排序（含空值）

## Verification Plan

- 单元测试：`npm test`
- 构建验证：`npm run build`
- 手工验收（Obsidian）：
  - 打开项目中心，点击每个表头，确认升序/降序切换正确
  - 修改分类/日期/存档后触发刷新，确认排序仍保持
  - 关闭并重开项目中心，确认排序仍保持（view state 生效）

