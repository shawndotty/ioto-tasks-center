# 任务列表文件名搜索功能计划

## Summary

目标是在任务中心右侧“任务列表”区域新增一个搜索入口，让用户可以通过任务文件名实时筛选当前项目下的任务文件，便于在任务较多时快速定位目标任务。

本次需求范围已明确收敛为：

- 仅支持按任务文件名搜索
- 搜索作用于当前已选项目的任务列表
- 搜索结果继续遵循原有排序规则
- 与现有任务状态 Tab 筛选共存

本次不包含：

- 按任务编号搜索
- 按标签搜索
- 按关联文件名搜索
- 跨项目全局搜索

## Current State Analysis

### 1. 当前任务列表数据结构只具备文件级基础信息

文件：

- `src/tasks-center/types.ts`
- `src/tasks-center/data.ts`

已确认现状：

- `TaskFileEntry` 当前包含：
  - `name`
  - `basename`
  - `title`
  - `path`
  - `mtime`
  - `ctime`
  - `size`
  - `status`
  - `upTaskTitles`
  - `indentLevel?`
- 在 `listProjectTaskFiles()` 中，任务标题当前直接取 `file.basename`
- 现有数据已经足够支撑“按文件名搜索”，无需额外扩展数据模型

结论：

- 搜索字段可直接使用 `task.title` 或 `task.basename`
- 不需要改动任务扫描结果结构，也不需要新增 frontmatter 解析

### 2. 当前任务列表已有一层状态筛选链路

文件：

- `src/views/iotoTasksCenterView.ts`

已确认现状：

- 右侧任务区当前已有 `TaskFilterTab`
  - `incomplete`
  - `completed`
  - `all`
- 当前 `getVisibleTasks()` 只负责按照 Tab 过滤任务
- 渲染链路为：
  - `this.tasks`
  - `getVisibleTasks()`
  - `buildVisibleTaskHierarchy()`
  - 列表渲染

结论：

- 搜索应接入到 `getVisibleTasks()` 这一层，作为 Tab 过滤之后的第二层筛选
- 这样可以最大程度复用现有层级显示、激活态、高亮与点击打开逻辑

### 3. 当前任务列表区域已有可承载搜索框的位置

文件：

- `src/views/iotoTasksCenterView.ts`
- `styles.css`

已确认现状：

- 右侧任务区结构当前为：
  - 标题栏
  - 当前项目描述
  - Tab 区
  - 任务列表
- 样式文件中已存在以下相关区块样式：
  - `.ioto-tasks-center__section-header`
  - `.ioto-tasks-center__section-desc`
  - `.ioto-tasks-center__tabs`
  - `.ioto-tasks-center__task-list`

结论：

- 搜索框最适合放在“当前项目描述”和 Tab 之间，或紧贴 Tab 上方
- 这样不会影响现有顶部标题与“添加任务”按钮布局

### 4. 当前空状态逻辑已具备复用基础

文件：

- `src/views/iotoTasksCenterView.ts`

已确认现状：

- 现有 `renderTaskFilterEmptyState()` 仅处理“Tab 筛选后无任务”的情况
- 当任务列表为空时，会渲染统一状态组件 `renderState()`

结论：

- 搜索后无结果时，可以继续复用 `renderState()` 风格
- 需要新增更精确的“搜索无结果”文案，避免和 Tab 空状态混淆

### 5. 当前 README 仍是示例插件文档

文件：

- `README.md`

已确认现状：

- 目前 README 基本还是 Obsidian sample plugin 默认内容
- 尚未包含当前插件已有功能的真实使用说明

结论：

- 本次若要同步使用说明，建议只做与“任务列表搜索”直接相关的最小补充
- 不建议在本次计划里顺带全面重写 README，避免范围失控

## Proposed Changes

### 1. 在任务中心视图状态中新增搜索关键词

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 在视图实例状态中新增任务搜索关键词字段，例如：
  - `taskSearchQuery: string`
- 在 `getState()` / `setState()` 中持久化该字段

原因：

- 保持用户在视图刷新、切换 pane、重新打开视图后的搜索上下文
- 与现有 `selectedProject`、`activeTaskFilterTab` 的状态持久化方式保持一致

实现要点：

- 默认值为空字符串
- 反序列化时做字符串兜底，避免旧状态报错

### 2. 在任务列表区域新增搜索输入框

文件：

- `src/views/iotoTasksCenterView.ts`
- `styles.css`

变更内容：

- 在右侧任务列表说明文案下方、Tab 上方新增搜索输入框
- 输入框用于按文件名实时过滤当前任务列表

UI 建议：

- 使用原生 `input[type="search"]` 或 `input[type="text"]`
- 占满任务区宽度
- placeholder 类似：
  - `搜索任务文件名`
  - 或 `输入任务文件名关键词`

原因：

- 这是最符合当前布局的入口位置
- 用户在查看任务列表时可以直接搜索，不需要额外点击展开

实现要点：

- 输入时立即更新本地搜索状态并触发重新渲染
- 若当前项目未选中、任务还在加载、或任务目录为空，输入框可以仍显示但置灰，或仅在可用时渲染
- 为避免过度复杂，本次优先采用“仅在任务区域可用时渲染”的简单方案

### 3. 在可见任务计算链路中叠加文件名模糊匹配

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 改造 `getVisibleTasks()`
- 先执行现有 Tab 筛选
- 再根据搜索关键词按 `task.title` / `task.basename` 做模糊匹配

匹配规则建议：

- 对输入关键词执行 `trim()`
- 空关键词表示不过滤
- 非空关键词时：
  - 使用大小写不敏感匹配
  - 采用 `includes()` 即可满足当前需求

原因：

- 当前需求仅按文件名搜索，不需要更复杂的评分排序或分词
- `includes()` 简洁稳定，且对中文文件名也自然有效

实现要点：

- 保持原始 `this.tasks` 排序不变
- 搜索只是过滤，不重新排序
- 过滤后再交给 `buildVisibleTaskHierarchy()`，这样搜索结果中的父子任务顺序仍遵循现有规则

### 4. 新增搜索无结果空状态

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 当任务数据存在、Tab 过滤后有候选项，但搜索结果为空时，显示单独空状态

建议文案：

- 标题：`未找到匹配任务`
- 描述：`当前项目下没有文件名匹配“关键词”的任务文件。`

原因：

- 与现有“当前筛选下暂无任务”区分开，避免误导用户

实现要点：

- 若搜索词为空，则仍沿用原 `renderTaskFilterEmptyState()`
- 若搜索词非空且结果为空，则走新的搜索空状态函数

### 5. 补充搜索相关样式

文件：

- `styles.css`

变更内容：

- 新增搜索容器和输入框样式，例如：
  - `.ioto-tasks-center__task-search`
  - `.ioto-tasks-center__task-search-input`

原因：

- 保证搜索入口在现有任务区视觉上统一
- 避免默认输入框样式与整体界面不协调

实现要点：

- 与现有 tabs、列表间距保持统一
- 宽度自适应
- 焦点态清晰但不过于抢眼

### 6. 补充纯逻辑测试，覆盖文件名搜索行为

文件：

- 建议新增：`tests/task-search.test.mjs`
- 或扩展现有与视图纯逻辑相关的测试文件

建议新增一个纯函数模块，仅在确有必要时新增：

- `src/views/task-search.ts`

建议抽出的纯逻辑：

- 规范化搜索关键词
- 根据文件名过滤任务列表

原因：

- 当前项目的单测模式偏向纯函数测试
- 直接测试 `ItemView` UI 成本较高，不适合这次需求

建议覆盖场景：

- 空关键词不过滤
- 中文关键词匹配成功
- 英文大小写不敏感
- 特殊字符按普通字符处理
- 只过滤、不改变原有顺序
- 与 Tab 过滤组合时结果正确

### 7. 最小补充使用说明文档

文件：

- `README.md`

变更内容：

- 仅补充与“任务列表搜索”直接相关的一小节使用说明

建议内容：

- 搜索作用范围是“当前项目下的任务列表”
- 搜索字段是“任务文件名”
- 搜索与 Tab 状态筛选可叠加使用

原因：

- 用户明确要求同步更新使用说明
- 但当前 README 仍是示例模板，不适合在本次需求中全面重写
- 因此采取最小可交付策略

## Assumptions & Decisions

- 本次搜索仅按任务文件名匹配，不扩展到 frontmatter、标签、编号、关联文件
- 搜索范围仅限当前已选项目的右侧任务列表
- 搜索与任务状态 Tab 叠加生效
- 搜索只过滤结果，不改变现有排序规则
- 匹配采用大小写不敏感的 `includes()` 模糊匹配
- 中文、英文、数字、特殊字符都按普通字符串匹配处理
- 本次优先保证实现简洁稳定，不引入复杂索引、异步搜索或跨项目搜索
- “300ms 内渲染”这一类性能目标，在本次简化需求下以轻量前端过滤方案自然满足，无需单独加入节流/防抖机制

## Verification Steps

执行阶段应完成以下验证：

1. 基础交互验证
   - 打开任务中心并选中某个项目
   - 确认任务列表出现搜索输入框
   - 输入文件名关键词后，列表实时缩小到匹配项
   - 清空关键词后，恢复完整列表

2. 筛选组合验证
   - 在 `未完成` / `已完成` / `全部` 三个 Tab 下分别输入搜索词
   - 确认结果为“Tab 结果集 ∩ 搜索结果集”

3. 匹配行为验证
   - 中文文件名可匹配
   - 英文大小写不敏感可匹配
   - 含数字的文件名可匹配
   - 特殊字符输入不会报错

4. 排序与层级验证
   - 搜索前后保留当前任务顺序
   - 若结果中存在父子任务关系，层级显示仍正常

5. 空状态验证
   - 在非空任务列表中输入不存在的关键词
   - 显示“未找到匹配任务”的友好提示

6. 状态持久化验证
   - 设置搜索词后刷新视图或重新打开视图
   - 确认搜索状态能按设计保留或正确恢复

7. 自动化验证
   - 运行 `npm test`
   - 运行 `npm run build`
   - 运行 `npm run lint`
   - 对修改文件运行 diagnostics 检查

## Planned File Touch Points

- `src/views/iotoTasksCenterView.ts`
- `styles.css`
- `README.md`
- `tests/task-search.test.mjs` 或其他合适测试文件

如执行阶段发现搜索纯逻辑不适合直接写在视图中，可最小新增一个纯模块 `src/views/task-search.ts`，但只在能明显提升可测试性时才拆分。
