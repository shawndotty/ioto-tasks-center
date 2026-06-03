# 任务中心多语言改造计划

## Summary

目标是让当前插件接入多语言框架，替换现有硬编码文案，并使插件语言自动跟随 Obsidian 当前语言。

已确认的产品决策：

- 语言来源：跟随 Obsidian 当前语言
- 默认与回退语言：英语 `en`
- 不仅界面文案要国际化，任务创建时会写入文件名或写入文件内容的业务文本，也需要跟随当前语言

本次不包含：

- 新增插件级“手动切换语言”设置
- 支持除 `en` / `zh-cn` / `zh-tw` 之外的新语言
- 修改现有 CSS 或布局逻辑

## Current State Analysis

### 1. 当前已经有一个未接入的多语言骨架

文件：

- `src/lang/helpter.ts`
- `src/lang/locale/en.ts`
- `src/lang/locale/zh-cn.ts`
- `src/lang/locale/zh-tw.ts`

已确认现状：

- `helpter.ts` 当前提供了：
  - `moment.locale().toLowerCase()` 获取当前语言
  - locale merge fallback 逻辑
  - `t(key, args?)` 插值方法
- 当前 locale 文件里只有示例 key：
  - `hello.world`
- 整个代码库里还没有任何地方真正 import 或调用 `t()`

结论：

- 当前国际化基础设施只是起步代码，尚未与业务接轨
- 可以直接复用 `helpter.ts` 的总体思路，但需要正式接入主代码路径

### 2. 当前用户可见文案仍以硬编码为主，且分散在多个层级

已确认包含用户文案的主要文件：

- `src/main.ts`
- `src/settings.ts`
- `src/views/iotoTasksCenterView.ts`
- `src/ui/taskNameModal.ts`
- `src/tasks-center/task-creation.ts`
- `src/tasks-center/project-creation.ts`
- `src/tasks-center/selected-text-subtask.ts`
- `src/tasks-center/up-task-assignment.ts`
- `src/views/task-filter-tabs.ts`
- `src/tasks-center/types.ts`
- `src/views/task-list-presentation.ts`
- `src/tasks-center/data.ts`

文案类型覆盖：

- 命令名称
- 设置页标题、说明、按钮文本
- 视图标题、空态、加载态、菜单项、提示语
- Modal 文案
- Notice / Error message
- 任务状态标签
- tab 筛选标签
- 排序/分组选项标签
- 任务创建生成文件名时使用的中文片段，如“计划”“主题”

结论：

- 这不是单点替换，而是一次跨视图层、设置层、数据层、业务写入层的系统性国际化改造

### 3. 当前有一部分“用户可见文本”实际上参与业务数据生成

文件：

- `src/tasks-center/task-creation.ts`
- `src/tasks-center/types.ts`
- `src/tasks-center/selected-text-subtask.ts`
- `src/tasks-center/project-creation.ts`

已确认现状：

- `buildTaskFileName()` 当前对 `plan` / `topic` 使用中文片段：
  - `计划`
  - `主题`
- 多处错误信息和 Notice 文案直接写在业务逻辑层中
- `TaskFileStatus.label` 当前是中文文本字面量联合类型：
  - `待开始`
  - `进行中`
  - `已完成`
  - `无任务`

结论：

- 如果要支持“写入文本也跟随当前语言”，就不能只在 UI 层包一层 `t()`
- 需要把一部分业务层字符串改为通过 key + 运行时翻译生成

### 4. 当前默认代码语言是中文，而你要求“开发文件默认语言使用英语”

已确认现状：

- 当前多数源码中的默认文案都是中文
- locale 文件里 `en.ts` 和两个中文文件都只有示例内容

结论：

- 需要把 `en.ts` 作为完整、可运行的基准语言包
- 业务代码应尽量通过 `t('...')` 引用 key，而不是再直接写英文或中文字符串
- 中文语言包应从当前中文文案迁移得到

### 5. 当前测试会受国际化改造影响

已确认高影响测试区域：

- `tests/task-status.test.mjs`
- `tests/task-list-presentation.test.mjs`
- `tests/task-priority.test.mjs`
- 与任务创建相关的多个 `*.test.mjs`

影响原因：

- 现有测试中一部分断言依赖中文标签或中文生成结果
- 如果 `buildTaskFileName()`、状态 label、tab label 改为依赖当前语言，则测试需要：
  - 显式固定 locale
  - 或改为断言稳定 key / 非文案字段

结论：

- 执行时必须同步调整测试策略，否则国际化接入后很容易造成测试不稳定

## Proposed Changes

### 1. 正式定义并扩展 i18n 基础模块

文件：

- `src/lang/helpter.ts`
- `src/lang/locale/en.ts`
- `src/lang/locale/zh-cn.ts`
- `src/lang/locale/zh-tw.ts`

变更内容：

- 保留 `helpter.ts` 作为当前入口文件名，避免无关重命名扩大改动面
- 将 `en.ts` 扩展为完整基准语言包
- 将 `zh-cn.ts` / `zh-tw.ts` 扩展为完整语言包
- 为所有用户可见文本建立统一 key 命名空间

建议 key 分组：

- `command.*`
- `settings.*`
- `view.*`
- `modal.*`
- `menu.*`
- `notice.*`
- `error.*`
- `task.status.*`
- `task.filter.*`
- `task.sort.*`
- `task.group.*`
- `task.create.*`

原因：

- `en.ts` 作为基准语言可满足“开发文件默认语言使用英语”
- 明确的 key 结构能降低后续维护成本

实现要点：

- `en.ts` 必须是完整语言全集
- 中文语言包允许缺 key，但会自动 fallback 到 `en`
- `zh-tw.ts` 不应继续只是复制 `zh-cn.ts` 的占位示例，而应补成真实映射

### 2. 为运行时语言获取与翻译调用建立稳定约束

文件：

- `src/lang/helpter.ts`

变更内容：

- 继续采用 `moment.locale()` 跟随 Obsidian 语言
- 增加对 locale 名称的标准化处理，例如：
  - `zh`
  - `zh-cn`
  - `zh-tw`
  - `en`
- 为无法命中的语言提供明确 fallback：
  - 优先匹配精确 locale
  - 再匹配语言主码
  - 最终回退到 `en`

原因：

- 仅用 `moment.locale().toLowerCase()` 直接查 `localeMap`，对 `zh`、`en-gb` 这类值不够稳健

实现要点：

- 需要补一个 locale normalization / resolution 逻辑
- 保持 `t(key, args?)` 对调用层简单稳定

### 3. 在主插件入口、设置页和主视图接入 `t()`

文件：

- `src/main.ts`
- `src/settings.ts`
- `src/views/iotoTasksCenterView.ts`
- `src/ui/taskNameModal.ts`

变更内容：

- 将命令名、设置页标题/描述、按钮文案、菜单项、空态和加载态全部改为使用 `t()`
- 把 `TaskNameModal` 默认文案改为使用翻译 key，而不是中文默认值
- 让主视图中的：
  - pane 标题
  - 项目切换器文本
  - 当前项目说明
  - 任务搜索 / tab / 设置菜单
  - 错误提示
  全部来自 locale

原因：

- 这些是用户最直接接触的界面文案，必须第一批完成

实现要点：

- 对带变量的字符串统一改用插值，例如：
  - `请先创建 {0} 目录`
  - `当前项目：{0}`
- 避免在代码里拼接中英文混合字符串，统一交给 `t(key, args)`

### 4. 将状态、筛选、排序、分组等“标签型文本”从硬编码值改为翻译驱动

文件：

- `src/tasks-center/types.ts`
- `src/views/task-filter-tabs.ts`
- `src/settings.ts`
- `src/views/task-list-presentation.ts`

变更内容：

- `TaskFileStatus.label` 不再依赖中文字面量联合类型
- 推荐把状态对象改为：
  - 存储稳定 key
  - label 在需要渲染时通过 `t()` 计算
- `TASK_FILTER_TABS` 的 label 改为翻译结果或改为 key + 渲染时翻译
- `PROJECT_LIST_SORT_MODE_OPTIONS`
- `TASK_LIST_SORT_MODE_OPTIONS`
- `TASK_LIST_GROUP_MODE_OPTIONS`
  改为通过翻译函数获取显示文本

原因：

- 这类文本广泛复用，最适合用 key 驱动而不是把翻译后的字符串存入核心类型

实现要点：

- 对类型的重构要尽量保持最小侵入
- 若某些纯函数测试依赖 label，建议改为断言 key 或在测试中固定 locale

### 5. 将业务层错误信息、提示和任务创建写入文本国际化

文件：

- `src/tasks-center/task-creation.ts`
- `src/tasks-center/project-creation.ts`
- `src/tasks-center/selected-text-subtask.ts`
- `src/tasks-center/up-task-assignment.ts`
- `src/tasks-center/data.ts`

变更内容：

- 所有 `throw new Error(...)`、`Notice(...)` 的用户可见文本改为 `t()`
- `buildTaskFileName()` 中与任务类型相关的文件名片段改为翻译驱动

关键决策落地：

- 因为你已明确“写入文本也跟随当前语言”，所以：
  - `plan` 任务文件名中的“计划”
  - `topic` 任务文件名中的“主题”
  也要由 locale 决定

原因：

- 这是本次国际化与常规 UI 国际化最大的差异点

实现要点：

- 需要为“用于文件名的任务类型文本”单独定义 key，避免复用 UI 标签造成不必要耦合
- 文件名相关文本应保持简短稳定，避免翻译过长影响命名体验
- 若某些 frontmatter 属性名是协议字段，例如 `Project` / `UpTask` / `Priority`，建议保持不翻译
  - 因为这些是数据结构键，不属于界面文案

### 6. 明确哪些文本“翻译”，哪些文本“保持协议常量”

文件：

- `src/tasks-center/task-creation.ts`
- `src/tasks-center/up-task-assignment.ts`
- `src/tasks-center/data.ts`

变更内容：

- 保持以下字段名不翻译：
  - `Project`
  - `UpTask`
  - `Priority`
  - `Subject`
  - `Plan`
- 仅翻译：
  - UI
  - 错误信息
  - 文件名片段
  - 可见标签

原因：

- frontmatter 属性名已经属于插件的数据协议，翻译它们会影响兼容性和现有数据

实现要点：

- 计划执行时应避免误把“数据协议字段”也替换成多语言文本

### 7. 统一测试策略，确保默认语言为英文且测试可预测

文件：

- `tests/**/*.test.mjs`

重点影响文件：

- `tests/task-status.test.mjs`
- `tests/task-list-presentation.test.mjs`
- 与任务创建文件名相关测试

变更内容：

- 为依赖翻译输出的测试建立可控语言环境
- 建议执行方式：
  - 在测试中 mock / 固定 `moment.locale()` 返回值
  - 默认使用 `en`
- 对不需要关心翻译结果的测试，优先断言稳定 key 或结构字段

原因：

- 你要求开发文件默认语言使用英语，因此测试基线也应以 `en` 为主
- 否则本地 Obsidian 语言环境可能导致测试不稳定

### 8. 补充国际化基础单测

文件：

- 建议新增 `tests/lang-helper.test.mjs`

变更内容：

- 覆盖：
  - 英语默认 fallback
  - `zh-cn` 映射
  - `zh-tw` 映射
  - 不存在语言时回退 `en`
  - 插值替换 `{0}`、`{1}`

原因：

- `helpter.ts` 是本次国际化改造的基础设施，应有独立验证

## Assumptions & Decisions

- 多语言跟随 Obsidian 当前语言，不增加插件单独语言设置
- `en` 作为源码默认基准语言和最终 fallback
- 界面文案与写入文件的可见文本都需要国际化
- frontmatter 协议字段名保持不翻译，以保证兼容性
- 为减少无关改动，暂不重命名 `src/lang/helpter.ts`
- `zh-cn` 和 `zh-tw` 都会实现真实语言包，而不是继续保留示例占位

## Verification Steps

1. 语言切换验证
   - 当 Obsidian 语言为 `en` 时，插件界面为英文
   - 当 Obsidian 语言为 `zh-cn` 时，插件界面为简体中文
   - 当 Obsidian 语言为 `zh-tw` 时，插件界面为繁体中文
   - 未命中语言时回退为英文

2. 主界面验证
   - 命令面板命令名称正确翻译
   - 设置页标题、描述、按钮正确翻译
   - 任务中心视图标题、空态、菜单、tab、状态标签正确翻译

3. 业务文本验证
   - 新建 `plan` / `topic` 任务时，文件名片段会随当前语言变化
   - Error / Notice 文案随语言变化
   - frontmatter 协议字段仍保持原字段名

4. 回归验证
   - 项目列表、任务列表、排序、分组、优先级显示逻辑不受影响
   - 多语言接入后，任务创建、项目创建、子任务转换仍正常工作

5. 自动化与静态检查
   - 运行 `npm test`
   - 运行 `npm run build`
   - 运行 `npm run lint`
   - 对修改文件执行 diagnostics 检查

## Planned File Touch Points

- `src/lang/helpter.ts`
- `src/lang/locale/en.ts`
- `src/lang/locale/zh-cn.ts`
- `src/lang/locale/zh-tw.ts`
- `src/main.ts`
- `src/settings.ts`
- `src/views/iotoTasksCenterView.ts`
- `src/ui/taskNameModal.ts`
- `src/tasks-center/task-creation.ts`
- `src/tasks-center/project-creation.ts`
- `src/tasks-center/selected-text-subtask.ts`
- `src/tasks-center/up-task-assignment.ts`
- `src/tasks-center/data.ts`
- `src/tasks-center/types.ts`
- `src/views/task-filter-tabs.ts`
- `src/views/task-list-presentation.ts`
- `tests/**/*.test.mjs`
- `tests/lang-helper.test.mjs`
