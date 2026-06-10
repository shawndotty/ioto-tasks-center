# 计划：右键“添加子任务”改为原生 Submenu

## Summary

- 目标：把任务中心任务列表的右键菜单“添加子任务”改成 Obsidian 原生的 Submenu 形式（悬停自动展开），与截图一致。
- 行为要求：
  - 若用户仅启用 1 种任务类型：保持当前逻辑，点击“添加子任务”直接进入创建流程。
  - 若用户启用多于 1 种任务类型：
    - “添加子任务”这一项本身不触发创建（不直接点击创建）。
    - 鼠标悬停到“添加子任务”时自动展开子菜单，子菜单列出可创建的子任务类型。
    - 点击子菜单中的类型后创建子任务。
- 兼容性：`setSubmenu` 不是官方公开类型接口，需做类型扩展；若运行环境不支持该隐藏 API，则回退到当前“弹第二个 Menu”的模拟二级菜单方式。

## Current State Analysis

- 当前右键菜单实现：
  - 入口在 [showTaskPriorityMenu](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2646-L2749)
  - 多类型时的实现为点击“添加子任务”后调用 `showTaskSubtaskTypeMenu()` 在鼠标位置弹第二个 `Menu`（模拟二级菜单）。
- 现状问题：
  - 不是原生 submenu 风格（不是 hover 展开）。
  - 交互上“添加子任务”可点击，会触发第二个菜单出现，而非像截图那样 hover 自动展开。
- 关键事实：
  - Obsidian 内部确实存在 `MenuItem.setSubmenu()`，但它并非公开 SDK 类型的一部分；社区常见做法是通过类型扩展后调用（参考 Obsidian 论坛：Make setSubmenu public API）。

## Assumptions & Decisions

- 多类型时，“添加子任务”这一项不绑定 `onClick` 创建逻辑；创建只发生在 submenu item 上。
- 不强制阻止点击“添加子任务”本身（有些 Obsidian 版本点击可能会展开 submenu），但点击不会直接创建任务，满足“不能被直接点击触发创建”。
- 为避免在旧版本 Obsidian 上完全失效：运行时检测 `setSubmenu` 是否存在，不存在则继续使用当前的 `showTaskSubtaskTypeMenu()` 作为 fallback。

## Proposed Changes

### 1) 增加 Obsidian 隐藏 API 的类型扩展

**文件**：新增 `src/typings/obsidian-ex.d.ts`

- 扩展 `obsidian` 模块的 `MenuItem`：
  - 增加 `setSubmenu(): Menu` 方法（返回一个 `Menu`，用于继续 `addItem/addSeparator`）
- 如需与 submenu 行为配套，也可补充 `dom: HTMLElement` 字段（不一定用得到；本需求不强依赖）。

**文件**：更新 `tsconfig.json`

- 目前 `tsconfig.json` 仅 `include: ["src/**/*.ts"]`，不会包含 `.d.ts`。
- 调整为同时包含：
  - `src/**/*.ts`
  - `src/**/*.d.ts`

### 2) 将“添加子任务”从“点击弹第二个 Menu”改为“原生 setSubmenu()”

**文件**：`src/views/iotoTasksCenterView.ts`

- 修改 [showTaskPriorityMenu](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2646-L2749) 中“添加子任务”那一项：
  - 计算 `normalizedEnabledTypes` 的逻辑保持不变。
  - 分支：
    - `normalizedEnabledTypes.length === 1`：保持现状，`onClick` 直接 `handleCreateSubtask(task, onlyType)`。
    - `normalizedEnabledTypes.length > 1`：
      - 调用 `item.setSubmenu()` 获取 `subMenu`
      - 在 `subMenu` 中填充可用的任务类型（复用 `getTaskCreationOptions()`，并按 enabledTypes 过滤）
      - submenu item 的 `onClick` 调用 `handleCreateSubtask(task, option.key)`
      - 不再对父 item 设置 `onClick`（避免点击父 item 触发“弹菜单/创建”）。
  - 兼容回退：
    - 若 `typeof (item as unknown as MenuItem).setSubmenu !== "function"`：
      - 回退到现有 `showTaskSubtaskTypeMenu(event, task, normalizedEnabledTypes)`（保持现在的模拟二级菜单体验）。

### 3) 保留 showTaskSubtaskTypeMenu 作为 fallback

**文件**：`src/views/iotoTasksCenterView.ts`

- `showTaskSubtaskTypeMenu()` 暂不删除：
  - 作为 `setSubmenu` 不可用时的兼容方案
  - 也便于在移动端/特殊环境（无 hover）时保持可用性

## Verification Steps

- 自动化：
  - `npm test`
  - `npm run build`
  - `npm run lint`
- 手动（Obsidian，桌面端）：
  1. 设置中启用多于 1 种任务类型
  2. 在任务列表中右键任意任务
  3. 鼠标悬停到“添加子任务”，确认自动出现子菜单
  4. 点击子菜单中的某一类型，确认创建对应子任务
  5. 确认点击父级“添加子任务”不会直接创建任务
  6. 设置中只启用 1 种任务类型时，确认“添加子任务”点击后直接进入创建流程（不出现子菜单）

