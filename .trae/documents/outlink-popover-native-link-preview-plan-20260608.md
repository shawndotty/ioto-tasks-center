# 计划：Outlink Popover Item 支持 Obsidian 原生 Link Preview（Ctrl/Cmd 悬停）

## Summary

在任务中心的 outlink 面板（`TaskOutlinkPopover`）中，当用户将鼠标悬停在某个 outlink item 上并按住 Ctrl（Windows/Linux）或 Command（macOS）时，触发 Obsidian 原生 `hover-link` 机制，显示系统自带的 link preview 浮窗。

## Current State Analysis

- Outlink 面板实现位于 [task-outlink-popover.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/task-outlink-popover.ts)。
  - Item 当前用 `button` 渲染，支持点击打开预览（`onItemClick`）。
  - 目前无 Ctrl/Cmd 悬停逻辑，也无对 `workspace.trigger('hover-link', payload)` 的调用入口。
- 项目内已有 Obsidian 原生 hover preview 的触发实现可复用：
  - `this.app.workspace.trigger('hover-link', payload)`（见 [iotoTasksCenterView.ts:L1219-L1237](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1219-L1237)）
  - payload 构造函数在 [task-hover-preview.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/task-hover-preview.ts)。

## Proposed Changes

### 1) 为 `TaskOutlinkPopover` 增加触发原生 hover preview 的能力

**文件**： [task-outlink-popover.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/task-outlink-popover.ts)

- 扩展构造函数：
  - 从 `constructor(doc: Document)` 改为 `constructor(doc: Document, workspace: Workspace)`
  - 保存 `workspace` 引用，用于触发 `workspace.trigger('hover-link', ...)`
- 在类内新增一个 `hoverParent` 状态对象（与 Obsidian hover-link 协议一致）：
  - 形如 `{ hoverPopover: HoverPopover | null }`
  - 用于让 Obsidian 复用/管理该来源下的 hover popover 生命周期
- 在 popover `open()` 时：
  - 记录/初始化 hover 状态（例如重置 last triggered item）
  - 为每个 item 绑定悬停事件（见下一节）
  - 注册并在 `close()` 时清理键盘监听（用于“先悬停后按 Ctrl/Cmd”的场景）

### 2) Item 悬停 + Ctrl/Cmd 时触发 `hover-link`

**文件**：同上

为每个 `button` item 绑定：

- `mouseenter` / `mousemove`：
  - 记录当前 hovered item（path + element + 最近一次 MouseEvent）
  - 若 `event.ctrlKey || event.metaKey` 为真：
    - 构造 payload 并调用 `workspace.trigger('hover-link', payload)`
  - 为避免频繁重复触发：
    - 维护 `lastPreviewPath`，同一 item 重复 mousemove 不再触发
- `mouseleave`：
  - 清理 hovered item 记录（不强制关闭 hoverPopover，让 Obsidian 自己按机制关闭；如需要可在执行阶段根据体验加 `scheduleClose`/更短延迟，但默认先不改变行为）

键盘支持（解决“先 hover，再按 Ctrl/Cmd”不会触发的问题）：

- 在 popover `open()` 时向 `doc` 注册 `keydown` 监听：
  - 若存在 hovered item 且按键导致 `ctrlKey/metaKey` 成立，则使用记录的最近 MouseEvent 触发一次 preview
- 在 `close()` 时移除该监听，避免泄漏与跨界面干扰

payload 内容（与任务列表保持一致的协议字段）：

- `source`: 新增常量，例如 `ioto-tasks-center-outlink-popover`
- `hoverParent`: `this.hoverParent`
- `targetEl`: 当前 item 的 button 元素
- `linktext`: item.path（vault 内文件路径）
- `sourcePath`: item.path（与项目内 task hover preview 的策略保持一致：linktext/sourcePath 都用同一个 path）
- `event`: 当前鼠标事件（来自 mouseenter/mousemove 记录）

### 3) 适配调用方

**文件**： [iotoTasksCenterView.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)

- `onOpen()` 中构造 popover 的地方从：
  - `new TaskOutlinkPopover(this.contentEl.ownerDocument)`
  - 改为：
  - `new TaskOutlinkPopover(this.contentEl.ownerDocument, this.app.workspace)`

## Assumptions & Decisions

- 仅在用户按住 Ctrl/Cmd 的情况下触发原生 link preview；普通悬停不触发。
- Outlink item 仍然保持点击行为（点击打开预览）不变。
- 不改变 item 的 DOM 类型（仍使用 `button`），通过 `hover-link` 事件触发原生预览（无需强制渲染成 `<a class="internal-link">`）。

## Verification

- 自动化：
  - `npm test`
  - `npm run build`
  - `npm run lint`
- 手动（Obsidian）：
  1. 打开任务中心，找到某个任务的 outlink badge（输入/输出/成果）并打开 outlink 面板
  2. 将鼠标移到某个 outlink item 上：
     - 不按 Ctrl/Cmd：不出现原生 link preview
     - 按住 Ctrl（Win/Linux）或 Command（macOS）：出现 Obsidian 原生 link preview 浮窗
  3. 松开 Ctrl/Cmd 或移开鼠标：预览按 Obsidian 默认行为关闭

