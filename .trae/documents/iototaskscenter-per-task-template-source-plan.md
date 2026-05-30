# 按任务类型分别配置模板与模板来源计划

## Summary

目标是把当前“所有任务类型共用一个模板文件”的方案，升级为“4 种任务类型分别配置自己的模板”，并且每种任务类型都可以单独选择模板来源：

- 直接在设置中输入模板内容
- 使用指定的模板文件

本次需求覆盖的 4 种任务类型来自当前代码中的 `TaskCreationType`：

- `date`
- `plan`
- `topic`
- `normal`

已确认的产品决策：

- 当选择“直接输入模板内容”时，内容按原文写入，不支持 Templater 语法执行
- 当所选模板来源为空或模板文件不存在时，仍继续创建任务文件，但按“无模板”路径处理，后续继续自动补写 `Project` / `Subject` / `Plan`

## Current State Analysis

### 当前实现现状

#### 1. 设置层目前只有一个全局模板文件配置

文件：

- `src/settings.ts`

现状：

- `IOTOTasksCenterSettings` 里只有一个 `taskTemplatePath`
- `DEFAULT_SETTINGS` 只初始化这一项
- 设置页只有一个“任务模板文件”输入框

这意味着所有任务类型当前共用同一个模板文件。

#### 2. 主入口只向视图传递一个模板路径 getter

文件：

- `src/main.ts`

现状：

- 视图注册时传入 `() => this.settings.taskTemplatePath`
- 只存在 `updateTaskTemplatePath(path: string)` 一个更新入口

因此打开中的任务中心视图也只能读取一个共享模板配置。

#### 3. 视图层创建任务时只传一个 `templatePath`

文件：

- `src/views/iotoTasksCenterView.ts`

现状：

- 视图持有 `getTaskTemplatePath: () => string`
- `handleCreateTask()` 调用 `createTaskFile()` 时传入唯一的 `templatePath`

因此无论用户选择哪种任务类型，模板来源都完全相同。

#### 4. 任务创建层当前只支持“模板文件或无模板”两种分支

文件：

- `src/tasks-center/task-creation.ts`

现状：

- `CreateTaskFileOptions` 中只有 `templatePath: string`
- `createTaskFile()` 会先尝试把 `templatePath` 解析为 `TFile`
- 找到模板文件时：
  - 优先尝试走现有 Templater 命令执行链路
  - 若 Templater 执行失败，则回退为写入模板文件原文
- 找不到模板文件时：
  - 直接走“空模板”路径，只补写任务属性

说明：

- 当前已具备稳定的“模板文件 + Templater / 原文回退”能力
- 但尚不支持直接使用设置中的模板内容
- 也尚不支持按任务类型分别配置

#### 5. 测试目前只覆盖模板文件辅助函数

文件：

- `tests/task-creation.test.mjs`

现状：

- 已覆盖 `getTemplaterCommandId()`
- 尚未覆盖按任务类型选择模板配置、内嵌模板内容、模板来源无效回退等逻辑

## Proposed Changes

### 1. 新增“按任务类型的模板配置模型”

文件：

- `src/settings.ts`

变更内容：

- 用“每种任务类型一组模板配置”替代当前单一 `taskTemplatePath`
- 新增模板来源类型定义，例如：
  - `inline`
  - `file`
- 新增每种任务类型对应的配置结构，至少包含：
  - 模板来源类型
  - 模板文件路径
  - 直接输入的模板内容

建议结构：

- 新增 `TaskTemplateSourceMode`
- 新增 `TaskTemplateConfig`
- 在 `IOTOTasksCenterSettings` 中新增一个按任务类型索引的模板配置对象

原因：

- 这是支撑“4 种任务类型独立配置”的基础
- 后续视图层与任务创建层都可以通过统一接口读取对应类型的模板方案

实现要点：

- 保留字段命名清晰，便于未来继续扩展
- 默认值全部为空配置，避免已有用户升级时报错

### 2. 为设置页增加四组模板设置 UI

文件：

- `src/settings.ts`

变更内容：

- 用新的“任务模板”设置区替换当前单一“任务模板文件”输入项
- 为以下 4 类任务分别渲染设置区块：
  - 日期任务
  - 计划任务
  - 主题任务
  - 普通任务

每个区块包含：

- 模板来源选择下拉框或单选项
  - 直接输入模板内容
  - 使用模板文件
- 模板文件路径输入框
- 模板内容文本输入区域

显示逻辑建议：

- 始终展示来源选择
- 与当前来源匹配的输入控件正常展示
- 另一类输入控件可以继续保留其值，但在文案上说明仅当前来源生效

原因：

- 用户明确要求“每种类型都单独设置模板”
- 需要让用户同时能配置来源类型和来源内容

实现要点：

- 设置更新后立即保存
- 与现有设置页风格保持一致
- 模板文件模式文案继续提示当前 Templater 模板目录
- 模板内容模式文案明确说明“按原文写入，不执行 Templater”

### 3. 主入口改为传递“按类型取模板配置”的 getter

文件：

- `src/main.ts`
- `src/views/iotoTasksCenterView.ts`

变更内容：

- 在 `main.ts` 中新增更新单个任务类型模板配置的方法
- 视图注册时，不再只传一个 `taskTemplatePath`
- 改为传入可根据 `TaskCreationType` 读取配置的方法，或直接传入完整模板配置 getter

原因：

- 视图创建任务时，需要按当前 `type` 选择正确的模板配置
- 主入口仍应作为设置状态的唯一写入点

实现要点：

- 变更后打开中的视图仍可在设置修改后实时拿到最新配置
- 新旧设置兼容由 `loadSettings()` 中统一归一化处理

### 4. 任务创建参数改为支持“模板来源 + 内容/路径”

文件：

- `src/tasks-center/task-creation.ts`

变更内容：

- 扩展 `CreateTaskFileOptions`
- 不再只接收单个 `templatePath`
- 改为接收当前任务类型对应的完整模板配置

新增执行分支：

- `file` 模式
  - 若模板文件存在，继续复用现有逻辑：
    - 优先 Templater 执行
    - 失败回退模板文件原文
  - 若模板文件为空或不存在，按“无模板”路径继续创建

- `inline` 模式
  - 若模板内容非空，直接把内容原样写入新文件
  - 不执行 Templater
  - 然后统一补写 `Project` / `Subject` / `Plan`
  - 若模板内容为空，按“无模板”路径继续创建

原因：

- 需求新增了第二种模板来源
- 又因用户已明确“内嵌模板不支持 Templater”，所以应拆清楚两类执行分支

实现要点：

- 保持现有模板文件模式行为不变，避免回归
- 所有分支最后都复用统一的属性补写逻辑
- 若所选来源无效，不抛错阻断，而是平滑退化为“空模板”

### 5. 视图创建任务时按任务类型读取对应模板配置

文件：

- `src/views/iotoTasksCenterView.ts`

变更内容：

- 视图中现有的 `getTaskTemplatePath` 替换为新的模板配置 getter
- `handleCreateTask(type)` 在调用 `createTaskFile()` 时，传入当前 `type` 对应的模板配置

原因：

- 这是把“任务类型”与“模板配置”真正关联起来的关键接点

实现要点：

- 仅修改模板参数的读取与传递
- 不改变现有四种任务的名称输入、文件名生成和文件打开流程

### 6. 增补针对模板来源选择的测试

文件：

- `tests/task-creation.test.mjs`

建议新增覆盖：

- 某种任务类型选择 `inline` 时，可正确读取内嵌模板内容
- `inline` 内容为空时回退为空模板
- `file` 模式下路径为空时回退为空模板
- `file` 模式下仍保留现有 `Templater` 命令 ID 逻辑
- 不同任务类型使用不同模板配置时，选择结果正确

原因：

- 本次需求的主要风险在“配置选择逻辑”而不是 frontmatter 本身
- 需要用纯函数或轻量辅助函数把选择逻辑测稳

### 7. 旧配置兼容策略

文件：

- `src/settings.ts`
- `src/main.ts`

变更内容：

- 旧版本用户可能还存有 `taskTemplatePath`
- 升级后建议在 `loadSettings()` 阶段做最小兼容处理

建议兼容策略：

- 若新结构为空，但旧 `taskTemplatePath` 有值
- 则把旧值迁移/映射到 4 种任务类型的 `file` 模式默认配置

原因：

- 避免用户升级插件后原先的模板配置全部失效
- 能维持当前行为尽量不变，再允许用户逐步细分到各类型模板

实现要点：

- 兼容逻辑只在读取旧数据时触发
- 一旦新结构已存在，则以新结构为准

## Assumptions & Decisions

- 四种任务类型都要独立配置模板，不共享同一个设置项
- 每种任务类型都要显式选择模板来源：`inline` 或 `file`
- `inline` 模式下，模板内容按原文写入，不支持 Templater 执行
- `file` 模式继续沿用当前实现：优先尝试 Templater，失败则写入模板文件原文
- 若所选来源无效：
  - `inline` 内容为空
  - `file` 路径为空
  - `file` 路径不存在
  - 都不阻止创建，而是回退为空模板
- 本次不改变四种任务类型的命名规则
- 本次不改变 `Project` / `Subject` / `Plan` 的补写策略

## Verification Steps

执行阶段应完成以下验证：

1. 设置页验证
   - 确认 4 种任务类型都有独立模板设置区
   - 确认每种类型都可切换来源类型
   - 确认可分别填写模板文件路径或直接输入模板内容

2. 行为验证
   - 日期任务使用自己的模板配置创建
   - 计划任务使用自己的模板配置创建
   - 主题任务使用自己的模板配置创建
   - 普通任务使用自己的模板配置创建
   - 不同类型互不串用模板

3. 来源分支验证
   - `inline` 模式下，模板内容按原文写入
   - `inline` 模式下，不执行 Templater
   - `file` 模式下，继续复用现有模板文件逻辑
   - `file` 无效时回退为空模板而不是报错中断

4. 属性补写验证
   - 4 种任务在使用不同模板来源时，仍正确补写：
     - `Project`
     - `Subject`
     - `Plan`

5. 自动化验证
   - 运行 `npm test`
   - 运行 `npm run build`
   - 运行 `npm run lint`
   - 对最近修改文件运行 diagnostics 检查

## Planned File Touch Points

- `src/settings.ts`
- `src/main.ts`
- `src/views/iotoTasksCenterView.ts`
- `src/tasks-center/task-creation.ts`
- `tests/task-creation.test.mjs`

如执行阶段发现设置结构过于膨胀，再考虑把模板配置类型或辅助函数拆到新的纯模块，但仅在确有必要时进行，不主动扩大改动范围。
