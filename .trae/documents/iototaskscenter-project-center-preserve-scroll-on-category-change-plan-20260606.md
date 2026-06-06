# 计划：项目中心设置分类后滚动回顶修复

## Summary

在 **项目中心**（Project Center）为项目设置分类（以及其他 metadata，如日期）时，当前实现会触发整页全量重渲染并 `root.empty()`，导致滚动容器被销毁重建，滚动位置回到顶部。计划通过在渲染前后捕获/恢复滚动位置，确保用户操作后视图停留在原位置。

## Current State Analysis

- 视图入口：`IOTOProjectCenterView` 位于 [iotoProjectCenterView.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoProjectCenterView.ts)
- 分类下拉渲染与更新链路：
  - 分类列渲染：`renderCategoryCell(...)` 创建 `<select>` 并在 `change` 时调用 `handleCategoryChange(...)`（见 [iotoProjectCenterView.ts:L433-L510](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoProjectCenterView.ts#L433-L510)）
  - 写入 metadata：`persistMetadataPatch(...)` 更新文件后执行 `this.render()`（见 [iotoProjectCenterView.ts:L534-L557](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoProjectCenterView.ts#L534-L557)）
- 触发滚动回顶的关键点：
  - `render()` 首句 `root.empty()`（见 [iotoProjectCenterView.ts:L168-L243](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoProjectCenterView.ts#L168-L243)）会销毁 `.ioto-project-center__content`，从而重置滚动。
  - 滚动容器是 `.ioto-project-center__content { overflow: auto; }`（见 [styles.css:L1023-L1028](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css#L1023-L1028)）

## Proposed Changes

### 1) 为项目中心新增滚动位置捕获/恢复工具

- 新增文件：`src/views/project-center-scroll.ts`
- 内容：
  - `PROJECT_CENTER_CONTENT_SELECTOR = '.ioto-project-center__content'`
  - `captureProjectCenterScrollPosition(container, fallback)`：从容器内找到 `.ioto-project-center__content`，读取 `{ scrollTop, scrollLeft }`，否则返回 fallback
  - `restoreProjectCenterScrollPosition(contentEl, position)`：设置 `scrollTop/scrollLeft`，并在 `requestAnimationFrame` 再设置一次，抵御布局抖动（沿用 [project-list-scroll.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/project-list-scroll.ts) 的既有模式）

### 2) 在 IOTOProjectCenterView.render() 前后应用滚动保护

- 修改文件：`src/views/iotoProjectCenterView.ts`
- 变更点：
  - 新增私有字段保存上一次滚动：`private contentScroll = { scrollTop: 0, scrollLeft: 0 }`
  - 在 `render()` 的 `root.empty()` 之前：
    - `this.contentScroll = captureProjectCenterScrollPosition(root, this.contentScroll)`
  - 创建新的 `contentEl` 后（`const contentEl = root.createDiv({ cls: 'ioto-project-center__content' })`）：
    - `restoreProjectCenterScrollPosition(contentEl, this.contentScroll)`
- 效果：
  - 改分类、改日期、刷新、设置同步导致的 `render()` 都将尽量保持用户当前滚动位置

### 3) （可选）补一个最小单测，避免回归

- 新增文件：`tests/project-center-scroll.test.mjs`
- 覆盖点：
  - `capture...` 在无 `querySelector`、无匹配节点时返回 fallback
  - `restore...` 在传入 null/undefined 时不抛错
  - Node 环境无 `window` 时，`restore...` 仍可安全执行（不依赖 requestAnimationFrame）

## Assumptions & Decisions

- 决策：采用“保留滚动位置”的最小侵入修复；不做局部行更新/虚拟列表重构，以降低改动风险。
- 假设：滚动跳转主要来自 DOM 清空重建，而不是显式 `scrollTo()`；当前代码库内也未找到项目中心相关的 `scrollTo/scrollIntoView` 调用。
- 决策：同时保留 `scrollTop` 与 `scrollLeft`，兼容表格横向滚动场景（表格有 `min-width: 720px`）。

## Verification

- 自动化：
  - 运行 `npm test`（若添加了测试）
  - 运行 `npm run build` 与 `npm run lint`
- 手动（Obsidian 内）：
  - 打开 **项目中心**，向下滚动到列表中部/底部
  - 修改任意一行的“分类”，确认滚动位置不回到顶部
  - 选择“新增分类”并创建后应用到当前行，确认滚动位置不回顶
  - 修改“开始日期/截止日期”，确认滚动位置保持

