# 任务中心默认选中“核心任务”并置顶 Tab - 开发计划（2026-06-07）

## Summary

调整任务中心右侧的任务筛选 tab 行为：

- 将 **核心任务** 移动到第一个 tab
- 将任务中心的默认选中 tab 从 **今天** 改为 **核心任务**

这样用户打开任务中心时，默认看到的是“核心任务”列表，而不是“今天”任务。

## Current State Analysis

- tab 定义集中在 [task-filter-tabs.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/task-filter-tabs.ts)
  - `TaskFilterTab` 已经包含 `core`
  - 目前 `getTaskFilterTabs()` 返回顺序是：
    - `today`
    - `incomplete`
    - `completed`
    - `all`
    - `core`
  - 因此 UI 上“核心任务”当前在最后一个 tab
- 任务中心视图状态位于 [iotoTasksCenterView.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)
  - 类字段默认值 `private activeTaskFilterTab: TaskFilterTab = 'today';`
  - `setState()` 中当 state 没有该值时也回退到 `'today'`
  - 这两处共同决定了“默认选中今天”
- 任务筛选测试位于 [task-filter-tabs.test.mjs](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/task-filter-tabs.test.mjs)
  - 当前已有 `today`、`core` 合法性和 `core` 计数/匹配测试
  - 但还没有覆盖 tab 顺序
- 多语言文件中 `task.filter.core` 与 `task.filter.today` 等文案已存在：
  - [zh-cn.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts)
  - [zh-tw.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts)
  - [en.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)
  - 本次不需要新增文案键

## Assumptions & Decisions

- “默认选中核心任务”定义为：
  - 新开任务中心视图时默认 tab 为 `core`
  - 当恢复 view state 且 state 中没有 `activeTaskFilterTab` 时，也回退到 `core`
- 若已有持久化 state 且其中明确记录了其他 tab，则继续尊重已有 state，不强制覆盖用户上次选择
- tab 顺序调整为：
  - `core`
  - `today`
  - `incomplete`
  - `completed`
  - `all`
- 本次不改动筛选逻辑本身：
  - `core` 仍然只显示当前项目下 `Starred: true` 的任务
  - 其他 tab 的筛选行为保持不变
- 本次不新增设置项，不提供“默认 tab 可配置化”能力，仅按用户要求固化为“核心任务”

## Proposed Changes

### 1) 调整任务筛选 tab 顺序

修改文件： [task-filter-tabs.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/task-filter-tabs.ts)

- 修改 `getTaskFilterTabs()` 返回数组顺序
- 将 `{ key: 'core', label: t('task.filter.core') }` 移动到数组第一项
- 保持其余 tab 顺序不变，最终顺序为：
  - `core`
  - `today`
  - `incomplete`
  - `completed`
  - `all`

### 2) 修改任务中心默认活动 tab

修改文件： [iotoTasksCenterView.ts](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)

- 将类字段默认值：
  - `private activeTaskFilterTab: TaskFilterTab = 'today';`
  - 改为 `private activeTaskFilterTab: TaskFilterTab = 'core';`
- 将 `setState()` 中的回退值：
  - `viewState.activeTaskFilterTab ?? 'today'`
  - 改为 `viewState.activeTaskFilterTab ?? 'core'`
- 不改动 `getState()` / `parseViewState()` 的结构
  - 因为 `core` 已经是合法 `TaskFilterTab`
  - 现有持久化状态机制已足够支持新默认值

### 3) 补充测试覆盖默认顺序与默认值

修改文件： [task-filter-tabs.test.mjs](file:///d:/Users/johnn/Documents/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/task-filter-tabs.test.mjs)

- 新增对 `getTaskFilterTabs()` 的导入
- 增加一个测试验证 tab 顺序：
  - 第一个 tab 为 `core`
  - 后续顺序依次为 `today / incomplete / completed / all`

可选补充：

- 若测试成本低，可为视图默认值添加一个轻量测试；但如果当前没有直接覆盖 `iotoTasksCenterView.ts` 的单测基础，则不强行加入 UI 层测试
- 这次以纯函数层 tab 顺序测试为主，视图默认值通过构建与手工验收验证

## Verification Steps

- 运行单元测试：`npm test`
- 运行构建验证：`npm run build`
- 手工验收（Obsidian）：
  - 打开任务中心，确认第一个 tab 为 **核心任务**
  - 确认默认选中的 tab 为 **核心任务**
  - 切换到其他 tab 后正常显示对应列表
  - 重开任务中心：
    - 若没有历史 tab state，默认仍为 **核心任务**
    - 若有历史 state，仍尊重上次用户选择
  - 确认“今天 / 未完成 / 已完成 / 全部”筛选行为没有回归
