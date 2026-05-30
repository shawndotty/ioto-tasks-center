# 任务列表拖拽设置 UpTask 计划

## Summary

目标是把当前依赖用户手动在笔记属性区填写 `UpTask` 的方式，升级为可在任务中心任务列表里直接通过拖拽任务条目来设置父任务关系。

用户期望的交互是：

- 拖动一个任务条目
- 悬停到另一个目标任务条目上
- 放下后，自动把目标任务对应笔记的双链写入被拖动任务的 `UpTask` 属性
- 写入完成后，重新渲染任务列表，让层级关系立即生效

基于当前代码结构，这项能力可以在不改动现有层级构建算法的前提下完成，因为：

- 当前任务层级已经完全由 `UpTask` frontmatter 驱动
- 当前项目已有稳定的 frontmatter List 属性写入工具
- 当前任务列表 DOM 渲染集中在 `IOTOTasksCenterView`

## Current State Analysis

### 1. `UpTask` 目前只负责“读取并解析”，没有 UI 写入入口

文件：

- `src/tasks-center/data.ts`

已确认现状：

- `listProjectTaskFiles()` 会读取每个任务文件的 frontmatter
- `getUpTaskTitles()` 从 `frontmatter.UpTask` 解析父任务标题
- `parseUpTaskFrontmatterValue()` 已支持：
  - 普通字符串
  - List 数组
  - `[[父任务]]` 形式的 wikilink

结论：

- 数据层已经支持 `UpTask` 的读取和 wikilink 解析
- 本次主要缺的是“把 `UpTask` 写回文件”的交互入口

### 2. 层级渲染完全依赖 `upTaskTitles`

文件：

- `src/views/task-hierarchy.ts`

已确认现状：

- `buildVisibleTaskHierarchy()` 会根据 `upTaskTitles` 找到父任务
- 父任务匹配目前基于当前可见任务列表中的 `task.title`
- 存在以下已有保护：
  - 自引用不会作为有效父任务
  - 循环引用不会死循环

结论：

- 只要拖拽后正确写入 `UpTask`，现有层级渲染逻辑即可直接生效
- 不需要为拖拽功能重写层级算法

### 3. 任务列表 DOM 渲染集中在视图层，适合挂接拖拽事件

文件：

- `src/views/iotoTasksCenterView.ts`

已确认现状：

- 每个任务条目当前都由 `rowEl` 渲染
- 点击交互已经在 `rowEl` 上统一绑定
- 当前没有任何 drag-and-drop 相关逻辑

结论：

- 可以直接在任务条目元素上增加：
  - `draggable`
  - `dragstart`
  - `dragover`
  - `dragleave`
  - `drop`
  - `dragend`
- 不需要引入第三方拖拽库

### 4. 当前项目里已有通用的 frontmatter List 写入工具

文件：

- `src/tasks-center/task-creation.ts`

已确认现状：

- 已存在：
  - `upsertListProperty()`
  - `removeListProperty()`
- 这套逻辑当前已用于写入：
  - `Project`
  - `Subject`
  - `Plan`

结论：

- 可以直接复用这套 frontmatter 写入工具来写入 `UpTask`
- 最好把与 `UpTask` 拖拽相关的写入能力抽成独立模块，而不是塞回任务创建逻辑

### 5. 当前刷新链路已经成熟

文件：

- `src/views/iotoTasksCenterView.ts`
- `src/main.ts`

已确认现状：

- 视图在 vault 文件变化后会刷新
- 视图本身也能主动 `render()`
- 当前任务列表数据来自 `listProjectTaskFiles()`

结论：

- 拖拽完成后，最稳妥的做法是写回文件后主动重新加载当前项目任务，再渲染
- 不需要依赖异步等待 metadata cache 自然刷新

## Proposed Changes

### 1. 新增 `UpTask` 写回纯逻辑模块

文件：

- 建议新增：`src/tasks-center/up-task-assignment.ts`

变更内容：

- 从 `task-creation.ts` 复用或迁移 frontmatter List 属性工具
- 提供专门的 `UpTask` 设置函数，例如：
  - `buildUpTaskWikilink(taskTitle: string): string`
  - `assignUpTaskToFile(app, file, parentTaskTitle)`

写入规则：

- 拖拽放下到目标任务后，把目标任务标题写成：
  - `UpTask:
      - "[[目标任务标题]]"`
- 若原来已有 `UpTask`，统一覆盖为当前目标任务的单项 List

原因：

- 避免把“任务创建时写属性”的代码和“运行时重设父任务”的代码强耦合
- 保持 `UpTask` 拖拽逻辑可测试、可复用

实现要点：

- 若文件内容不可读或不可写，应抛出明确错误
- 若目标标题为空，不执行写入

### 2. 在任务列表视图中加入拖拽状态

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 增加视图级拖拽状态，例如：
  - 当前被拖拽任务路径
  - 当前悬停目标任务路径
  - 是否正在执行 `UpTask` 更新

原因：

- 需要在拖拽过程中高亮源条目和目标条目
- 需要在 drop 后临时禁止重复提交

实现要点：

- 拖拽状态应只保存在内存中，不需要持久化到 view state
- 任何结束路径都应清理状态：
  - `drop`
  - `dragend`
  - 失败异常

### 3. 为任务条目接入原生拖拽事件

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 每个任务条目增加 `draggable = true`
- 对每个条目挂接以下事件：
  - `dragstart`
  - `dragover`
  - `dragleave`
  - `drop`
  - `dragend`

预期交互：

- 拖拽开始时记录源任务
- 悬停到目标条目时高亮目标
- 放下时把目标任务作为父任务写入源任务的 `UpTask`

原因：

- 当前需求只需要“拖拽到目标条目上建立父子关系”，原生事件就足够
- 不需要引入排序型拖拽框架

实现要点：

- `dragover` 中需要 `preventDefault()` 才允许 drop
- 目标条目必须排除自身
- 若当前正在写入中，应忽略新的 drop

### 4. 增加非法拖拽保护

文件：

- `src/views/iotoTasksCenterView.ts`
- 可选新增纯逻辑辅助模块

需要处理的非法场景：

- 拖到自己身上
- 拖到自己当前的后代任务上，导致潜在循环引用
- 源文件或目标文件已不存在

推荐行为：

- 阻止写入
- 可选弹出 `Notice` 提示，例如：
  - `不能将任务拖拽到自身上`
  - `不能把父任务拖到自己的子任务下`

原因：

- 虽然现有层级构建对循环引用有保护，但从交互层面应直接阻止无效操作

实现要点：

- 可基于当前可见层级结果与 `upTaskTitles` 推断后代关系
- 至少应拦截“自身”和“明显形成循环”的情况

### 5. 拖拽完成后主动重新加载当前项目任务

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 在 `drop` 成功写入后，主动调用当前项目任务重载逻辑
- 重载完成后重新渲染

原因：

- 确保最新 `UpTask` 立即参与层级构建
- 避免依赖 metadata cache 的时机不确定性

实现要点：

- 不只调用 `render()`，应优先重新读取当前项目任务文件列表
- 成功后清理拖拽状态
- 失败时恢复 UI 状态并提示错误

### 6. 增加拖拽中的视觉反馈样式

文件：

- `styles.css`

变更内容：

- 为任务条目新增拖拽样式类，例如：
  - `.is-dragging`
  - `.is-drop-target`
  - 可选 `.is-drop-invalid`

原因：

- 让用户清楚看到：
  - 当前正在拖哪个任务
  - 当前悬停的目标任务是谁
  - 目标是否有效

实现要点：

- 样式保持轻量，不破坏现有任务行布局
- 建议使用边框/背景色提示，而不是大面积位移动画

### 7. 补充纯逻辑测试

文件：

- 建议新增：`tests/up-task-assignment.test.mjs`
- 可扩展：`tests/task-hierarchy.test.mjs`

建议覆盖：

- `UpTask` 拖拽写入时会生成目标任务的简单 wikilink
- 已有 `UpTask` 时会覆盖为新的单项 List
- 自拖拽会被拦截
- 拖到后代任务时会被拦截
- 成功写入后重新解析层级时，父子关系正确

原因：

- 本次需求的核心风险在：
  - frontmatter 写回正确性
  - 非法拖拽保护
  - 写入后层级关系能否立刻生效

### 8. 最小补充使用说明

文件：

- `README.md`

变更内容：

- 补充任务列表拖拽设置父任务的说明

建议内容：

- 在任务中心中拖动任务到另一个任务条目上，可把目标任务设为父任务
- 拖拽本质上会自动写入 `UpTask` 属性
- 写入后任务列表会立即重排显示层级

原因：

- 用户明确要求拖拽能力替代手填属性的使用方式
- 需要给测试与使用者一个明确的操作说明

## Assumptions & Decisions

- 拖拽行为的唯一目标是“设置父任务”，不是任务排序
- drop 到目标条目时，写入的是目标任务标题对应的简单双链：`[[目标任务标题]]`
- 若原来已有 `UpTask`，统一覆盖为新的单项 List
- 本次不扩展“拖回空白区域以移除父任务”的能力
- 本次只在当前任务列表可见条目范围内支持拖拽设父任务
- 非法场景需要前置阻止，尤其是：
  - 拖到自己
  - 拖到自己的子任务或后代任务
- 成功写入后，采用“主动重新加载当前项目任务”的方式刷新 UI

## Verification Steps

执行阶段应完成以下验证：

1. 基础拖拽验证
   - 打开任务中心并选择一个存在多个任务的项目
   - 将任务 A 拖到任务 B 上
   - 确认任务 A 的文件被写入 `UpTask: [[任务B]]`
   - 确认列表立即重新渲染，A 显示到 B 下方并缩进

2. 覆盖写入验证
   - 已有 `UpTask` 的任务再拖到另一个父任务上
   - 确认原 `UpTask` 被覆盖成新的目标任务双链

3. 非法拖拽验证
   - 拖到自己身上时不生效
   - 将父任务拖到自己的子任务上时不生效
   - 确认不会形成错误层级

4. 兼容验证
   - 现有手动填写的 `UpTask` 仍然能被正常解析
   - `[[...]]` 形式依旧兼容
   - 搜索、Tab 筛选、右侧预览打开不受影响

5. 自动化验证
   - 运行 `npm test`
   - 运行 `npm run build`
   - 运行 `npm run lint`
   - 对新增或修改文件运行 diagnostics 检查

## Planned File Touch Points

- `src/views/iotoTasksCenterView.ts`
- `src/tasks-center/task-creation.ts` 或新的 `src/tasks-center/up-task-assignment.ts`
- `styles.css`
- `tests/up-task-assignment.test.mjs`
- `tests/task-hierarchy.test.mjs`
- `README.md`

执行阶段如发现 frontmatter 写入工具复用成本过高，优先把通用 List 属性写回逻辑抽到新的纯模块，再由“任务创建”和“拖拽设父任务”共同复用，但不主动扩大范围到无关功能。
