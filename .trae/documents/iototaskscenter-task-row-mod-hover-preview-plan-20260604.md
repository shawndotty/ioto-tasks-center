## Summary

为任务中心视图中的任务条目增加 Obsidian 原生笔记悬浮预览支持：当鼠标悬浮在整行任务条目上时，按住 Ctrl（Windows/Linux）或 Command（macOS）即可触发 **Page preview** 核心插件的原生预览弹层。保留现有“单击任务条目在预览叶中打开文件”的行为，不新增自定义预览 UI。

## Current State Analysis

- `src/views/iotoTasksCenterView.ts`
  - 任务列表由 `renderTasksPane()` 组织，并在 `renderTaskRows()` 中逐条渲染任务按钮行。
  - 每个任务条目当前是 `button.ioto-tasks-center__task-row`，已有 `click`、`contextmenu`、`dragstart`、`dragover`、`dragleave`、`drop`、`dragend` 事件。
  - 当前点击行为会调用 `openTaskFile(task)`，复用右侧 `previewLeaf` 打开任务文件。
  - 该视图尚未注册任何 `registerHoverLinkSource(...)`，也没有触发 `workspace.trigger('hover-link', ...)` 或 `link-hover`。
- `src/main.ts`
  - 目前只负责注册视图、命令、设置页和 vault 刷新监听；未涉及 Page Preview 相关注册。
- `manifest.json`
  - 当前 `minAppVersion` 为 `1.0.0`，不足以正式声明依赖 `Plugin.registerHoverLinkSource(...)`。
- `versions.json`
  - 当前 `1.0.0 -> 1.0.0`，如果引入新 API，需要与 `manifest.json` 对齐。
- `node_modules/obsidian/obsidian.d.ts`
  - `Plugin.registerHoverLinkSource(id, info)` 标注为 `@since 1.1.0`。
  - `HoverLinkSource.defaultMod` 用于声明该来源是否默认要求按住 Mod 键触发悬浮预览。
- `styles.css`
  - 任务行已有普通 hover 高亮样式，无需为实现原生预览强制追加样式。

## Proposed Changes

### 1. 在主插件生命周期中注册 hover link source

- 文件：`src/main.ts`
- 变更：
  - 在 `onload()` 中调用 `this.registerHoverLinkSource(...)`，为任务中心视图注册一个稳定的 source id，例如 `ioto-tasks-center-task-list`。
  - `display` 使用插件显示名 `IOTO Tasks Center`。
  - `defaultMod` 设为 `true`，与用户目标一致：默认要求 Ctrl/Command 才触发。
- 原因：
  - 让 Page Preview 核心插件把本插件视图识别为合法的 `hover-link` 发射源。
- 实现要点：
  - 不把注册逻辑放进视图类，以避免每个视图实例重复注册。
  - source id 作为常量导出，供 `iotoTasksCenterView.ts` 复用。

### 2. 为任务条目添加原生 hover-link 触发

- 文件：`src/views/iotoTasksCenterView.ts`
- 变更：
  - 在 `renderTaskRows()` 给每个 `rowEl` 增加 `mouseover` 事件监听。
  - 当鼠标进入任务行时，调用 `this.app.workspace.trigger('hover-link', { ... })`，参数包括：
    - `event`: 当前 `MouseEvent`
    - `source`: 主插件注册过的 source id
    - `hoverParent`: 使用当前视图实例（`ItemView` 持有 `hoverPopover`，可充当 `HoverParent`）
    - `targetEl`: 当前任务行元素 `rowEl`
    - `linktext`: 任务文件的 link text，优先使用相对/规范文件路径，确保 Obsidian 能解析到该笔记
    - `sourcePath`: 当前任务文件路径，或按实现需要传入当前任务 path，用于让 Obsidian 正常解析 vault 内链接
    - `state`: 初期保持 `undefined`，不额外滚动到行号/块
  - 只新增 hover 触发，不改变已有 click / contextmenu / drag-and-drop 逻辑。
- 原因：
  - `hover-link` 是更贴近 Obsidian 原生交互的入口，会遵守用户在 **Page preview** 中配置的“是否需要按住 Mod 键”等规则；结合 `defaultMod: true` 可实现“悬浮 + Ctrl/Command”的目标。
- 实现要点：
  - 使用 `mouseover` 而不是 `mouseenter`，与社区已验证的 Page Preview 用法保持一致。
  - 借助 `targetEl` 让 Obsidian 自行管理弹层生命周期，避免手动保存/销毁 `HoverPopover`。
  - 在拖拽过程中不额外阻断 hover；若测试发现拖拽时误触发明显，再在实现中追加 `this.draggingTaskPath` 防抖判断。
  - 若需要更清晰的类型，可在视图文件内定义一个最小化的 `HoverLinkEventPayload` 本地类型，避免大量 `any`。

### 3. 为 hover-link 触发参数提炼小型辅助函数

- 文件：`src/views/iotoTasksCenterView.ts`，必要时拆出到新文件 `src/views/task-hover-preview.ts`
- 变更：
  - 若 `iotoTasksCenterView.ts` 改动过大，则提炼：
    - `buildTaskHoverPreviewPayload(...)`
    - `triggerTaskHoverPreview(...)`
  - 否则保留在视图类私有方法中，例如：
    - `private triggerTaskHoverPreview(event: MouseEvent, task: TaskFileEntry, rowEl: HTMLElement): void`
- 原因：
  - 当前视图文件已经较大；把 hover 预览拼装逻辑包进单一方法可降低 `renderTaskRows()` 的复杂度。
- 实现要点：
  - 优先保持最小改动；只有当新增逻辑明显影响可读性时才新建模块。

### 4. 更新最低版本声明

- 文件：`manifest.json`
- 变更：
  - 将 `minAppVersion` 从 `1.0.0` 提升到 `1.1.0`。
- 原因：
  - `registerHoverLinkSource(...)` 自 1.1.0 起提供，这是本次功能的正式 API 下限。

### 5. 同步版本映射

- 文件：`versions.json`
- 变更：
  - 将当前插件版本 `1.0.0` 对应的最低 Obsidian 版本更新为 `1.1.0`。
- 原因：
  - 保持社区插件发布所需的版本映射一致性，避免 manifest 与 versions 不一致。

### 6. 为 hover 预览逻辑补充测试

- 文件：新增 `tests/task-hover-preview.test.mjs`，或扩展 `tests/task-preview-state.test.mjs`
- 变更：
  - 针对纯函数/辅助函数补测试，而不是为 DOM 整体渲染写高成本集成测试。
  - 覆盖至少以下场景：
    - 能生成正确的 `hover-link` payload：`source`、`linktext`、`targetEl`、`event` 存在。
    - 不会篡改现有点击打开逻辑依赖的数据。
    - 若加入拖拽防抖判断，拖拽态下不会触发 hover 预览。
- 原因：
  - 当前仓库已有较完整的轻量单元测试模式，适合继续沿用。

## Assumptions & Decisions

- 决策：触发范围为整行任务条目，而不是仅标题区域。
- 决策：保留当前“单击任务条目在右侧预览叶打开”的现有行为。
- 决策：本次直接把最低版本提升到 `1.1.0`，不为更低版本提供降级兼容。
- 决策：使用 Obsidian 原生 `hover-link` 机制，而不是自建 hover popover。
- 假设：用户已启用 Obsidian 核心插件 **Page preview**；若未启用，则悬浮预览不会出现，但不会影响既有点击打开功能。
- 假设：任务条目对应的 `task.path` 始终是 vault 内有效 Markdown 文件路径；若文件不存在，Obsidian 只是不弹预览，不应导致视图报错。
- 决策：首版不附加额外视觉提示（例如按住 Mod 时改变边框/光标），先交付原生能力。

## Verification Steps

1. 代码验证
   - 运行 `npm run build`，确认 TypeScript 与打包通过。
   - 运行 `npm test`，确认新增/调整的测试全部通过。
   - 运行 `npm run lint`，确认无新增 lint 错误。

2. 手动验证（桌面端）
   - 在 Obsidian 桌面版 `>= 1.1.0` 中启用 **Page preview** 核心插件。
   - 打开 Tasks Center 视图并进入某个有任务的项目。
   - 将鼠标停在任意任务整行上：
     - 不按 Ctrl/Command 时，不应打断现有交互；是否立即显示预览取决于用户的 Page Preview 设置。
     - 按住 Ctrl/Command 时，应出现该任务笔记的原生悬浮预览。
   - 单击任务行，确认仍在右侧预览叶打开任务文件。
   - 右键任务行，确认优先级菜单仍正常。
   - 进行任务拖拽，确认父子拖拽逻辑未回归。

3. 兼容性验证
   - 检查 `manifest.json` 与 `versions.json` 的最低版本都为 `1.1.0`。
   - 在移动端无需专门适配；该功能自然只在支持鼠标/Mod 键的环境中生效，但不应破坏移动端列表点击。
