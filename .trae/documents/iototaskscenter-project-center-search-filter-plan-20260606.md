# 计划：项目中心增加项目名搜索过滤

## Summary

在 **项目中心**右侧操作区增加一个“搜索”图标按钮（位于刷新按钮左侧）。点击后在标题左侧区域展示搜索框；用户输入项目名关键字并确认后，仅展示匹配项目（包含匹配、忽略大小写）。再次点击搜索图标会收起输入框但保留当前过滤结果，直到用户清除搜索。

## Current State Analysis

- 项目中心视图：`IOTOProjectCenterView`（见 [iotoProjectCenterView.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoProjectCenterView.ts)）
  - Header 结构：`titleEl`（左）+ `actionsEl`（右），右侧已有刷新与新建项目按钮（见 [iotoProjectCenterView.ts:L174-L216](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoProjectCenterView.ts#L174-L216)）。
  - 内容区域：`.ioto-project-center__content` 为滚动容器（CSS 见 [styles.css:L1023-L1028](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css#L1023-L1028)）。
- 代码库里已有“确认后搜索”的成熟交互实现：任务中心 `renderTaskSearch()`（输入框 + 清除按钮 + 搜索按钮 + Enter 提交），可复用其交互与样式思路（见 [iotoTasksCenterView.ts:L978-L1058](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L978-L1058)、[styles.css:L284-L394](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css#L284-L394)）。

## Decisions (User Confirmed)

- 交互：**确认后筛选**（Enter 或点击确认按钮后才应用过滤）。
- 收起行为：再次点击搜索图标收起搜索框，但**保留过滤**（直到用户清除）。
- 匹配规则：**包含匹配（忽略大小写）**，仅匹配项目名。

## Proposed Changes

### 1) 新增项目中心“按项目名过滤”的纯函数（便于测试）

- 新增文件：`src/views/project-center-search.ts`
- 导出函数：
  - `filterProjectCenterRowsByQuery<T extends { name: string }>(rows: T[], query: string): T[]`
  - 规则：
    - `query.trim()` 为空：返回原数组引用（不复制）
    - 否则：对 `row.name` 做 `toLowerCase()`，判断是否 `includes(queryLower)`

### 2) 在项目中心 Header 增加搜索按钮 + 左侧搜索框 UI

- 修改文件：`src/views/iotoProjectCenterView.ts`
- 增加状态字段（保存在 view 实例中，不需要落盘）：
  - `private isProjectSearchVisible = false`
  - `private projectSearchInputValue = ''`（输入中的值）
  - `private projectSearchQuery = ''`（已确认应用的过滤条件）
  - `private shouldFocusProjectSearch = false`（点击图标展开后用于聚焦）
- Header DOM 调整：
  - 新增左侧容器 `.ioto-project-center__header-left`，包含标题与（可选）搜索区域
  - 在 `actionsEl` 中插入搜索图标按钮（`setIcon(..., 'search')`），位置：**刷新按钮之前**
  - 点击搜索按钮：
    - `isProjectSearchVisible = !isProjectSearchVisible`
    - 若从隐藏 → 显示：`shouldFocusProjectSearch = true` 并 `render()`
    - 若从显示 → 隐藏：仅 `render()`（不清空 query，保留过滤）
- 搜索框 UI（仅当 `isProjectSearchVisible` 为 true 渲染）：
  - `input type="search"`，placeholder 来自 i18n
  - `input` 事件仅更新 `projectSearchInputValue`
  - `keydown Enter` 与“确认按钮”都会执行 `applyProjectSearchQuery()`：
    - 将 `projectSearchQuery = projectSearchInputValue`
    - `render()`
  - 当 `projectSearchInputValue` 或 `projectSearchQuery` 非空时展示清除按钮：
    - 清除按钮执行 `clearProjectSearch()`：两个字段都置空并 `render()`
  - 渲染结束后若 `shouldFocusProjectSearch` 为 true：
    - 在 `requestAnimationFrame` 中 `inputEl.focus()`，并重置 `shouldFocusProjectSearch = false`
- 列表过滤渲染：
  - 在 `render()` 的 idle 分支中，先计算 `const filteredRows = filterProjectCenterRowsByQuery(this.rows, this.projectSearchQuery)`
  - 若 `projectSearchQuery.trim().length > 0` 且 `filteredRows.length === 0`：
    - 渲染一个“搜索无结果”的 state（新增 i18n 文案）
  - 将 `renderTable(container)` 改为 `renderTable(container, rows)`，并对 `rows` 执行 `sortProjectCenterRows(rows, this.sortKey, this.sortDirection)`

### 3) 样式支持（复用任务中心搜索框风格）

- 修改文件：`styles.css`
- 新增项目中心 header 搜索样式，风格与 `.ioto-tasks-center__task-search*` 保持一致：
  - `.ioto-project-center__header-left`：`display:flex; align-items:center; gap:12px; min-width:0;`
  - `.ioto-project-center__search-controls`：`display:flex; align-items:center; gap:8px;`
  - `.ioto-project-center__search-input-wrapper`：`position:relative;`
  - `.ioto-project-center__search-input`：边框/圆角/hover/focus 与任务中心一致；宽度建议 `min(320px, 38vw)`
  - `.ioto-project-center__search-clear-button`：沿用任务中心清除按钮样式（右侧小圆按钮）
  - `.ioto-project-center__search-button`：确认按钮样式（与任务中心搜索按钮一致）

### 4) i18n 文案

- 修改文件：
  - `src/lang/locale/zh-cn.ts`
  - `src/lang/locale/en.ts`
  - `src/lang/locale/zh-tw.ts`
- 新增 key（命名归到 projectCenter 下，避免与任务中心 search 混用）：
  - `projectCenter.action.search`
  - `projectCenter.search.placeholder`
  - `projectCenter.search.button`
  - `projectCenter.search.clear`
  - `projectCenter.search.clearShort`
  - `projectCenter.search.emptyTitle`
  - `projectCenter.search.emptyDesc`（带占位符 `{0}` 显示关键词）

### 5) 单测（保证过滤逻辑不回归）

- 新增文件：`tests/project-center-search.test.mjs`
- 覆盖点：
  - 空 query 返回原数组（引用相等）
  - 忽略大小写的包含匹配
  - query 两端空白会被 trim

## Assumptions & Non-Goals

- 不做拼音/模糊匹配；仅按项目名字符串包含匹配。
- 搜索过滤只影响“展示列表”，不改变项目元数据，不影响分类选项集合来源。
- 搜索状态仅保存在当前 view 实例中；关闭视图/重启 Obsidian 后不保证保留。

## Verification

- 自动化：
  - `npm test`
  - `npm run build`
  - `npm run lint`
- 手动（Obsidian）：
  - 打开项目中心，点击右侧搜索图标，左侧出现搜索框并自动聚焦
  - 输入关键字并按 Enter / 点击确认按钮，仅显示命中项目
  - 点击清除按钮恢复全部项目
  - 点击搜索图标收起搜索框，过滤仍保留；再次展开可继续修改/清除

