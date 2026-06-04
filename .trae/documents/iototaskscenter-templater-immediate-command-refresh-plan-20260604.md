# Templater 文件模板首次创建任务不执行的修复计划

## Summary

- 目标：修复“刚在插件设置里选好文件模板后，立即创建任务时，模板内的 Templater 代码不会执行，必须重启 Obsidian 才生效”的问题。
- 期望结果：
  - 用户选择文件模板后，无需重启 Obsidian
  - 第一次创建任务时，模板内的 Templater 代码就能立即执行
  - 如果无法执行 Templater，也保留当前“原样插入模板内容”的降级行为
- 范围聚焦在文件模板 + Templater 命令注册链路，不扩展到 inline 模板或其他设置行为。

## Current State Analysis

### 1. 当前文件模板执行依赖 “Templater 模板热键命令”

- 任务创建链路位于 [task-creation.ts:L383-L479](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-creation.ts#L383-L479)
- 目前 `applyTemplateFileToFile(...)` 在 file 模式下会：
  - 找到模板文件
  - 调用 `ensureTemplateCommandEnabled(app, templateFile.path)`
  - 再通过 `executeCommandById(commandId)` 执行 `templater-obsidian:<template-path>` 形式的命令
- 如果命令不存在，就会回退到直接读取模板文件原文写入目标文件，并弹出“模板已插入原文，未自动执行 templater 语法”的提示

### 2. 当前 bug 的根因是：只写入了 Templater 设置，但没有立刻刷新命令注册

- `ensureTemplateCommandEnabled(...)` 现在的逻辑在 [task-creation.ts:L451-L479](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-creation.ts#L451-L479)
- 它只做了两件事：
  - 把模板路径加入 `templater.settings.enabled_templates_hotkeys`
  - 调用 `templater.save_settings()`
- 然后立即从 `app.commands.commands` 里检查 `templater-obsidian:<path>` 是否存在
- 如果该命令还没注册成功，就返回 `null`

- 本地安装的 Templater 插件源码（已在当前 vault 的 `/Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/templater-obsidian/main.js` 中核实）显示：
  - Templater 在 `onload()` 时创建 `command_handler`，并执行 `command_handler.setup()`
  - `command_handler.setup()` 会调用 `register_templates_hotkeys()`
  - `register_templates_hotkeys()` 再根据 `enabled_templates_hotkeys` 注册对应模板命令
- 也就是说，模板热键命令注册是显式命令处理器行为，不是单纯 `save_settings()` 后自动刷新的被动行为。

### 3. 这能解释为什么“重启 Obsidian 后才生效”

- 重启后，Templater 重新 `onload()`
- `command_handler.setup()` 会重新读取已经保存下来的 `enabled_templates_hotkeys`
- 这时目标模板命令才真正被注册到命令系统中
- 所以第一次任务创建拿不到命令、重启后却能拿到命令，和当前代码逻辑完全一致

### 4. 当前仓库缺少这条链路的自动化覆盖

- 现有 [task-creation.test.mjs](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/task-creation.test.mjs) 目前只覆盖：
  - 文件名格式
  - 配置归一化
  - `getTemplaterCommandId(...)`
- 没有覆盖：
  - `ensureTemplateCommandEnabled(...)`
  - Templater 命令即时注册
  - `createTaskFile(...)` 在 file 模板 + Templater 场景下的首次执行

## Assumptions & Decisions

- 不改动当前“通过 Templater 模板命令执行文件模板”的整体策略。
- 修复重点放在 `ensureTemplateCommandEnabled(...)`：
  - 在保存 Templater 设置后，主动触发当前进程内的模板命令注册
  - 而不是要求用户重启 Obsidian
- 保留当前降级逻辑：
  - 若 Templater 插件不存在
  - 或命令注册/执行失败
  - 仍回退到原样插入模板内容
- 不在本次任务中清理或回收历史模板热键条目，避免额外引入设置同步风险。

## Proposed Changes

### 1. 扩展 Templater 插件类型声明，显式建模命令处理器

文件：

- [task-creation.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-creation.ts)

变更内容：

- 为当前本地调用增加最小必要类型定义，例如：
  - `command_handler`
  - `add_template_hotkey(previousPath, nextPath)`
  - `remove_template_hotkey(path)`（如果实现中需要）
- 类型只覆盖当前修复所需的最小接口，不去复刻整个 Templater 内部结构

原因：

- 当前代码只知道 `settings` 和 `save_settings()`
- 要在不重启的情况下即时注册命令，需要安全调用 Templater 的命令处理器实例

### 2. 在 `ensureTemplateCommandEnabled(...)` 中加入“即时注册命令”步骤

文件：

- [task-creation.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-creation.ts)

变更内容：

- 保留现有：
  - 路径归一化
  - 读取 `enabled_templates_hotkeys`
  - 不存在时写回设置并 `save_settings()`
- 在 `save_settings()` 之后，增加一段主动刷新逻辑：
  - 先重新检查命令是否已存在
  - 若仍不存在，则尝试调用 `templater.command_handler.add_template_hotkey(null, normalizedTemplatePath)`
  - 然后再次检查 `app.commands.commands` 是否已出现目标命令
- 若命令已经存在，则直接返回 command id
- 若调用后仍不存在，则返回 `null`，维持当前降级分支

原因：

- 本地核实的 Templater 实现中，模板热键命令正是由 `command_handler.add_template_hotkey(...)` 注册的
- 这比单纯修改设置再等待插件重载更符合当前 bug 的修复目标

### 3. 为即时注册逻辑增加保护分支，兼容不同 Templater 版本

文件：

- [task-creation.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-creation.ts)

变更内容：

- 在调用 `templater.command_handler.add_template_hotkey(...)` 前做运行时检查：
  - `command_handler` 是否存在
  - `add_template_hotkey` 是否为函数
- 若不存在这些内部方法：
  - 不抛错
  - 继续沿用原有降级流程

原因：

- `command_handler` 属于 Templater 的内部实现细节，不保证所有版本都一致
- 运行时保护能减少跨版本兼容风险

### 4. 为任务创建补充针对 Templater 首次注册的测试

文件：

- [tests/task-creation.test.mjs](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/task-creation.test.mjs)

变更内容：

- 增加至少一组聚焦 `ensureTemplateCommandEnabled(...) / createTaskFile(...)` 的测试场景：
  - 模拟 Templater 插件已安装
  - `enabled_templates_hotkeys` 初始不包含目标模板
  - `app.commands.commands` 初始也没有目标命令
  - `save_settings()` 后仍无命令
  - 但 `command_handler.add_template_hotkey(null, path)` 会把对应命令注册到 `app.commands.commands`
  - 断言第一次任务创建就能拿到命令并进入执行分支

- 如有必要，再补一条保护场景：
  - `command_handler` 不存在时不抛异常，而是继续回退为原样模板插入

原因：

- 这是本次 bug 的核心回归点
- 没有自动化覆盖的话，后续很容易再次退化为“必须重启后才生效”

### 5. 保持当前用户提示与降级体验不变

文件：

- [task-creation.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-creation.ts)
- 如测试断言涉及提示文案，则同步检查 [zh-cn.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts) / [en.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)

变更内容：

- 不新增新的提示文案
- 仍保留“模板已插入原文，未自动执行 templater 语法”的原有行为作为兜底

原因：

- 用户要求的是“无需重启即可生效”
- 不是要求改变失败时的交互文案

## Verification Steps

### 自动化验证

- 运行 `npm run build`
  - 确认 `task-creation.ts` 改动无类型或打包问题
- 运行 `npm run lint`
  - 确认无新增 lint 报错
- 运行聚焦测试：
  - `node --test tests/task-creation.test.mjs`
  - 确认新增的 Templater 首次注册场景通过
- 对以下文件执行 diagnostics 检查：
  - [task-creation.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-creation.ts)
  - [task-creation.test.mjs](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/task-creation.test.mjs)

### 手动验收

- 在插件设置中为某个任务类型选择一个包含 Templater 代码的文件模板
- 不重启 Obsidian，直接创建该类型任务
- 验证：
  - 模板内 Templater 代码已立即执行
  - 不再需要重启 Obsidian 才生效
- 再切换到另一个新的模板文件重复一次
  - 验证新的模板路径第一次使用也能立即生效
- 若临时关闭/卸载 Templater 或故意制造命令不可执行场景
  - 验证仍回退到“原样插入模板内容”，且不会抛出未处理异常
