# 任务中心项目列表：排序/分组菜单 - 开发计划（2026-06-06）

## Summary

在 **任务中心（Tasks Center）** 左侧“项目列表”的 **添加项目（+）按钮左侧**，新增一个 **slider（sliders）设置图标按钮**。点击后弹出菜单，支持：

- **排序**
  - 按未完成任务数量（从多到少）（默认）
  - 按未完成任务数量（从少到多）
  - 按项目名称（从 A 到 Z）
  - 按项目名称（从 Z 到 A）
- **分组**
  - 不分组（默认）
  - 按项目分类分组

分组行为已确认：

- 分组顺序：按该分类下“未完成任务总数”从多到少排序
- “未设置分类”的分组：放最后
- 排序范围：**只在组内排序**

## Current State Analysis（基于仓库现状）

- 任务中心视图： [iotoTasksCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)
  - 项目列表 header 只有一个 `+` 按钮（`ioto-tasks-center__icon-button`）
  - 项目列表排序依赖 settings.projectListSortMode，仅支持：
    - `incomplete-count`（默认，从多到少）
    - `name`（从 A 到 Z）
  - 渲染逻辑当前直接遍历 `this.projects`，未支持分组
- 项目隐藏（存档）过滤：
  - `hiddenProjectNames` 通过 [filterHiddenProjectEntries](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/project-sort.ts#L28-L36) 生效
- 项目元数据（分类）已由 Project Center 引入：
  - 每个项目目录 `_project.md` 的 frontmatter `IOTOProject.category`
  - 读写模块： [project-metadata.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/project-metadata.ts)
- 菜单 UI 参考：
  - 任务列表右侧已有“sliders-horizontal”菜单（`showTaskPresentationMenu`），可复用同样的 Menu / 标题格式化模式。

## Proposed Changes

### 1) 扩展“项目列表排序模式”枚举（支持 4 种）

修改文件： [settings.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts)

- 扩展 `ProjectListSortMode`：
  - 保留现有：`incomplete-count`（表示“从多到少”，作为默认与历史值兼容）
  - 新增：`incomplete-count-asc`（从少到多）
  - 保留现有：`name`（A→Z）
  - 新增：`name-desc`（Z→A）
- 更新校验函数 `isProjectListSortMode`
- 更新文案 options：新增 2 个 i18n key（见第 6 节）

修改文件： [project-sort.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/project-sort.ts)

- `sortProjectEntries()` 支持 4 种 sortMode
  - incomplete-count / incomplete-count-asc：按 incompleteCounts 数值比较（desc / asc）
  - name / name-desc：按 collator 比较（asc / desc）

### 2) 新增“项目列表分组模式”设置（none/category）

修改文件： [settings.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts)

- 新增 `ProjectListGroupMode = 'none' | 'category'`
- 在 `IOTOTasksCenterSettings` 增加字段：
  - `projectListGroupMode: ProjectListGroupMode`
- `DEFAULT_SETTINGS` 增加默认值：`'none'`
- 新增校验函数：`isProjectListGroupMode`

修改文件： [main.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts)

- `loadSettings()` 中对新字段做容错回退（缺失则用默认）
- 新增方法：
  - `updateProjectListGroupMode(groupMode: ProjectListGroupMode)`
- 将 getter / setter 注入到 `IOTOTasksCenterView`（见第 3 节）

### 3) 任务中心项目列表：增加设置按钮 + 菜单（排序/分组）

修改文件： [iotoTasksCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)

#### 3.1 在 header actions 中新增 slider 图标按钮

- 在 `renderProjectsPane()` 中 `actionsEl` 内：
  - 在 `+` 按钮左侧增加一个 icon button（复用 `ioto-tasks-center__icon-button`）
  - icon：`sliders-horizontal`
  - click：`this.showProjectPresentationMenu(event)`

#### 3.2 新增菜单逻辑 showProjectPresentationMenu

- Menu 分两段：
  - 排序（4 项）
  - 分组（2 项）
- 标题格式复用现有 `formatMenuOptionTitle(t('menu.category.sort'), label, active)`。
- 选择项后调用：
  - `updateProjectListSortMode(sortMode)`
  - `updateProjectListGroupMode(groupMode)`
- 更新成功后依赖现有 `handleSettingsChange()` 刷新视图。

#### 3.3 扩展 IOTOTasksCenterView 构造参数

当前构造器只接收 `getProjectListSortMode`，需要补齐：

- 增加 getter：
  - `getProjectListGroupMode`
- 增加 setter：
  - `updateProjectListSortMode`
  - `updateProjectListGroupMode`

并在 [main.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/main.ts) 的 `new IOTOTasksCenterView(...)` 处传入对应函数。

### 4) 按分类分组渲染项目列表（并按分类未完成总数排序分组）

修改文件： [iotoTasksCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)

- 在 `loadProjects()` 完成 `this.projectIncompleteCounts` 后，构建 `projectCategoryByName: Map<string, string>`：
  - 通过 `project-metadata.ts` 定位 `_project.md`
  - 优先使用 metadataCache frontmatter（`IOTOProject.category`）
  - 未设置则为空字符串 `''`
- 当 `projectListGroupMode === 'none'`：
  - 保持现有渲染逻辑
- 当 `projectListGroupMode === 'category'`：
  - 将项目按 category 分组
  - 组内项目仍按 `projectListSortMode` 排序
  - 组顺序：
    - 计算每组的未完成总数：sum(incompleteCounts[project])
    - 按总数 desc 排序
    - tie-break：分类名 collator（A→Z）
    - category 为空（未设置）这一组固定排最后
  - UI：
    - 在 listEl 中插入分组标题元素（例如 `div.ioto-tasks-center__project-group-header`）
    - 标题展示分类名；空分类展示 i18n “未设置分类”

为保证可测性与复用性，建议抽出分组/排序的纯函数：

- 新增：`src/views/project-list-group.ts`
  - `buildProjectListSections(projects, incompleteCounts, categoryByName, sortMode, groupMode)` -> sections
- 新增：`tests/project-list-group.test.mjs`

### 5) 样式补齐（设置按钮 svg、分组标题）

修改文件： [styles.css](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css)

- 补齐 `.ioto-tasks-center__icon-button svg` 尺寸（用于 slider icon）
- 新增分组标题样式：
  - `.ioto-tasks-center__project-group-header`（小号、加粗、弱背景或分隔线）

### 6) i18n 文案

修改文件：

- [zh-cn.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts)
- [en.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)
- [zh-tw.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts)

新增 key（建议最小集合）：

- 项目列表设置按钮
  - `view.projectListSettings`（ariaLabel/title）
- 项目排序选项（4 个）
  - `project.sort.incompleteCountDesc`
  - `project.sort.incompleteCountAsc`
  - `project.sort.projectNameAsc`
  - `project.sort.projectNameDesc`
- 项目分组选项（2 个）
  - `project.group.none`
  - `project.group.category`
- 未设置分类分组标题
  - `project.group.uncategorized`

### 7) 测试与验证

- 更新测试：`tests/project-sort.test.mjs`
  - 新增覆盖 `incomplete-count-asc` 与 `name-desc`
- 新增测试（如第 4 节抽纯函数）：
  - `tests/project-list-group.test.mjs` 覆盖：
    - 分组顺序按总未完成 desc
    - 未分类组排最后
    - 组内排序生效
- 运行：
  - `npm test`
  - `npm run build`
- 手工验收（Obsidian）：
  - 任务中心项目列表 header：`slider` 在 `+` 左侧
  - 点击 slider：
    - 可切换 4 种排序、2 种分组
    - 切换后项目列表立即更新
  - 分组模式下：
    - 分组顺序按分类未完成总数从多到少
    - 未分类组在最后
    - 组内按当前排序规则排序

## Assumptions & Decisions

- 项目分类来源：每个项目文件夹 `_project.md` 的 `IOTOProject.category`
- 分组只影响显示结构，不改变“选择项目/加载任务”的行为
- 排序与分组都持久化到插件 settings（与当前 projectListSortMode 一致）

