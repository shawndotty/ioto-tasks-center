# 基础设置新增「输入/输出/成果」根目录 - 开发计划（2026-06-06）

## Summary

在基础设置（[settings.ts:L185-L275](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts#L185-L275)）中新增 3 个可编辑的 vault 相对路径配置项，用于保存：

1. 输入笔记根目录（默认：`1-输入`）
2. 输出笔记根目录（默认：`2-输出`）
3. 成果笔记根目录（默认：`4-成果`）

并完善多语言文案（zh-CN / zh-TW / en），保证设置项名称、描述、placeholder 等都走 i18n。

## Current State Analysis

- 当前设置数据结构： [settings.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts)
  - `IOTOTasksCenterSettings` 仅包含 `tasksRootPath` 等字段（未包含输入/输出/成果根目录）
  - `DEFAULT_SETTINGS.tasksRootPath` 默认值来自 [types.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/types.ts) 的 `DEFAULT_TASKS_ROOT_PATH = '3-任务'`
  - 路径规范化逻辑：`normalizeTasksRootPath()`（trim、统一分隔符、去掉首尾 `/`、空值回退默认）
- 插件加载/保存设置： [main.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts)
  - `loadSettings()`：`Object.assign(DEFAULT_SETTINGS, loadedData)` 后对部分字段做 normalize
  - `updateTasksRootPath()`：更新字段 → `saveSettings()` → `applySettingsToOpenViews()`
- 基础设置 UI： [settings.ts:L185-L275](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts#L185-L275)
  - 已有 `tasksRootPath` 的文本输入示例（placeholder + value + onChange → plugin.updateTasksRootPath）
- 多语言词条： [zh-cn.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts) / [zh-tw.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts) / [en.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)

## Proposed Changes

### 1) 新增默认值与路径规范化函数

修改文件： [types.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/types.ts)

- 新增常量：
  - `DEFAULT_INPUT_ROOT_PATH = '1-输入'`
  - `DEFAULT_OUTPUT_ROOT_PATH = '2-输出'`
  - `DEFAULT_RESULT_ROOT_PATH = '4-成果'`
- 抽取一个通用规范化函数（不改变现有 `normalizeTasksRootPath` 行为）：
  - `normalizeVaultRelativePath(input: string, fallback: string): string`
    - 逻辑与 `normalizeTasksRootPath` 一致（trim、replace `\\`、去重 `/`、移除 `./`、移除首尾 `/`）
    - 结果为空时回退为 `fallback`
- 让 `normalizeTasksRootPath()` 内部复用 `normalizeVaultRelativePath(input, DEFAULT_TASKS_ROOT_PATH)`（行为保持一致）
- 新增三个导出函数：
  - `normalizeInputRootPath(input: string): string`
  - `normalizeOutputRootPath(input: string): string`
  - `normalizeResultRootPath(input: string): string`

### 2) Settings 数据结构扩展 + 默认值

修改文件： [settings.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts)

- `IOTOTasksCenterSettings` 新增字段：
  - `inputRootPath: string`
  - `outputRootPath: string`
  - `resultRootPath: string`
- `DEFAULT_SETTINGS` 增加默认值（使用 types.ts 新常量）
- 在 settings.ts 中新增 normalize 包装导出（对齐现有 `normalizeConfiguredTasksRootPath` 风格）：
  - `normalizeConfiguredInputRootPath(path: string): string`
  - `normalizeConfiguredOutputRootPath(path: string): string`
  - `normalizeConfiguredResultRootPath(path: string): string`

### 3) 插件加载与更新方法

修改文件： [main.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts)

- `loadSettings()`：在 `Object.assign()` 后对新增 3 个字段做 normalize（对齐 tasksRootPath 的处理方式）
- 新增 3 个更新方法（对齐 `updateTasksRootPath`）：
  - `updateInputRootPath(path: string): Promise<void>`
  - `updateOutputRootPath(path: string): Promise<void>`
  - `updateResultRootPath(path: string): Promise<void>`
  - 每个方法：normalize → 判等 early return → 写入 settings → `saveSettings()` → `applySettingsToOpenViews()`

### 4) 基础设置 UI 增加 3 个设置项

修改文件： [settings.ts:L185-L275](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts#L185-L275)

- 在现有 `tasksRootPath` 之后，新增 3 个 `Setting(containerEl).addText(...)`：
  - 输入笔记根目录（placeholder: `DEFAULT_INPUT_ROOT_PATH`，value: `this.plugin.settings.inputRootPath`，onChange: `this.plugin.updateInputRootPath`）
  - 输出笔记根目录（placeholder: `DEFAULT_OUTPUT_ROOT_PATH`，value: `this.plugin.settings.outputRootPath`，onChange: `this.plugin.updateOutputRootPath`）
  - 成果笔记根目录（placeholder: `DEFAULT_RESULT_ROOT_PATH`，value: `this.plugin.settings.resultRootPath`，onChange: `this.plugin.updateResultRootPath`）
- 描述文案与 `tasksRootPath` 一致风格：说明是 vault 相对路径、只保存配置不自动创建目录、空值回退默认值

### 5) 多语言词条补齐

修改文件：

- [zh-cn.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts)
- [zh-tw.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts)
- [en.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)

新增 keys（每个 name/desc）：

- `settings.inputRootPath.name`
- `settings.inputRootPath.desc`
- `settings.outputRootPath.name`
- `settings.outputRootPath.desc`
- `settings.resultRootPath.name`
- `settings.resultRootPath.desc`

文案建议（最终以实际落地为准）：

- zh-CN name：输入笔记根目录 / 输出笔记根目录 / 成果笔记根目录
- zh-TW name：輸入筆記根目錄 / 輸出筆記根目錄 / 成果筆記根目錄
- en name：Input notes root path / Output notes root path / Result notes root path

## Assumptions & Decisions

- 这些路径均为 vault 相对路径，遵循与 `tasksRootPath` 相同的规范化规则
- 当输入为空或全空白时，回退到默认值（分别为 `1-输入` / `2-输出` / `4-成果`）
- 本次仅增加设置项与持久化/规范化逻辑，不修改现有任务中心/项目中心的业务行为（后续功能再消费这些配置）

## Verification

- 类型检查/构建：
  - `npm run build`
- 运行测试（如项目已有测试集）：
  - `npm test`
- 手工验收：
  - 打开 **设置 → IOTO Tasks Center → 基础**
  - 可看到 3 个新输入框，默认 placeholder 分别为 `1-输入` / `2-输出` / `4-成果`
  - 输入带 `/` 或 `./` 或 `\\` 的路径，保存后读取值为规范化后的 vault 相对路径
  - 清空输入后应回退为默认值（再次打开设置仍保持默认值）

