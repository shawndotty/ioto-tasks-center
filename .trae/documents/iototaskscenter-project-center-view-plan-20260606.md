# IOTO Tasks Center - Project Center 视图开发计划（2026-06-06）

## Summary

为插件新增一个独立的 **Project Center** 视图（新的 view type），以 Airtable 风格的 List View（表格）管理项目（任务根目录下的一级文件夹），并在其中维护项目元数据与“存档（= 任务中心隐藏）”状态。

交付后：

- 命令面板新增：打开 **IOTO Project Center**
- Project Center 展示项目表格字段（当前阶段）
  - 项目名（一级文件夹名）
  - 分类（单选，可在下拉中新增分类项）
  - 开始日期
  - 截止日期
  - 任务数量（项目文件夹下一级 Markdown 文件数量，排除元数据文件）
  - 存档（toggle，对应现有隐藏项目功能：存档后任务中心左侧项目列表隐藏该项目）
- 设置页移除旧的“隐藏项目列表”区域，仅新增一个“打开项目中心”按钮（其余现有设置保留）

## Current State Analysis

当前项目结构与关键实现点：

- 插件入口与视图注册：src/main.ts
  - 已注册任务中心 view type：IOTO_TASKS_CENTER_VIEW_TYPE
  - 通过 settings.hiddenProjectNames 控制任务中心项目隐藏（setProjectHidden）
- 设置页：src/settings.ts
  - 现有“隐藏项目列表”UI：displayHiddenProjectSettings
- 数据读取：src/tasks-center/data.ts
  - listProjectFolders：任务根目录下一级文件夹视为项目
  - listProjectTaskFiles：项目目录下一级 Markdown 文件视为任务文件（目前会读取所有 md，需要新增排除逻辑）
- 项目隐藏过滤：src/tasks-center/project-sort.ts
  - filterHiddenProjectEntries 基于项目 name 过滤
- 样式：styles.css（BEM 命名，以 ioto-tasks-center__* 为主）
- 语言：src/lang/locale/*.ts（中/英/繁）

现状限制：

- “项目”目前只有隐藏/显示控制（hiddenProjectNames）
- 没有项目级元数据（分类/日期）存储与编辑入口
- 一旦引入项目元数据文件（每项目一个 _project.md），必须避免：
  - 被当作任务文件计入任务数量
  - 出现在任务中心任务列表中
  - 与用户创建的普通任务文件命名冲突

## Decisions & Assumptions（已确认/固化）

- 项目元数据存储：每个项目文件夹下使用 Markdown 文件保存（已确认）
- 元数据文件名：_project.md（已确认）
- 存档行为：存档后任务中心隐藏该项目（已确认）
- 设置页变更：保留现有设置，仅移除隐藏项目配置 UI，并新增打开项目中心按钮（已确认）
- 分类维护方式：在分类下拉中提供“新增分类…”（已确认）

## Data Model & Interfaces（为未来扩展预留）

### 1) 项目元数据文件

- 路径：`${tasksRootPath}/${projectName}/_project.md`
- 读取来源：优先使用 metadataCache frontmatter（无需读全文），必要时回退到 vault.read + 正则解析
- 写入方式：与现有 Priority 写法一致，采用“读内容 → 更新 YAML frontmatter → modify”方式，避免依赖 Obsidian 内部 fileManager API 差异

### 2) Frontmatter schema（可扩展）

为后续新增字段预留“命名空间对象”：

```yaml
---
IOTOProject:
  category: "分类名"
  startDate: "2026-06-06"
  dueDate: "2026-06-30"
---
```

说明：

- IOTOProject 作为扩展入口，未来增加字段只需新增 IOTOProject 下的 key
- category/startDate/dueDate 全部可选；空值在 UI 中显示为空
- 日期统一存储为字符串（YYYY-MM-DD），UI 使用 `<input type="date">` 读写并回写为该格式

### 3) 分类项（全局）

- 存储在插件 settings（saveData）中：`projectCategoryOptions: string[]`
- 下拉新增分类时：
  - 先写入 settings.projectCategoryOptions（去重、排序）
  - 再写入当前项目的 IOTOProject.category

### 4) “存档”状态

保持与现有实现一致，继续使用：

- settings.hiddenProjectNames: string[]（作为“存档项目名列表”）
- 任务中心继续调用 filterHiddenProjectEntries(hiddenProjectNames) 隐藏项目
- Project Center 中 toggle 修改时复用 main.ts 的 setProjectHidden(projectName, hidden)

## Proposed Changes（文件级改动清单）

### A. 新增 Project Center 视图

1) 新增视图文件

- 新建：src/views/iotoProjectCenterView.ts
  - 导出常量：IOTO_PROJECT_CENTER_VIEW_TYPE（例如 'IOTOProjectCenter'）
  - 导出类：IOTOProjectCenterView extends ItemView
  - UI：表格 List View
    - Header 行：项目名 / 分类 / 开始日期 / 截止日期 / 任务数量 / 存档
    - Row 行：
      - 项目名：纯文本（来自 folder.name）
      - 分类：dropdown（含“新增分类…”项）
      - 开始/截止日期：`<input type="date">`
      - 任务数量：只读数字
      - 存档：toggle（与 hiddenProjectNames 同步）
  - 交互与状态：
    - 首次加载：扫描 tasksRootPath 下所有项目
    - 每行编辑后即时保存（分类/日期写入 _project.md；存档写入 settings.hiddenProjectNames）
    - 对 vault 变更监听复用主插件现有 refresh 机制（当 tasksRootPath 下有 create/delete/rename/modify 时刷新表格）
  - 空状态与错误状态：
    - tasksRootPath 不存在：显示提示（与任务中心一致）
    - 无项目：显示提示

2) 新增 Project Center 数据访问层（元数据读写、任务数量统计）

- 新建：src/tasks-center/project-metadata.ts
  - 导出常量：PROJECT_METADATA_FILE_NAME = '_project.md'
  - 导出方法（示例）
    - getProjectMetadataPath(tasksRootPath, projectName): string
    - ensureProjectMetadataFile(app, tasksRootPath, projectName): Promise<TFile>
    - readProjectMetadata(app, file): ProjectMetadata（从 frontmatter 读取 IOTOProject）
    - updateProjectMetadata(app, file, patch): Promise<void>
    - countProjectTaskNotes(app, tasksRootPath, projectName): number
  - 类型：
    - export interface ProjectMetadata { category?: string; startDate?: string; dueDate?: string; [key: string]: unknown }

3) 新增样式

- 更新：styles.css
  - 新增一组 BEM：ioto-project-center__*
  - 目标：表格可滚动、表头固定（如可行）、列对齐、输入框与 Obsidian theme 风格一致

### B. 主插件注册与命令入口

- 更新：src/main.ts
  - registerView 新增 Project Center view type
  - addCommand 新增 `open-project-center-view`
  - 新增方法：
    - activateIOTOProjectCenterView()
    - getOrCreateIOTOProjectCenterLeaf()

### C. 设置页调整

- 更新：src/settings.ts
  - IOTOTasksCenterSettings 新增：
    - projectCategoryOptions: string[]
  - DEFAULT_SETTINGS 增加默认值：[]
  - display():
    - 移除 “隐藏项目列表” heading 与 displayHiddenProjectSettings 调用
    - 新增一个 Setting：
      - name/desc/button：打开项目中心（调用 plugin.activateIOTOProjectCenterView）
  - 旧隐藏项目逻辑相关私有方法 displayHiddenProjectSettings 将被删除或保留但不再调用（建议删除，减少维护面）

### D. 任务扫描排除 _project.md

为避免 _project.md 被计入任务：

- 更新：src/tasks-center/data.ts
  - listProjectTaskFiles：过滤 markdownFiles 时排除 basename === '_project' 或 name === '_project.md'

同时为避免用户创建任务时覆盖元数据文件：

- 更新：src/tasks-center/task-creation.ts
  - buildTaskFileName / normalizeCustomTaskName 后增加保留名校验：禁止生成 `_project.md`
  - 新增 i18n 错误文案：例如 error.taskNameReservedProjectMeta

### E. i18n 文案补齐

- 更新：
  - src/lang/locale/zh-cn.ts
  - src/lang/locale/en.ts
  - src/lang/locale/zh-tw.ts
- 新增 key（示例）
  - command.openProjectCenterView
  - projectCenter.title / projectCenter.columns.*
  - projectCenter.category.addNew
  - settings.projectCenterEntry.*
  - error.taskNameReservedProjectMeta

## Verification Plan

### 1) 自动化测试（node --test）

新增测试文件：

- 新建：tests/project-metadata.test.mjs
  - 覆盖：
    - updateProjectMetadata 对 frontmatter 的插入/更新/删除行为（字符串级别）
    - readProjectMetadata 对 IOTOProject 的解析容错（缺失、类型异常）
- 新建/更新：tests/data.test.mjs（或新增一个针对 data.ts 的测试）
  - 覆盖：
    - listProjectTaskFiles 的过滤规则：_project.md 不计入 tasks
- 新增：tests/task-creation-reserved-name.test.mjs
  - 覆盖：
    - 自定义任务名为 `_project` 时抛出预期错误

### 2) 手工验收步骤（Obsidian 内）

- 在 tasksRootPath 下准备若干项目文件夹，其中包含：
  - 普通任务 md
  - _project.md（可为空或缺失）
- 打开 Project Center
  - 确认表格字段正确、任务数量不包含 _project.md
  - 分类下拉可新增分类，并能写入 _project.md frontmatter
  - 日期输入可保存并回显
  - 存档 toggle 生效：任务中心项目列表实时隐藏/显示
- 插件设置页：
  - “隐藏项目列表”配置区消失
  - “打开项目中心”按钮可打开 Project Center

## Rollout Notes

- 不改变 manifest 结构；仅增加功能与设置字段
- 与旧版本兼容：
  - existing hiddenProjectNames 继续作为“存档”来源
  - 旧用户无需立即生成 _project.md；仅在编辑元数据时自动创建

