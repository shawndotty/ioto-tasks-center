# iotoTasksCenterView.ts 进一步重构方案

## 现状概览

| 指标 | 当前值 |
|------|--------|
| 总行数 | 2531 行 |
| 类体行数 | ~2370 行 |
| 方法总数 | 120 个 |
| 构造函数参数 | 30+ 个 getter/updater 闭包 |
| 已提取模块 | 9 个文件（`src/views/tasks-center/`） |

文件长度远超 AGENTS.md 建议的 200-300 行拆分阈值。

---

## 重构机会分析（按收益/成本排序）

### 一、立即可做：消除残留内联方法（预计 -150 行，低风险）

**问题**：以下 10 个方法在 `tasks-center/` 目录已有等价实现，但 view 中仍保留了完整内联逻辑，属于双份代码。

| view 内方法 | 行范围 | 已提取位置 |
|-------------|--------|-----------|
| `selectProject` | 428-447 | `data-loader.ts` |
| `handleTaskDrop` | 1771-1798 | `drag-controller.ts` |
| `handleRemoveUpTaskDragLeave` | 1840-1851 | `drag-controller.ts` |
| `canCreateProject` | 1874-1880 | `task-operations.ts` |
| `getAddProjectButtonLabel` | 1882-1899 | `task-operations.ts` |
| `showTaskCreationMenu` | 1905-1938 | `task-operations.ts` |
| `getActiveTaskPath` | 2461-2469 | `preview-leaf.ts` |
| `getPreviewLeafFilePath` | 2471-2478 | `preview-leaf.ts` |
| `activatePreviewLeaf` | 2480-2488 | `preview-leaf.ts` |
| `ensurePreviewLeaf` | 2490-2507 | `preview-leaf.ts` |

**做法**：将这些方法体替换为单行委托调用，与已有的委托方法（如 `loadProjects`、`handleCreateTask` 等）保持一致。

---

### 二、最大收益：拆分三大渲染方法（预计 -700 行，中风险）

这三个方法是文件过长的根本原因：

| 方法 | 行数 | 职责 |
|------|------|------|
| `renderTasksPane` | 281 | 任务面板完整渲染：空状态、搜索、分组、行列表、滚动恢复 |
| `renderTaskRows` | 241 | 单个任务行 DOM 构建：状态、优先级、子任务折叠、徽标、事件绑定 |
| `renderProjectsPane` | 230 | 项目面板完整渲染：搜索、分组、空状态、项目卡片、滚动恢复 |

**建议拆分目标**：

```
src/views/tasks-center/
  tasks-pane-renderer.ts      # renderTasksPane + 任务空状态/搜索状态
  task-row-renderer.ts        # renderTaskRows + 任务行样式/事件
  projects-pane-renderer.ts   # renderProjectsPane + 项目空状态
```

**提取模式**：与已有模块一致 —— 导出纯函数，接收 view 参数对象（或 `this`），view 中保留一行委托调用。

**注意事项**：
- 这三个方法大量访问 view 的内部状态（`this.tasks`、`this.selectedProject`、`this.collapsedTaskGroups` 等），提取时需确保 view 参数接口包含所有被访问的成员。
- `renderTaskRows` 中调用了多个 popover 绑定方法（`bindTaskSubtaskPopover` 等），如果 popover 也被提取（见方案三），需协调依赖顺序。

---

### 三、中等收益：提取 Popover 与 Outlink 徽标逻辑（预计 -350 行，中风险）

**涉及方法（约 20 个）**：

**Popover 绑定组**（~150 行）：
- `bindTaskSubtaskPopover`、`getTaskSubtaskPopoverItems`
- `bindTaskOutlinkPopover`、`getTaskOutlinkPopoverTitle`、`getTaskOutlinkPopoverItems`
- `bindTaskStatusChecklistPopover`、`openTaskStatusChecklistPopover`、`getTaskStatusChecklistPopoverTitle`

**Outlink 徽标同步组**（~200 行）：
- `queueOutlinkBadgeUpdate`、`updateTaskOutlinkBadges`、`syncTaskOutlinkBadge`
- `cleanupTaskOutlinkCountsContainer`、`getTaskOutlinkBadgeLabel`

**建议拆分目标**：

```
src/views/tasks-center/
  popover-controller.ts       # 所有 popover 绑定与内容构建
  outlink-badge-sync.ts       # outlink 徽标异步更新与清理
```

---

### 四、构造函数参数打包（降低耦合，低风险）

**问题**：构造函数接收 30+ 个独立参数（getter / updater 闭包），每个都存为 `readonly` 实例字段。参数列表长达 71 行。

**建议**：将参数打包为结构化接口对象：

```typescript
// 方案 A：按职责分组
interface ViewConfig {
  // 路径与项目
  getTasksRootPath: () => string;
  getProjectsRootPath: () => string;
  // 排序/分组/显示
  getTaskListSortMode: () => TaskListSortMode;
  updateTaskListSortMode: (mode: TaskListSortMode) => Promise<void>;
  // ... 其余 getter/updater
}
```

**权衡**：
- 优点：构造函数从 71 行缩到 ~5 行；新增配置项不用改函数签名。
- 缺点：所有已提取模块的参数类型也需同步调整；改动面广。

---

### 五、消除结构性重复（预计 -50 行，低风险）

**5.1 折叠状态管理（3 个 `toggle*Collapsed` + 2 个 `syncCollapsed*Groups`）**

当前 3 个 toggle 方法模式完全相同：
```typescript
if (set.has(key)) set.delete(key);
else set.add(key);
this.render();
```

可提取通用辅助函数 `toggleSetMember(view, set, key)`。

**5.2 任务属性更新骨架（`task-operations.ts` 中 4 个方法）**

`updateTaskPriority` / `clearTaskPriority` / `updateTaskStarred` / `clearTaskStarred` 结构完全相同：
```
getAbstractFileByPath → 检查 → try set/clear → catch Notice → refresh
```

可提取通用骨架函数。

---

## 推荐实施顺序

| 优先级 | 方案 | 预计减少行数 | 风险 | 建议独立 PR |
|--------|------|-------------|------|------------|
| P0 | 一、消除残留内联方法 | ~150 | 低 | 是 |
| P1 | 二、拆分渲染方法 | ~700 | 中 | 是（可分 3 个） |
| P2 | 三、提取 Popover/Outlink | ~350 | 中 | 是 |
| P3 | 五、消除重复 | ~50 | 低 | 是 |
| P4 | 四、构造函数打包 | ~60 | 低（改动广） | 是 |

**全部完成后预计**：文件从 2531 行降至 **~1200 行**，接近合理范围。

---

## 验证方式（每个阶段完成后）

```bash
npx tsc --noEmit          # 类型检查 0 错误
npm run lint              # ESLint 0 错误/警告
npm run build             # 构建成功
npm test                  # 全部测试通过
```

并在 Obsidian 中手动验证：
- 项目列表加载、切换、创建
- 任务列表加载、创建、删除、拖拽
- Popover 显示（子任务、outlink、清单）
- 预览 Leaf 打开与复用
- 排序/分组/过滤/搜索功能正常
