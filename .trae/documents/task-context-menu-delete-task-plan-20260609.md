# 计划：任务右键菜单增加“删除任务”

## Summary

- 在任务中心的任务列表中，用户右键点击任意任务时，当前已有的 context menu 底部新增一个“删除任务”菜单项。
- “删除任务”与上方的优先级菜单项之间增加一条分隔线。
- 删除行为采用“移到回收站”而不是永久删除。
- 点击“删除任务”后先弹出一次确认对话框，用户确认后再执行删除。

## Current State Analysis

- 任务行右键菜单入口已经存在，位于 [iotoTasksCenterView.ts:L1134-L1138](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1134-L1138)：
  - 每个 `button.ioto-tasks-center__task-row` 已监听 `contextmenu`
  - 当前统一调用 `showTaskPriorityMenu(event, task)`
- 当前右键菜单结构位于 [iotoTasksCenterView.ts:L2508-L2554](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2508-L2554)：
  - 先显示“核心任务”开关
  - 然后 `menu.addSeparator()`
  - 再显示“取消优先级（如有）”和 `P0-P9`
  - 当前菜单在优先级后直接结束，正适合在底部追加“删除任务”
- 仓库目前没有“删除任务文件”的实现；现有任务级写回能力主要是：
  - 优先级写回 [task-priority.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-priority.ts)
  - 核心任务写回 [task-starred.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-starred.ts)
  - 父任务关联移除 [iotoTasksCenterView.ts:L1848-L1877](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1848-L1877)
- 仓库目前没有现成的确认弹窗：
  - 仅有输入型弹窗 [taskNameModal.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/taskNameModal.ts#L1-L91)
  - 现有弹窗基础样式可复用 [styles.css:L1111-L1126](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css#L1111-L1126)
- 删除后的刷新链路已经具备：
  - 插件已监听 `vault.on('delete')`，见 [main.ts:L439-L460](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts#L439-L460)
  - 删除发生在 `tasksRootPath` 下时会自动刷新打开中的视图，见 [main.ts:L492-L552](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts#L492-L552)

## Assumptions & Decisions

- 右键菜单继续沿用现有的 Obsidian `Menu` 组件，不新增自定义 context menu UI。
- “删除任务”固定放在当前任务右键菜单的最底部。
- 优先级相关菜单项与“删除任务”之间必须显式调用一次 `menu.addSeparator()`。
- 删除行为使用“移到回收站”方案，调用 Obsidian Vault API，而不是永久删除文件。
- 删除前必须二次确认；若用户取消确认，则不做任何改动。
- 本次只删除当前任务文件本身，不联动删除其子任务，不额外修改其他任务的 `UpTask`。
- 本次不新增成功提示；删除成功后以列表刷新和任务消失作为主要反馈，失败时才 `Notice`。

## Proposed Changes

### 1) 新增任务删除服务

**文件**：`src/tasks-center/task-deletion.ts`

- 新增一个独立的任务删除模块，避免把文件删除逻辑直接堆进 `iotoTasksCenterView.ts`。
- 提供 API：
  - `export async function trashTaskFile(app: App, file: TFile): Promise<void>`
- 实现方式：
  - 调用 `app.vault.trash(file, true)`，把任务文件移到回收站。
  - 不在服务层做 UI 反馈；成功/失败由调用方处理。
- 这样可以与现有 `task-priority.ts` / `task-starred.ts` 一样，保持“业务操作放 service，交互放 view”的边界。

### 2) 新增通用确认弹窗

**文件**：`src/ui/confirmModal.ts`

- 参考 [taskNameModal.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/taskNameModal.ts#L1-L91) 的 Promise 风格，新增一个轻量确认弹窗。
- 建议 API：
  - `openAndConfirm(): Promise<boolean>`
- 建议参数：
  - `titleText`
  - `descriptionText`
  - `confirmButtonText`
  - `cancelButtonText`
- UI 行为：
  - 展示标题、说明文案、取消按钮、确认按钮
  - 点击取消 / 关闭弹窗返回 `false`
  - 点击确认返回 `true`
- 样式优先复用现有：
  - `ioto-tasks-center__modal-desc`
  - `ioto-tasks-center__modal-actions`
- 若需要补充危险按钮样式，再在 `styles.css` 中为确认按钮容器增加少量类名，但不改动现有输入型弹窗样式。

### 3) 在任务右键菜单底部增加“删除任务”

**文件**：`src/views/iotoTasksCenterView.ts`

- 继续复用现有 `showTaskPriorityMenu(event, task)` 作为任务右键菜单入口，不新增第二个右键菜单方法。
- 在当前优先级菜单项循环结束后：
  - 先调用一次 `menu.addSeparator()`
  - 再追加“删除任务”菜单项
- 新增方法：
  - `private async confirmAndDeleteTask(task: TaskFileEntry): Promise<void>`
- 实现流程：
  1. 根据 `task.path` 通过 `this.app.vault.getAbstractFileByPath(...)` 获取文件
  2. 若不是 `TFile`，显示 `taskFileUnavailable` 类似的 Notice 并返回
  3. 打开 `ConfirmModal`
  4. 用户确认后调用 `trashTaskFile(this.app, file)`
  5. 删除成功后调用现有刷新链路：
     - 优先直接复用 `await this.refreshFromVaultChange()`
     - 如当前视图状态需要立即置 loading，可沿用仓库当前异步操作中的 `isTasksLoading + render + loadTasks` 模式
  6. 若当前删除的是已打开/已选中的任务，允许现有刷新逻辑自行校正 `openedTaskPath`
- 菜单文案：
  - 菜单标题使用新的 i18n key，例如 `view.taskMenu.delete`
  - 可选为菜单项设置 trash 图标；若现有代码未统一使用菜单图标，则保持纯文本即可

### 4) 补充国际化文案

**文件**：
- `src/lang/locale/en.ts`
- `src/lang/locale/zh-cn.ts`
- `src/lang/locale/zh-tw.ts`

- 新增至少以下 key：
  - `view.taskMenu.delete`
  - `modal.deleteTask.title`
  - `modal.deleteTask.desc`
  - `modal.deleteTask.confirm`
  - `view.notice.deleteTaskFailed`
- 文案方向：
  - 菜单项：删除任务
  - 弹窗标题：删除任务
  - 弹窗描述：明确提示将把当前任务移到回收站，并显示任务名，避免误删
  - 确认按钮：删除
  - 失败提示：删除任务失败

### 5) 如确认弹窗需要补样式，再做最小 CSS 扩展

**文件**：`styles.css`

- 优先复用现有 modal 描述与按钮区样式。
- 仅在确认弹窗需要更清晰危险态时，补充最小样式，例如：
  - `ioto-tasks-center__modal-desc--danger`
  - 或者针对确认按钮增加辅助类
- 不改动任务列表本身样式，不改动已有搜索提示条样式。

### 6) 为删除服务补充测试

**文件**：`tests/task-deletion.test.mjs`

- 新增针对 `trashTaskFile()` 的单元测试，最小 mock `app.vault.trash`
- 覆盖点：
  - 调用时传入正确的 `file`
  - 调用时使用“移到回收站”参数
  - Promise 正常透传成功/失败
- 本次不新增 view 层右键菜单 UI 测试，和当前仓库测试风格保持一致，重点覆盖 service 逻辑。

## Verification Steps

- 自动化验证：
  - `node --test tests/task-deletion.test.mjs`
  - `npm test`
  - `npm run build`
  - `npm run lint`
- 手动验收（Obsidian）：
  1. 在任务中心任务列表中右键任意任务
  2. 确认菜单最底部出现“删除任务”
  3. 确认“优先级”菜单项与“删除任务”之间存在分隔线
  4. 点击“删除任务”后弹出确认框
  5. 点击取消：任务不删除，列表不变化
  6. 再次点击“删除任务”并确认：任务文件被移到回收站，任务列表立即刷新并移除该项
  7. 删除失败场景下出现 Notice，且任务仍保留

