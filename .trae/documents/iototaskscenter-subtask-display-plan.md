## Summary
- 为任务中心增加“子任务显示”能力。
- 规则如下：
  - 任务文件可通过 `UpTask` 属性声明上级任务
  - `UpTask` 的值按“任务文件标题”匹配当前列表中的其他任务
  - 若当前项目的任务列表中存在被匹配到的上级任务，则该任务作为子任务缩进显示在上级任务下方
  - 支持多级嵌套显示
- 若 `UpTask` 引用的目标不在当前列表中，则该任务保持普通平铺显示。

## Current State Analysis
- `src/tasks-center/data.ts`
  - 当前任务列表数据来源于 `listProjectTaskFiles(...)`
  - 每个任务条目只返回：
    - `name`
    - `basename`
    - `path`
    - 时间/大小
    - `status`
  - 当前没有读取 frontmatter，也没有读取 `UpTask` 属性
  - 当前排序规则固定为：
    - 先按最近修改时间倒序
    - 再按 `basename` 排序
- `src/tasks-center/types.ts`
  - 当前 `TaskFileEntry` 还没有承载层级关系所需的字段，例如：
    - 任务标题
    - `upTask`
    - 缩进层级
- `src/views/iotoTasksCenterView.ts`
  - 当前任务列表渲染是简单的线性遍历：
    - `const visibleTasks = this.getVisibleTasks();`
    - 然后直接 `for ... of visibleTasks`
  - 当前每行只显示：
    - `task.basename`
    - `task.status.label`
  - 还没有任何层级缩进 class / inline style
- 代码库当前已存在 frontmatter 操作能力，但主要在任务创建链路：
  - `src/tasks-center/task-creation.ts`
  - 这里用于写 `Project` / `Subject` / `Plan`
  - 但任务列表读取链路还没有复用 metadata/frontmatter 读取能力
- `data.ts` 中已使用 `app.metadataCache.getFileCache(file)` 作为任务状态回退来源，说明当前插件已经允许读取 Obsidian metadata cache，可用于提取 `UpTask`

## Proposed Changes
### 1. 扩展任务数据模型
- 修改 `src/tasks-center/types.ts`
- 为 `TaskFileEntry` 增加子任务显示所需字段，建议包括：
  - `title: string`
    - 作为 `UpTask` 匹配键
    - 当前应等于任务文件标题，即现有显示名逻辑
  - `upTaskTitles: string[]`
    - 从 `UpTask` 属性解析得到
    - 为后续支持单值或列表值留出空间
  - `indentLevel?: number`
    - 仅用于渲染时标识缩进层级
- `title` 的取值建议与当前用户可见标题保持一致：
  - 即当前任务列表显示用的标题
  - 对现有任务而言就是 `basename`
  - 这样与用户已确认的“按任务文件标题匹配”一致

### 2. 在 `src/tasks-center/data.ts` 中读取 `UpTask`
- 在生成 `TaskFileEntry` 时，从 metadata cache 读取 frontmatter：
  - `app.metadataCache.getFileCache(file)?.frontmatter`
- 新增一个轻量解析函数，例如：
  - `getUpTaskTitles(app, file): string[]`
  - 或 `parseUpTaskFrontmatterValue(value): string[]`
- 兼容以下 `UpTask` 形态：
  - 单个字符串
  - YAML List
  - 空值 / 缺失
- 解析后统一得到 `string[]`
- 匹配规则：
  - 对值做 trim
  - 过滤空字符串
  - 不做路径解析，不做扩展名转换，直接按任务标题字符串匹配

### 3. 在视图层建立父子任务树并转成平铺显示
- 修改 `src/views/iotoTasksCenterView.ts`
- 不建议在 `data.ts` 中直接做层级排序，因为：
  - tab 过滤发生在视图层
  - 用户要求的是“当前列表下”的父子关系
  - 因此父子匹配应基于过滤后的可见任务集合进行
- 建议新增一组视图层纯函数或私有方法，例如：
  - `buildNestedVisibleTasks(tasks: TaskFileEntry[]): TaskFileEntry[]`
  - `resolveTaskHierarchy(tasks: TaskFileEntry[])`
- 处理流程建议：
  1. 先按现有 tab 规则得到 `visibleTasks`
  2. 用 `title` 构建当前可见任务索引
  3. 遍历每个任务的 `upTaskTitles`
  4. 若其中某个标题能在当前可见任务中匹配到父任务，则挂到该父任务下面
  5. 若没有匹配到任何父任务，则保留在顶层
  6. 最终按“父任务后紧跟其子任务”的顺序输出线性数组，并写入 `indentLevel`
- 多级嵌套：
  - 递归展开
  - 子任务的子任务继续向下缩进

### 4. 明确排序与父子关系合并规则
- 当前任务原始顺序是按修改时间倒序排序
- 新增层级后，建议保留“同级任务之间沿用原始顺序”的规则
- 即：
  - 顶层任务之间保持现有排序
  - 某父任务的直接子任务之间，也保持它们在原始 `visibleTasks` 中的顺序
- 当一个任务的 `UpTask` 包含多个标题时：
  - 建议使用“第一个命中的当前可见父任务”作为父节点
  - 未命中的值忽略
- 这样规则简单且可预测

### 5. 处理异常关系
- 需要显式处理以下边界情况：
  - `UpTask` 指向当前列表外任务：保持顶层显示
  - `UpTask` 指向自身：忽略该父子关系，保持顶层
  - 循环引用（A -> B, B -> A，或更长环）：检测到环后停止递归，把相关任务回退到安全顺序显示，避免无限循环
- 建议在层级构建函数里加入 visited/path 检测
- 目标不是复杂报错，而是“列表稳健显示，不死循环、不丢任务”

### 6. 调整渲染与样式
- 修改 `src/views/iotoTasksCenterView.ts`
  - 任务渲染时不再直接遍历 `getVisibleTasks()` 结果，而是遍历“带层级的可见任务结果”
  - 每个任务行根据 `indentLevel` 添加样式信息
- 修改 `styles.css`
  - 为子任务增加缩进展示方式
  - 建议保持现有单行简洁风格，只做左侧 padding 增量
  - 可选增加轻微视觉提示，例如：
    - 更大的左内边距
    - 左侧辅助线或更轻的文本层级
  - 但不要破坏当前“仅显示标题 + 状态”的极简样式

### 7. 补充测试
- 新增测试文件建议：
  - `tests/task-hierarchy.test.mjs`
- 因为这次核心逻辑是“构造层级关系”，最适合抽成纯函数单测
- 建议覆盖：
  - 无 `UpTask` 时保持原顺序
  - `UpTask` 命中当前列表父任务时，子任务排到父任务下面
  - 多级嵌套正确展开
  - `UpTask` 指向当前列表外任务时保持顶层
  - 自引用不会造成异常
  - 循环引用不会死循环且任务不会丢失
  - 多个 `UpTask` 值时使用第一个命中的父任务
- 若解析 `UpTask` 的 frontmatter 逻辑拆为纯函数，也可在现有测试中补该解析覆盖

## Assumptions & Decisions
- `UpTask` 使用 frontmatter Properties 存储。
- `UpTask` 的值按“任务文件标题”匹配，当前标题采用任务列表显示名，即 `basename`。
- 父子关系只在“当前 tab 过滤后的可见任务列表”内部建立。
- 支持多级嵌套显示。
- 若 `UpTask` 指向当前列表外任务，则不建立父子关系。
- 同级任务顺序沿用当前原始排序，不额外引入新的自定义排序规则。
- 发现自引用或循环引用时，以稳健显示为优先，不报错、不阻塞渲染。

## Verification Steps
- 代码层
  - 确认 `TaskFileEntry` 已承载 `UpTask`/层级所需数据
  - 确认任务列表渲染基于层级展开后的结果，而不是简单平铺
  - 确认父子关系仅在当前可见任务集合中建立
  - 确认循环引用不会导致无限递归
- 自动化验证
  - `npm test`
  - `npm run build`
  - `npm run lint`
  - diagnostics 检查 `src/tasks-center/data.ts`、`src/views/iotoTasksCenterView.ts`、`src/tasks-center/types.ts` 和新增测试文件
- 手动验证
  - 给某任务设置 `UpTask` 指向同列表中的父任务，确认显示为缩进子任务
  - 构造多级父子链，确认多级缩进正确
  - 切换 tab 后，若父任务不在当前列表中，原子任务应恢复顶层显示
  - 构造错误引用和循环引用，确认列表仍稳定显示
