## Summary

为插件新增命令 `将选中文本转为子任务`。当用户在 Markdown 任务文件中选中文本并执行命令时，插件会在当前文件所在目录创建一个“普通任务”笔记，文件名来源于选中文本；新文件会应用“普通任务”模板；随后补齐与当前文件一致的 `Project` 属性，并写入 `UpTask` 属性，值为当前父任务文件的 wikilink。

## Current State Analysis

- 命令注册目前集中在 `src/main.ts`，当前只有 `打开任务中心视图` 一个命令，`main.ts` 保持较轻量，适合继续把命令入口放这里，再将业务逻辑下沉到 `src/tasks-center/` 模块。
- 现有任务创建主流程在 `src/tasks-center/task-creation.ts` 的 `createTaskFile()`：
  - 已支持四种任务类型；
  - `normal` 类型文件名规则已存在；
  - 已支持普通任务模板应用；
  - 已在创建后统一补 `Project` / `Plan` / `Subject` 属性；
  - 已支持在有 `targetLeaf` 时触发 Templater。
- `src/tasks-center/up-task-assignment.ts` 已提供：
  - `buildUpTaskWikilink()`：把标题转为 `[[标题]]`
  - `assignUpTaskToFile()`：把 `UpTask` 写入目标文件
- `obsidian.d.ts` 确认当前最低兼容 API 下可直接使用：
  - `editorCheckCallback(checking, editor, ctx)` 限制命令出现条件
  - `ctx.file` 获取当前编辑中的文件
  - `editor.getSelection()` 读取选中文本
- 现有代码没有“从当前编辑器选中文本创建子任务”的模块，也没有“复制当前文件 Project 属性到新任务”的通用工具。

## Proposed Changes

### 1. `src/main.ts`

- 新增命令注册：
  - `id`: `convert-selected-text-to-subtask`
  - `name`: `将选中文本转为子任务`
- 使用 `editorCheckCallback` 而不是普通 `callback`：
  - 仅在当前上下文为 Markdown 编辑器时显示
  - 仅在 `ctx.file` 存在时显示
  - 仅在当前文件位于已配置的 `tasksRootPath` 下时显示
  - 仅在 `editor.getSelection().trim()` 非空时显示
- 命令执行时调用新的业务模块函数，不在 `main.ts` 内堆叠实现细节，保持入口薄。

### 2. 新增 `src/tasks-center/selected-text-subtask.ts`

- 新建一个专用模块承接该命令逻辑，避免把编辑器命令实现塞进 `main.ts` 或 `task-creation.ts`。
- 模块职责：
  - 校验当前文件是否为有效任务文件
  - 从当前文件路径解析任务根目录下的项目名和当前文件所在目录
  - 读取并规范化选中文本，生成普通任务名称
  - 调用 `createTaskFile()` 创建普通任务文件并应用普通任务模板
  - 把当前文件的 `Project` 属性复制到新文件
  - 把当前父任务标题写入新文件 `UpTask`
  - 在需要时恢复当前编辑上下文

#### 计划中的具体函数划分

- `convertSelectedTextToSubtask(options)`
  - 输入：`app`、`editor`、`ctx.file`、`tasksRootPath`、普通任务模板配置、日期格式
  - 输出：新建的 `TFile`
- `resolveCurrentTaskContext(file, tasksRootPath)`
  - 校验文件必须位于 `${tasksRootPath}/<project>/...`
  - 提取：
    - `projectName`
    - 当前目录路径
    - 父任务标题（`file.basename`）
- `normalizeSelectedSubtaskName(selection)`
  - 复用 `normalizeCustomTaskName()` 规则
  - 对多行选中内容先做空白折叠，再生成合法文件名
- `copyProjectPropertyFromSourceToTarget(app, sourceFile, targetFile, fallbackProjectName)`
  - 精确复制当前文件中的 `Project` 属性值
  - 若源文件缺失 `Project`，则回退为 `fallbackProjectName`

### 3. `src/tasks-center/task-creation.ts`

- 保持 `createTaskFile()` 作为“普通任务创建 + 模板应用”的统一入口，不重复造创建逻辑。
- 新增或导出一组通用属性工具，供“复制父任务的 Project 属性”场景复用。

#### 计划中的具体调整

- 新增通用的列表属性构建/写入能力：
  - `buildListPropertyFrontmatterLines(propertyName, values)`
  - `upsertListPropertyValues(content, propertyName, values)`
- 新增通用读取能力：
  - `extractListPropertyValuesFromContent(content, propertyName)`
- 保留现有 `upsertListProperty(content, propertyName, value)` 作为单值快捷封装，内部可转调新的多值版本，减少行为分叉。

#### 这样做的原因

- 用户要求“新子任务需要包含和当前打开任务文件同样的 Project 属性”，含义比“仅使用当前目录名作为 Project”更强。
- 当前系统虽然通常只写单值 `Project`，但这里按“精确复制现有属性，缺失时才回退目录名”设计更稳妥，也更符合需求字面意思。

### 4. `src/tasks-center/up-task-assignment.ts`

- 复用现有 `assignUpTaskToFile()` 和 `buildUpTaskWikilink()`，不重复实现 `UpTask` 写入。
- 如在执行中发现 `cachedRead()` 会引发刚创建文件的时序问题，则在实现阶段把这里的读取统一改为 `read()`；计划中按“优先复用，必要时做一致性修正”执行。

### 5. 当前叶子 / 模板执行时的编辑体验

- 命令触发场景来自当前编辑器，因此不应新增可见 pane，也不应让用户最后停留在新建子任务上。
- 计划做法：
  - 从当前激活的 Markdown 视图拿到当前 `leaf`
  - 创建普通子任务时把该 `leaf` 同时作为模板执行过程所需上下文
  - 若普通任务模板触发了 Templater 并导致当前叶子打开了新文件，则命令结束前重新打开原父任务文件
  - 恢复编辑器焦点，并尽量恢复原选中文本或至少恢复原光标位置

#### 对 `task-creation.ts` 的配套调整

- 为模板执行链路补一个可选的“执行后恢复源文件”能力，而不是只恢复 active leaf。
- 当前 `executeTemplaterTemplate()` 只会在 finally 中 `setActiveLeaf(sourceLeaf)`；如果 `targetLeaf === sourceLeaf`，这并不会把原父任务重新打开。
- 实现阶段会把恢复逻辑明确化：
  - 若源文件和目标文件不是同一个文件，则在模板执行完成后重新打开源文件
  - 避免普通任务模板执行成功但把用户从父任务编辑上下文中带走

### 6. 测试

- 扩展 `tests/task-creation.test.mjs`，覆盖新增的纯函数：
  - 选中文本归一化为普通任务文件名
  - 多值 `Project` frontmatter 复制
  - `UpTask` wikilink 生成仍符合 `[[父任务标题]]`
  - `extractListPropertyValuesFromContent()` 对以下情况正确：
    - 单值 List
    - 多值 List
    - 标量值
    - 缺失属性
- 新增 `tests/selected-text-subtask.test.mjs`：
  - 当前文件路径可正确解析出 `projectName`
  - 不在任务根目录下的文件会被拒绝
  - 空选中文本会被拒绝
  - 选中文本含换行 / 非法路径字符时能被规范化
- 对“模板应用 + 属性追加”的时序不做高耦合集成测试，仍以已有构建/lint 和纯逻辑测试为主。

## Assumptions & Decisions

- 命令仅针对 Markdown 编辑器里的任务文件生效，不会在非编辑器视图、空选择、非任务目录文件中显示。
- 新子任务文件名直接基于当前选中文本，使用现有 `normalizeCustomTaskName()` 规则做合法化处理。
- 新子任务创建位置以“当前文件所在目录”为准；在现有项目结构下，这等价于位于当前项目目录中。
- 新子任务类型固定为 `normal`，并使用用户当前配置的“普通任务模板”。
- `Project` 属性按“优先精确复制当前文件中的属性值，缺失时回退为当前项目目录名”实现。
- `UpTask` 属性值使用当前文件标题的 wikilink，即 `[[当前文件 basename]]`。
- 命令执行完成后，默认回到原父任务文件继续编辑，不额外为模板执行创建新的可见 pane。
- 不做额外功能：
  - 不自动把原选中文本替换为子任务链接
  - 不批量按多行拆分成多个子任务
  - 不修改当前父任务正文内容

## Verification Steps

1. 运行 `npm run build`
2. 运行 `npm run lint`
3. 检查新增/修改文件 diagnostics 为 0
4. 在 Obsidian 中手动验证：
   - 在任务根目录下某个任务文件中选中一段文本，命令面板能看到 `将选中文本转为子任务`
   - 触发后在当前文件同目录创建新普通任务文件
   - 新文件文件名来自选中文本并已合法化
   - 新文件应用了“普通任务”模板
   - 模板中 Templater 代码被执行
   - 新文件包含与父任务一致的 `Project`
   - 新文件包含 `UpTask: - "[[父任务标题]]"`
   - 命令执行后界面回到原父任务文件，不额外产生新的可见 pane
5. 边界验证：
   - 空白选择时命令不出现
   - 非任务目录文件中命令不出现
   - 选中文本归一化后为空时给出友好提示并中止
   - 同名目标文件已存在时复用现有 `createTaskFile()` 行为：打开现有文件并继续补 `Project` / `UpTask`，或按实现阶段确认后保持一致处理
