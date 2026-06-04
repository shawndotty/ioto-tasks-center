# 任务模板选择/清空后不立即显示的修复计划

## Summary

- 目标：修复设置页中“选择模板”和“清空”按钮点击后，当前模板路径没有立即显示更新的问题。
- 期望结果：
  - 选择模板文件后，当前任务类型对应的模板路径输入框立刻显示所选文件路径
  - 点击清空后，输入框立刻变为空
  - 不再使用整页 `this.display()`，避免设置页整体跳动
- 范围仅限任务模板设置区的即时刷新，不扩展到其他设置项行为调整。

## Current State Analysis

### 1. 当前任务模板设置区已经支持局部重绘

- 文件 [settings.ts:L258-L378](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts#L258-L378) 中，`renderTaskTemplateSettings(...)` 现在已经被改造成“按任务类型单独渲染”的结构。
- `display()` 里会为每个任务类型创建独立容器，再调用 `renderTaskTemplateSettings(...)` 渲染各自分组。
- `renderTaskTemplateSettings(...)` 开头已经有 `containerEl.empty()`，说明它本身就具备局部刷新当前分组的能力。

### 2. source mode 切换已经使用局部刷新，但模板文件选择/清空没有

- 在 [settings.ts:L283-L295](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts#L283-L295) 中，切换 `sourceMode` 后会调用：
  - `this.renderTaskTemplateSettings(containerEl, taskType, templaterTemplatesFolder)`
- 这意味着下拉切换后，当前分组能立即刷新，而且不会整页跳动。

- 但在模板文件“选择”和“清空”的按钮回调中：
  - [settings.ts:L325-L345](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts#L325-L345)
  - [settings.ts:L347-L361](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts#L347-L361)
- 当前只做了：
  - `await this.plugin.updateTaskTemplateConfig(...)`
  - `await this.plugin.saveSettings()`
- 原本的 `this.display()` 被注释掉了，也没有替换成局部重绘。
- 所以数据其实已经保存，但当前输入框不会立刻反映最新值。

### 3. 配置更新逻辑本身没有问题

- 文件 [main.ts:L203-L219](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts#L203-L219) 中，`updateTaskTemplateConfig(...)` 会：
  - 合并新配置
  - 写回 `this.settings.taskTemplateConfigs`
  - `saveSettings()`
  - `applySettingsToOpenViews()`
- 因此当前症状不是“值没更新”，而是“设置页当前这块 UI 没有重新渲染”。

### 4. 现有结构允许复用同一种局部刷新策略

- `sourceMode` 的 onChange 已经证明：
  - 当前任务类型设置块可以单独重绘
  - 不需要整页 `this.display()`
  - 也不需要重新设计新的状态管理
- 所以“选择模板”和“清空”最合理的修法就是复用同一个局部刷新路径。

## Assumptions & Decisions

- 本次修复不恢复整页 `this.display()`，避免重新引入设置页跳动问题。
- “选择模板”和“清空”都应在配置保存成功后立即局部重绘当前任务类型分组。
- 保持现有 `ImportModal`、`updateTaskTemplateConfig(...)` 和 `saveSettings()` 调用链，不改动数据结构。
- 不新增新的设置项，也不改变 source mode、inline 内容输入等现有行为。

## Proposed Changes

### 1. 在模板文件选择成功后局部刷新当前任务类型设置块

文件：

- [settings.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts)

变更内容：

- 在“选择模板”按钮的回调里，`await this.plugin.updateTaskTemplateConfig(...)` 成功后：
  - 调用 `this.renderTaskTemplateSettings(containerEl, taskType, templaterTemplatesFolder)`
- 不使用 `this.display()`
- 如果仍保留显式 `saveSettings()`，则在保存完成后再执行局部刷新；若确认 `updateTaskTemplateConfig(...)` 已经保存，则移除重复 `saveSettings()` 以减少冗余

原因：

- 当前的模板路径输入框初始值来自 `config.templatePath`
- 只有重新渲染当前分组，输入框才会立即显示刚选中的路径

### 2. 在点击清空后局部刷新当前任务类型设置块

文件：

- [settings.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts)

变更内容：

- 在“清空”按钮的回调里，`await this.plugin.updateTaskTemplateConfig(...)` 把 `templatePath` 设为空后：
  - 同样调用 `this.renderTaskTemplateSettings(containerEl, taskType, templaterTemplatesFolder)`
- 不恢复整页 `this.display()`

原因：

- 当前清空动作已经把配置值写空，但输入框仍保留旧显示
- 局部刷新后，输入框和描述文案会立即与最新配置对齐

### 3. 清理重复保存逻辑，避免不必要的二次写入

文件：

- [settings.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts)

变更内容：

- 审核“选择模板”和“清空”按钮中的 `await this.plugin.saveSettings()`
- 因为 [main.ts:L203-L219](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts#L203-L219) 的 `updateTaskTemplateConfig(...)` 已经会执行 `saveSettings()`
- 计划中优先移除这两个重复保存调用，减少无意义的重复写入和潜在的 UI 延迟

原因：

- 这是当前代码里可确认的冗余操作
- 既能简化按钮回调，也能让局部刷新链路更清晰

### 4. 补充针对设置页即时刷新的测试或最小验证

文件：

- 优先检查现有测试是否已有设置页交互覆盖
- 若没有现成 UI 测试基础，则至少做手动验证说明

验证重点：

- 选择模板后，输入框立即显示文件路径
- 清空后，输入框立即变空
- 任务模板设置区没有整页跳动
- source mode 切换后的局部刷新仍然正常

原因：

- 这是典型的“数据已改但 UI 未同步”问题
- 即时反馈是这次修复的核心验收标准

## Verification Steps

### 自动化验证

- 运行 `npm run build`
  - 确认 `settings.ts` 改动不引入类型或打包问题
- 运行 `npm run lint`
  - 确认无新增 lint 报错
- 对 [settings.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts) 执行 diagnostics 检查

### 手动验收

- 打开插件设置页，进入任务模板设置区
- 在任意一个任务类型下点击“选择模板”
  - 选择一个模板文件
  - 确认模板路径输入框立刻显示所选路径
- 点击“清空”
  - 确认模板路径输入框立刻变为空
- 多切换几次 `sourceMode`
  - 确认仍然只刷新当前分组，不会整页跳动
- 切换不同任务类型重复上述操作
  - 确认每个任务类型分组都能独立刷新，不互相影响
