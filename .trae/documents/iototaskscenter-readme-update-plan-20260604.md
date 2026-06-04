## Summary

更新插件根目录的 README 文档，使其准确反映 **IOTO Tasks Center** 的实际功能与使用方式；同时新增一份简体中文版 README，并在 README.md 顶部加入指向中文版的链接。

## Current State Analysis

- 当前 [README.md](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/README.md) 仍是 Obsidian Sample Plugin 的模板内容，未覆盖本插件的核心能力与使用方式。
- 插件当前已实现的主要能力（来自代码与文案定义）：
  - 视图：注册并提供 Tasks center 视图（左侧项目列表、右侧任务列表/预览）。
    - 入口命令：`open-tasks-center-view`（[main.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts#L58-L62)）
  - 项目管理：任务根目录下的一级文件夹视为项目；支持创建项目文件夹、隐藏项目。
    - 默认任务根目录：`3-任务`（[types.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/types.ts#L3)）
  - 任务列表：仅展示当前项目目录下的一级 Markdown 文件；支持筛选、搜索、排序、分组、优先级展示。
    - 筛选 tab：Today / Incomplete / Completed / All（[en.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts#L104-L107)）
  - 父子任务（UpTask）：支持拖拽设置父任务、拖到移除区域清除父任务；通过 frontmatter `UpTask` 存储父任务 wikilink（[up-task-assignment.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/up-task-assignment.ts#L15-L23)）。
  - 优先级（Priority）：通过 frontmatter `Priority`（0-9）读写并参与排序/分组（[task-priority.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-priority.ts#L11-L36)）。
  - 任务状态统计：通过扫描 Markdown checkbox 行计算完成/未完成数量并生成状态摘要（[data.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/data.ts#L13-L16)）。
  - 任务创建：支持四种类型（date/plan/topic/normal），并可对每种类型分别配置模板来源（Templater 文件 or inline 内容）。
  - “选中文本转子任务”命令：把当前任务中的选中文本转换为新任务文件，并写入 `Project`/`UpTask` 等属性（[main.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts#L64-L99)、[selected-text-subtask.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/selected-text-subtask.ts#L49-L106)）。
  - 设置页：任务根目录、模板配置、日期任务格式、项目排序、隐藏项目等（[settings.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts#L32-L52)）。

## Proposed Changes

### 1) 更新 README.md（英文为主，并加入中文链接）

目标：让 README.md 作为主入口文档，完整覆盖“功能介绍 + 使用方式 + 配置 + 数据结构（frontmatter）+ 开发/构建”。

具体编辑点（在同一个 README.md 内完成）：

- 顶部增加语言切换链接：
  - `简体中文: [README.zh-CN.md](README.zh-CN.md)`
- 替换 sample plugin 模板内容为本插件内容，建议结构：
  - **Overview**：插件定位（在 Obsidian 中以“项目”为单位管理任务文件）
  - **Key Features**（精炼列表）
    - Projects pane（项目来自任务根目录下的一级文件夹）
    - Task list（筛选/搜索/排序/分组；仅展示项目目录下一级 md 文件）
    - Task status summary（基于 checkbox 统计）
    - Priority（Priority 0-9）
    - UpTask hierarchy（拖拽建立父子关系 + 移除父任务拖拽区）
    - Hover preview（任务 hover 预览）
    - Convert selected text to subtask（命令说明）
    - Task creation with templates（四种任务类型 + Templater/inline）
  - **How it organizes files**：
    - 默认任务根目录 `3-任务`
    - `tasksRootPath/<projectName>/*.md`
  - **Frontmatter fields**（只写本插件会读写的关键字段，避免过度承诺）
    - `Project`（list）
    - `UpTask`（list，wikilink）
    - `Priority`（scalar number）
    - `Subject`/`Plan`（topic/plan 类型的 list）
  - **Commands**
    - Open tasks center view
    - Convert selected text to subtask（含执行前提：当前文件需在任务根目录下）
  - **Settings**
    - Tasks root path
    - Task templates（per type, file/inline）
    - Date task date format
    - Project list sorting
    - Task list sorting/grouping + show priority
    - Hidden projects
  - **Installation**
    - 手动安装路径与步骤（保留 Obsidian 插件常见说明）
  - **Development**
    - `npm install`, `npm run dev`, `npm run build`, `npm test`, `npm run lint`

### 2) 新增 README.zh-CN.md（简体中文）

目标：提供与 README.md 对应的简体中文版本（结构相近、内容一致，术语本地化）。

具体点：

- 新建文件：`README.zh-CN.md`
- 顶部增加反向链接：
  - `English: [README.md](README.md)`
- 内容与英文 README 对齐，中文表达更贴近 Obsidian 使用习惯（例如“命令面板”“设置页”“任务根目录”等）。

## Assumptions & Decisions

- README.md 以英文为主（与当前仓库现状一致），同时在顶部提供简体中文入口链接。
- 简体中文文件名采用 GitHub 常见命名：`README.zh-CN.md`，便于识别与链接。
- 文档不加入截图与外链素材（用户未要求，且避免占用仓库资源）；如后续需要可再补充。

## Verification Steps

- 本地检查 Markdown 链接与相对路径是否正确：
  - README.md 顶部链接可正确跳转到 README.zh-CN.md
  - README.zh-CN.md 顶部链接可正确跳转到 README.md
- 快速人工校对：
  - 功能描述与代码一致（尤其是：任务根目录规则、仅一级 md 文件、frontmatter 字段、命令列表、设置项）
- 可选（执行阶段）：运行 `npm test` 确保文档变更不影响构建/测试（虽不直接相关，但作为基本健康检查）。

