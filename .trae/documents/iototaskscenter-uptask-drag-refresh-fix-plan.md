# 拖拽设置 UpTask 后立即层级刷新的修复计划

## Summary

目标是修复这样一个问题：

- 当前在任务列表中拖拽设置 `UpTask` 后
- 被拖拽任务不会立刻显示成目标任务的子任务
- 而是会暂时跑到列表顶部
- 只有重新加载 Obsidian 之后，层级才恢复正确

基于当前仓库实现，问题核心已经明确：

- 拖拽写回 `UpTask` 后，视图确实会立即调用 `loadTasks()`
- 但 `loadTasks()` 内部读取 `UpTask` 时只依赖 `metadataCache.getFileCache(file)?.frontmatter`
- metadata cache 在拖拽写回后的同一时刻并不会立刻同步更新
- 因此第一次重载拿到的仍然是旧的 `UpTask`
- 结果就是：任务条目保留修改后的 `mtime`，排序上浮到顶部，但层级关系仍按旧缓存计算

因此本次修复的方向不是改拖拽事件本身，而是修复 `UpTask` 的读取来源与刷新时机，使其在“刚写回文件后”也能立即读到最新值。

## Current State Analysis

### 1. 拖拽写回后已经主动触发了任务重载

文件：

- `src/views/iotoTasksCenterView.ts`

已确认现状：

- 拖拽 drop 后会调用 `assignDraggedTaskToParent()`
- 其中：
  - 先调用 `assignUpTaskToFile()` 把新的 `UpTask` 写回文件
  - 然后将 `isTasksLoading = true`
  - 紧接着调用 `await this.loadTasks(this.selectedProject)`

结论：

- 当前问题不是“拖拽后没有刷新”
- 而是“刷新时读取到的 `UpTask` 仍然是旧值”

### 2. `UpTask` 当前只从 metadata cache frontmatter 读取

文件：

- `src/tasks-center/data.ts`

已确认现状：

- `listProjectTaskFiles()` 为每个文件调用 `getUpTaskTitles(app, file)`
- `getUpTaskTitles()` 当前实现为：
  - `app.metadataCache.getFileCache(file)?.frontmatter`
  - 然后读取 `frontmatter?.UpTask`
  - 再交给 `parseUpTaskFrontmatterValue()`

结论：

- 只要 metadata cache 还没刷新，就一定拿不到刚刚写回的新 `UpTask`
- 这正是当前现象的直接成因

### 3. 当前排序是按最近修改时间优先

文件：

- `src/tasks-center/data.ts`

已确认现状：

- `listProjectTaskFiles()` 最终会按：
  - `mtime` 倒序
  - 同时再按名称排序

结论：

- 拖拽写回会修改被拖拽任务文件内容，从而刷新 `mtime`
- 如果此时层级关系读取还是旧值，那么该任务会因为最新修改时间被排到最上方
- 这与用户观察到的现象完全一致

### 4. 当前层级构建算法本身没有问题

文件：

- `src/views/task-hierarchy.ts`

已确认现状：

- `buildVisibleTaskHierarchy()` 根据 `upTaskTitles` 建父子关系
- 自引用和循环引用保护都已存在

结论：

- 当前不需要修改层级构建算法
- 只要 `upTaskTitles` 在重载时正确读到新值，层级展示就会立刻恢复正确

### 5. 仓库里没有现成 frontmatter 文本解析工具

文件：

- `package.json`
- 全仓搜索结果

已确认现状：

- 项目没有显式声明 `yaml` 或 `js-yaml` 作为可直接使用的开发依赖
- 源码中也没有现成的 frontmatter 解析函数可复用
- 当前 frontmatter 相关逻辑基本都采用正则和行处理完成

结论：

- 本次修复不宜引入新的解析依赖
- 更合适的方式是：
  - 针对 `UpTask` 这个单一属性
  - 实现一个轻量的 frontmatter 文本读取能力
  - 优先读取文件正文中的最新 frontmatter，再回退 metadata cache

## Proposed Changes

### 1. 将 `UpTask` 读取从“仅 metadata cache”改为“优先文件内容”

文件：

- `src/tasks-center/data.ts`

变更内容：

- 把当前 `getUpTaskTitles(app, file)` 改造成异步读取流程
- 优先通过 `app.vault.cachedRead(file)` 读取文件正文
- 从正文 frontmatter 中提取 `UpTask`
- 再用现有 `parseUpTaskFrontmatterValue()` 标准化

推荐读取顺序：

1. 先尝试从最新文件内容中解析 `UpTask`
2. 若读取失败，再回退到 `metadataCache.getFileCache(file)?.frontmatter`

原因：

- 这样在拖拽刚写回后，即使 metadata cache 尚未更新，也能立刻拿到文件中的最新 `UpTask`

实现要点：

- 仅解析 `UpTask` 所需的 frontmatter 内容，不做完整 YAML 解析器
- 保持对以下输入兼容：
  - 单值字符串
  - List 数组
  - `[[...]]`

### 2. 新增针对 `UpTask` 的轻量 frontmatter 文本提取函数

文件：

- `src/tasks-center/data.ts`
- 如有必要可抽到新的纯模块

变更内容：

- 新增轻量函数，例如：
  - `extractFrontmatter(content)`
  - `parseUpTaskFromFrontmatterText(frontmatterText)`

支持的最小能力：

- 识别无 frontmatter 的内容
- 识别：
  - `UpTask: "[[父任务]]"`
  - `UpTask: [[父任务]]`
  - `UpTask: 父任务`
  - `UpTask:` 下的多行 List

原因：

- 这次只需要确保 `UpTask` 在刚写回后能被可靠读取
- 没必要为整个插件引入完整 YAML parser

实现要点：

- 保持解析器范围小而明确
- 若文本解析失败，再回退 metadata cache

### 3. 保持拖拽后的主动重载，但不再依赖 cache 时机

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 保留现有 `assignDraggedTaskToParent()` 中“写回后主动 `loadTasks()`”的逻辑
- 不需要再额外增加延迟、轮询或强制重载 Obsidian 的 workaround

原因：

- 一旦 `loadTasks()` 读取来源改为优先文件内容，现有主动重载就足够让 UI 立即正确

实现要点：

- 这次修复不建议通过 `setTimeout` 或重复刷新来碰运气等待 metadata cache
- 应优先从数据源读取正确性上解决问题

### 4. 补充回归测试，锁定“刚写回后立即可见”的场景

文件：

- 建议新增或扩展：
  - `tests/task-hierarchy.test.mjs`
  - `tests/up-task-assignment.test.mjs`
  - 或新增 `tests/up-task-frontmatter-read.test.mjs`

建议覆盖：

- 从文本 frontmatter 中读取单值 `UpTask`
- 从文本 frontmatter 中读取 List 形式 `UpTask`
- `[[父任务]]` 文本读取后仍能解析为纯标题
- 当 metadata cache 仍是旧值，但文件正文已更新时，应优先采用正文中的 `UpTask`

原因：

- 当前 bug 本质就是“真实文件内容”与“metadata cache”短暂不一致时的读取优先级错误
- 必须用测试把这个时序问题锁住

### 5. 仅做最小文档补充

文件：

- `README.md`

变更内容：

- 如需要，可在拖拽说明处补一句：
  - 拖拽设置父任务后，任务列表会立即按新的层级关系刷新

原因：

- 用户当前反馈的是即时刷新 bug，而不是功能缺失
- 文档只需最小同步，不宜扩展范围

## Assumptions & Decisions

- 本次修复重点是“拖拽后立即正确显示层级”，不是重做拖拽交互
- 不通过延迟刷新、重复轮询或强依赖 metadata cache 刷新时机来修复
- 采用“优先读取文件正文中的 `UpTask`，必要时再回退 metadata cache”的方案
- 继续复用现有 `parseUpTaskFrontmatterValue()`，不改 `UpTask` 的最终标准化规则
- 不修改任务排序规则；一旦 `UpTask` 读取正确，当前排序逻辑即可与层级显示正常协同
- 本次不引入新的 YAML 解析依赖

## Verification Steps

执行阶段应完成以下验证：

1. 核心场景验证
   - 打开任务中心
   - 将任务 A 拖到任务 B 上
   - 确认任务 A 立即显示为任务 B 的子任务
   - 不需要重启或重新加载 Obsidian

2. 文件写回验证
   - 确认任务 A 文件已写入新的 `UpTask`
   - 再次刷新任务列表，层级仍保持正确

3. 时序回归验证
   - 模拟 metadata cache 仍为旧值，但文件正文已是新值
   - 确认最终使用的是正文中的最新 `UpTask`

4. 兼容验证
   - 手动填写的 `UpTask` 仍正常解析
   - `[[...]]` 形式依旧兼容
   - 搜索、Tab 筛选、右侧预览打开、拖拽高亮不受影响

5. 自动化验证
   - 运行 `npm test`
   - 运行 `npm run build`
   - 运行 `npm run lint`
   - 对修改文件运行 diagnostics 检查

## Planned File Touch Points

- `src/tasks-center/data.ts`
- 可能新增一个与 `UpTask` frontmatter 读取相关的纯模块
- `tests/task-hierarchy.test.mjs` 或新的 `tests/up-task-frontmatter-read.test.mjs`
- 如有必要，最小修改 `README.md`

执行阶段如发现 `data.ts` 中 frontmatter 读取逻辑过于膨胀，可把“从正文读取 `UpTask`”的纯解析逻辑单独抽出模块，但不扩大到无关 frontmatter 功能。
