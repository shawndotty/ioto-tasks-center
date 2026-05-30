## Summary
- 将当前日期型任务文件名里写死的日期格式 `YYYY-MM-DD` 改为插件设置项。
- 默认值保持为 `YYYY-MM-DD`，以兼容现有行为。
- 用户可在设置页中自定义日期格式，语法采用 `Moment/Day.js` 风格。
- 若用户填写无效格式，则自动回退为默认值 `YYYY-MM-DD`。

## Current State Analysis
- `src/tasks-center/task-creation.ts`
  - 当前日期型任务命名逻辑在 `buildTaskFileName(...)`：
    - `date` 类型直接返回 ``${projectName}-${formatDate(date)}.md``
  - `formatDate(date)` 目前是手写函数，只输出固定格式：
    - `YYYY-MM-DD`
  - 当前 `CreateTaskFileOptions` 没有日期格式参数，说明创建链路还不支持运行时配置。
- `src/settings.ts`
  - 当前已有任务中心相关设置：
    - `tasksRootPath`
    - `projectListSortMode`
    - `hiddenProjectNames`
    - `taskTemplatePath`
  - 还没有“日期型任务日期格式”相关设置项。
- `src/main.ts`
  - 当前会把任务根目录、排序、隐藏项目、模板路径 getter 传给 `IOTOTasksCenterView`
  - 还没有把日期格式 getter 传入视图
  - 也没有对应的设置更新方法
- `src/views/iotoTasksCenterView.ts`
  - 当前创建日期任务时直接调用 `createTaskFile(...)`
  - 没有传入日期格式配置
- `tests/task-creation.test.mjs`
  - 当前已经覆盖：
    - 日期任务命名固定为 `项目A-2026-05-30.md`
  - 但还没有覆盖：
    - 自定义日期格式
    - 非法日期格式回退默认值

## Proposed Changes
### 1. 扩展设置模型 `src/settings.ts`
- 在 `IOTOTasksCenterSettings` 中新增：
  - `dateTaskDateFormat: string`
- 在 `DEFAULT_SETTINGS` 中设置默认值：
  - `dateTaskDateFormat: 'YYYY-MM-DD'`
- 在设置页“任务创建”分组中新增输入项，例如：
  - 名称：`日期任务日期格式`
  - 说明：提示支持 `Moment/Day.js` 风格，如 `YYYY-MM-DD`、`YYYY年MM月DD日`
  - 占位符：`YYYY-MM-DD`
- 新增一个归一化/校验函数，例如：
  - `normalizeDateTaskDateFormat(input: string): string`
- 规则：
  - `trim`
  - 空字符串回退默认值
  - 无效格式回退默认值

### 2. 在 `src/main.ts` 中接入设置更新与传参
- 新增设置更新方法，例如：
  - `updateDateTaskDateFormat(format: string): Promise<void>`
- 在 `loadSettings()` 时对该设置做归一化，防止旧数据或非法值残留。
- 在注册 `IOTOTasksCenterView` 时，新增传入：
  - `getDateTaskDateFormat: () => string`
- 设置变更后继续复用现有：
  - `saveSettings()`
  - `applySettingsToOpenViews()`

### 3. 修改任务创建核心逻辑 `src/tasks-center/task-creation.ts`
- 将日期型任务命名逻辑从“固定 `formatDate(date)`”改为“使用传入配置格式”。
- 修改 `CreateTaskFileOptions`，新增：
  - `dateTaskDateFormat: string`
- 修改 `buildTaskFileName(...)` 签名或新增辅助函数，使其支持传入日期格式。
- 保持其他任务类型命名规则不变：
  - `normal`
  - `plan`
  - `topic`
- 当前已确认采用 `Moment/Day.js` 风格格式语法。

### 4. 采用统一的日期格式化与回退策略
- 由于用户选择了 `Moment/Day.js` 风格，建议直接在任务创建模块中使用兼容的格式化方案。
- 如果当前运行环境可直接使用 Obsidian 自带 `moment`，可以采用它；否则应在本地实现最小必要支持，但优先选用与用户确认一致的格式语义。
- 无论具体实现方式如何，都必须保证：
  - `YYYY-MM-DD` 输出与当前行为一致
  - 非法格式最终回退为默认值 `YYYY-MM-DD`
- 为避免把无效格式传播到命名逻辑，建议先做：
  - `resolveValidDateTaskDateFormat(input): string`
  - 再用于真正格式化

### 5. 修改视图层 `src/views/iotoTasksCenterView.ts`
- 构造函数新增：
  - `getDateTaskDateFormat: () => string`
- 在调用 `createTaskFile(...)` 时传入当前日期格式设置。
- 其他 UI 交互无需改变：
  - 日期任务仍然无需输入名称
  - 仍在当前项目下创建

### 6. 补充测试
- 修改 `tests/task-creation.test.mjs`
- 建议增加以下测试：
  - 默认日期格式仍生成 `项目A-2026-05-30.md`
  - 自定义格式例如 `YYYY年MM月DD日` 时生成 `项目A-2026年05月30日.md`
  - 空白格式回退默认值
  - 无效格式回退默认值
- 若日期格式归一化逻辑拆成纯函数，也应直接单测该纯函数。

## Assumptions & Decisions
- 用户填写的日期格式语法采用 `Moment/Day.js` 风格。
- 默认值保持 `YYYY-MM-DD`。
- 非法格式或空白格式都会自动回退到默认值，而不是阻止创建。
- 本次仅调整“日期型任务文件名中的日期格式”，不额外影响：
  - 普通任务
  - 计划任务
  - 主题任务
  - 文件内容中的日期插值

## Verification Steps
- 代码层
  - 确认日期任务命名逻辑已改为读取设置值
  - 确认设置加载和更新时会对格式做归一化/回退
  - 确认其他任务类型命名逻辑不受影响
- 自动化验证
  - `npm test`
  - `npm run build`
  - `npm run lint`
  - diagnostics 检查 `src/settings.ts`、`src/main.ts`、`src/tasks-center/task-creation.ts`、`src/views/iotoTasksCenterView.ts` 和 `tests/task-creation.test.mjs`
- 手动验证
  - 在设置页中将日期格式改为 `YYYY年MM月DD日`
  - 创建日期任务，确认文件名使用新格式
  - 将设置改为空白或无效值，确认仍回退为 `YYYY-MM-DD`
