# 左侧项目列表滚动位置丢失修复计划

## Summary

目标是修复任务中心左侧项目列表在项目数量超过可视高度时的滚动回顶问题：

- 当用户滚动到列表下部并点击某个项目后
- 左侧项目列表不应自动回到最上方
- 当前选中的项目应继续保持可见，最好保留用户点击前后的滚动上下文

本次计划的核心策略是：

- 保留左侧项目列表滚动容器的 `scrollTop`
- 在导致重渲染的交互前记录滚动位置
- 在重渲染完成后恢复滚动位置

基于当前实现，这个问题主要发生在 `src/views/iotoTasksCenterView.ts` 中整页重渲染时，属于视图层状态丢失，不需要修改数据层。

## Current State Analysis

### 1. 根因已经定位为整页重渲染导致滚动容器被销毁

文件：

- `src/views/iotoTasksCenterView.ts`

已确认现状：

- `selectProject()` 中会先设置：
  - `this.selectedProject = projectName`
  - `this.isTasksLoading = true`
- 随后立即调用 `this.render()`
- `render()` 内部第一步就是：
  - `root.empty()`

结论：

- 左侧项目列表滚动容器 `.ioto-tasks-center__project-list` 会被整个销毁并重建
- 浏览器自然会把新的滚动容器位置重置到顶部

相关位置：

- `selectProject()` 在 `src/views/iotoTasksCenterView.ts`
- `render()` 在 `src/views/iotoTasksCenterView.ts`

### 2. 左侧项目列表确实是独立可滚动容器

文件：

- `styles.css`

已确认现状：

- `.ioto-tasks-center__project-list` 使用：
  - `display: flex`
  - `flex-direction: column`
  - `overflow: auto`

结论：

- 这不是浏览器窗口滚动问题
- 是项目列表内部滚动容器的 scroll state 丢失

### 3. 当前没有任何滚动位置保存与恢复逻辑

文件：

- `src/views/iotoTasksCenterView.ts`

已确认现状：

- 当前视图类中没有：
  - 针对项目列表 DOM 的引用缓存
  - `scrollTop` 持久化字段
  - 渲染后的滚动恢复逻辑

结论：

- 只要发生 `root.empty()`，项目列表就会回顶
- 问题不仅可能出现在点击项目，也可能出现在其他会触发整页重渲染、同时用户已经滚动到较低位置的场景

## Proposed Changes

### 1. 在视图类中增加项目列表滚动位置状态

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 新增一个视图私有字段，用于缓存左侧项目列表的滚动位置
- 建议命名：
  - `private projectListScrollTop = 0;`

原因：

- 需要在重渲染前记录、重渲染后恢复
- 这个状态属于纯 UI 状态，不需要持久化到 view state

决策：

- 本次只保留会话内滚动状态
- 不把滚动位置写入 `getState()` / `setState()`

### 2. 为项目列表容器建立“记录 + 恢复”机制

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 增加一个辅助方法，读取当前项目列表容器的 `scrollTop`
- 增加一个辅助方法，在项目列表渲染后把缓存的 `scrollTop` 写回去
- 渲染 `renderProjectsPane()` 时，在创建 `listEl` 后立即恢复缓存滚动位置
- 同时给 `listEl` 绑定 `scroll` 监听，在用户滚动时持续更新 `projectListScrollTop`

建议拆成小函数：

- `captureProjectListScrollTop(): void`
- `restoreProjectListScrollTop(listEl: HTMLElement): void`

原因：

- 避免在多个交互入口散落 DOM 查询逻辑
- 让滚动恢复逻辑只围绕项目列表容器工作

实现细节：

- 当前容器选择器可直接使用 `.ioto-tasks-center__project-list`
- 若渲染结果不是正常列表状态（比如 root missing / empty state），仍可安全恢复，超出范围的 `scrollTop` 会被浏览器自动夹紧

### 3. 在触发整页重渲染前先捕获项目列表滚动位置

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 在会主动调用 `render()` 的关键交互路径前，先执行 `captureProjectListScrollTop()`

至少覆盖：

- `selectProject()`
- 其他在项目列表可见情况下会触发整页重绘、且可能影响左侧滚动上下文的方法

优先检查并在必要时补上：

- `loadProjects()` 中的中间渲染
- `handleCreateProject()`
- 依赖 `refreshFromVaultChange()` 导致的刷新入口

原因：

- 问题的直接触发点是用户点击项目
- 但如果只修一个入口，其他同类刷新仍可能把滚动位置清掉

决策：

- 执行阶段优先在公共 `render()` 入口前整理捕获时机，尽量避免遗漏
- 不扩大为复杂的 diff 渲染，只做最小修复

### 4. 保证选中项更新后仍在原滚动上下文中可见

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 以“恢复原滚动位置”为主，而不是切换项目后强制滚动到选中项

原因：

- 用户当前诉求是“不自动回到顶部，就看不到之前选择的项目”
- 恢复原位置可以最大程度保留用户当下浏览上下文

决策：

- 本次不额外引入 `scrollIntoView()` 自动滚动
- 避免用户每次点击项目都触发新的跳动

### 5. 补充回归测试

文件：

- 建议新增：
  - `tests/project-list-scroll-state.test.mjs`
- 或扩展已有视图相关测试文件

建议覆盖的最小范围：

- 滚动位置缓存函数在未找到列表 DOM 时不会报错
- 恢复函数会把缓存的 `scrollTop` 应用到新列表容器
- 记录与恢复逻辑不会污染其他视图状态

说明：

- 当前仓库的视图交互测试偏轻量
- 若直接做 DOM 级完整集成测试成本过高，可以把滚动记录/恢复辅助函数抽成纯函数或近纯函数，再做单元测试

### 6. 最小文档变更

本次可不强制修改 README。

原因：

- 这是一个交互 Bug 修复，不是新的用户可见功能入口
- 若执行阶段顺手在变更说明或测试备注里记录即可，无需扩展用户文档

## Assumptions & Decisions

- 问题根因是项目列表滚动容器在整页重渲染时被销毁，导致 `scrollTop` 丢失
- 修复策略采用“记录并恢复滚动位置”，不做局部虚拟渲染或复杂 DOM 复用
- 本次不将左侧滚动位置持久化到插件状态，仅在当前视图实例生命周期内保存
- 本次不额外增加“自动滚动到选中项目”逻辑，以避免新的界面跳动
- 修复范围优先覆盖点击项目导致的回顶问题，并尽量兼容其他同类整页刷新场景

## Verification Steps

执行阶段应完成以下验证：

1. 基础复现验证
   - 准备足够多的项目目录，让左侧项目列表超过可视高度
   - 滚动到列表下部
   - 点击一个靠下项目
   - 修复后列表不再回到顶部

2. 连续切换验证
   - 在列表下部连续点击多个不同项目
   - 左侧滚动位置应保持稳定，不频繁跳顶

3. 边界场景验证
   - 项目列表为空
   - 根目录不存在
   - 新建项目后刷新列表
   - vault 变更触发刷新
   - 以上场景下不应出现异常报错

4. 回归验证
   - 左侧项目选中态仍正确更新
   - 右侧任务列表仍正常刷新
   - 搜索、拖拽、tab 切换等功能不受影响

5. 自动化验证
   - 运行 `npm test`
   - 运行 `npm run build`
   - 运行 `npm run lint`
   - 对修改文件执行 diagnostics 检查

## Planned File Touch Points

- `src/views/iotoTasksCenterView.ts`
- 可能新增或扩展一个小型测试文件到 `tests/`

执行阶段如发现 `render()` 前的捕获点过于分散，可在不改变行为的前提下，把项目列表滚动状态维护整理成 2-3 个私有辅助方法，但不扩大为视图整体重构。
