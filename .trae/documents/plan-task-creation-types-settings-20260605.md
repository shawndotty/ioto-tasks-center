## Summary

在插件设置中增加“可创建的任务类型”配置。用户可以勾选启用的任务类型（四种：normal/date/topic/plan），至少必须启用 1 个：

- 仅启用 1 个类型：点击 **添加任务** 直接创建该类型（与现有交互一致：非 date 类型仍弹出命名弹窗）。
- 启用多个类型：点击 **添加任务** 仍弹出当前的类型选择菜单，但只显示启用的类型。

同时完善多语言文案（en/zh-cn/zh-tw）。

## Current State Analysis

- 任务创建入口在 [iotoTasksCenterView.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)：
  - 点击添加任务按钮总是调用 `showTaskCreationMenu(event)`，[iotoTasksCenterView.ts:L478-L502](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L478-L502)
  - `showTaskCreationMenu` 通过 `getTaskCreationOptions()` 固定提供 4 种类型，[iotoTasksCenterView.ts:L1319-L1333](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1319-L1333)
  - 类型选项定义在文件尾部 `getTaskCreationOptions()`，固定返回 4 个 key，[iotoTasksCenterView.ts:L2045-L2055](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2045-L2055)
- 插件设置结构在 [settings.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts)：
  - `IOTOTasksCenterSettings` 当前不包含“启用任务类型”
  - `IOTOTasksCenterSettingTab.display()` 已有 “Task creation” 分组与模板配置区块
- View 的设置来源由主插件在 [main.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts) 注入多个 getter/setter 回调构造 `IOTOTasksCenterView`，[main.ts:L39-L55](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts#L39-L55)
- 多语言基于 `t(...)`，并以 `en.ts` 的 key 作为类型约束（必须先在 en.ts 增加新 key）：
  - [helpter.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/helpter.ts)
  - locale 文件：[en.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)、[zh-cn.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts)、[zh-tw.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts)

## Assumptions & Decisions

- 禁用的任务类型对应的“模板设置”仍然显示（仅影响“创建任务”入口），便于随时调整模板后再启用。
- 升级/首次安装默认启用全部四种类型，以保持当前行为不变。
- 设置需要强制至少选择 1 个类型：在 UI 层禁止用户取消最后一个选项（提示 Notice），同时在加载设置时做兜底归一化。

## Proposed Changes

### 1. 增加并归一化设置字段

- 文件：[settings.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts)
- 变更：
  - 在 `IOTOTasksCenterSettings` 增加字段：
    - `enabledTaskCreationTypes: TaskCreationType[]`
  - 在 `DEFAULT_SETTINGS` 增加默认值（四种全开，按当前菜单顺序）：
    - `['normal', 'date', 'topic', 'plan']`
  - 新增导出函数 `normalizeEnabledTaskCreationTypes(value: unknown): TaskCreationType[]`：
    - 过滤非数组/非法值
    - 去重
    - 若结果为空，则回退到默认四种
    - 输出按固定顺序排序，保证 UI 稳定

### 2. 设置页 UI：勾选启用的任务类型（至少一个）

- 文件：[settings.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts)
- 变更：
  - 在 “Task creation” 分组内、模板配置之前新增一段设置项：
    - 名称/描述来自 i18n（新增 key，见下）
    - 每种任务类型一个 Toggle（或 Checkbox 风格的 Toggle），显示 `t('task.type.*')`
    - 当用户尝试关闭最后一个已启用类型：
      - 立即把 Toggle 复位为开启
      - 弹出 `new Notice(t('settings.enabledTaskTypes.atLeastOne'))`
  - 变更写入插件设置时，调用主插件新增的更新方法（见下一节）

### 3. 主插件：加载时归一化 + 增加更新方法 + 注入到 View

- 文件：[main.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts)
- 变更：
  - `loadSettings()` 中在 `Object.assign` 后对 `enabledTaskCreationTypes` 调用 `normalizeEnabledTaskCreationTypes`
  - 新增 `updateEnabledTaskCreationTypes(types: TaskCreationType[]): Promise<void>`
    - 先归一化
    - 若与现值一致则返回
    - 保存并 `applySettingsToOpenViews()`
  - 在构造 `IOTOTasksCenterView` 时新增一个 getter 回调：
    - `() => this.settings.enabledTaskCreationTypes`

### 4. View：根据启用类型决定是否弹出菜单

- 文件：[iotoTasksCenterView.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)
- 变更：
  - 构造函数新增参数 `getEnabledTaskCreationTypes: () => TaskCreationType[]` 并保存为字段
  - 调整 `showTaskCreationMenu(event)`：
    - `const enabled = this.getEnabledTaskCreationTypes()`（必要时做本地兜底：空数组回退到全部）
    - 若 `enabled.length === 1`：直接 `handleCreateTask(enabled[0])`，不创建 Menu
    - 否则：`getTaskCreationOptions()` 结果按 `enabled` 过滤后再生成菜单
  - 保持 `handleCreateTask(type)` 原样（命名弹窗、模板选择、创建文件、刷新列表等逻辑不变）

### 5. 多语言：新增设置项文案

- 文件：
  - [en.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)
  - [zh-cn.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts)
  - [zh-tw.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts)
- 新增 key（示例命名）：
  - `settings.enabledTaskTypes.name`
  - `settings.enabledTaskTypes.desc`
  - `settings.enabledTaskTypes.atLeastOne`

### 6. 测试：覆盖设置归一化

- 文件：新增 `tests/enabled-task-creation-types.test.mjs`
- 覆盖点：
  - 非法输入（null/非数组/空数组）回退到默认四种
  - 去重 + 过滤未知类型
  - 输出顺序稳定

## Verification Steps

1. 运行 `npm run build`，确认 TS 编译与打包通过
2. 运行 `npm run lint`，确认无新增 lint 问题
3. 运行 `npm test`，确认新增测试通过
4. 手动验证（Obsidian 桌面端）：
   - 设置页勾选仅 1 个类型，点击 **添加任务** 应直接进入该类型创建流程（非 date 类型会出现命名弹窗）
   - 设置页勾选多个类型，点击 **添加任务** 仍出现菜单，但只显示勾选的类型
   - 尝试取消最后一个类型，应被阻止并提示
