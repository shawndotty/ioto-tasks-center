# 计划：Project Item 右键菜单（编辑项目规范 + 存档）

## 概述

在任务中心视图左侧 Project Pane 的每个项目元素上增加右键菜单，包含"编辑项目规范"和"存档/取消存档"两个选项。

## 当前状态分析

- `iotoTasksCenterView.ts` 中 `renderProjectsPane` 方法（538-762行）渲染项目列表，每个项目是 `<button class="ioto-tasks-center__project-item">`
- 项目类型为 `ProjectFolderEntry`，包含 `name` 和 `path` 字段
- 视图已导入 `Menu`、`TFile`、`WorkspaceLeaf`、`Notice`、`setIcon`
- 已存在 `this.getHiddenProjectNames()` 获取已存档项目名列表
- 已有 `this.ensurePreviewLeaf()` 方法用于获取右侧分屏 leaf
- `PROJECT_METADATA_FILE_NAME` 常量未导入（需新增导入）
- `setProjectHidden` 回调未传入 `IOTOTasksCenterView`（需新增构造函数参数）
- 任务项右键菜单已有成熟模式（1261-1265行 `contextmenu` 事件 → `showTaskPriorityMenu`）
- `setProjectHidden` 在 `main.ts` 中调用后会触发 `applySettingsToOpenViews()` → `handleSettingsChange()` → `refreshFromVaultChange()`，两个视图都会自动刷新

## 变更清单

### 1. i18n 翻译文件 — 新增菜单 key

**文件**：`src/lang/locale/en.ts`、`zh-cn.ts`、`zh-tw.ts`

新增 3 个 key：

| Key | en | zh-cn | zh-tw |
|-----|-----|-------|-------|
| `view.projectMenu.editSpec` | `Edit spec` | `编辑项目规范` | `編輯專案規範` |
| `view.projectMenu.archive` | `Archive` | `存档` | `封存` |
| `view.projectMenu.unarchive` | `Unarchive` | `取消存档` | `取消封存` |

### 2. main.ts — 传入 setProjectHidden

**文件**：`src/main.ts`

在 `IOTOTasksCenterView` 构造函数调用中（第 56-82 行），新增传入 `setProjectHidden` 回调：

```ts
new IOTOTasksCenterView(
    leaf,
    // ... 现有参数 ...
    () => this.settings.dateTaskDateFormat,
    // 新增参数 ↓
    (projectName, hidden) => this.setProjectHidden(projectName, hidden),
),
```

### 3. iotoTasksCenterView.ts — 核心逻辑

**文件**：`src/views/iotoTasksCenterView.ts`

**变更 A — 新增导入**：
在 `../tasks-center/project-metadata` 的导入中新增 `PROJECT_METADATA_FILE_NAME`。

**变更 B — 新增属性和构造函数参数**：
- 新增 `private readonly setProjectHidden: (projectName: string, hidden: boolean) => Promise<void>;`
- 构造函数新增第 25 个参数 `setProjectHidden`
- 构造函数体中赋值 `this.setProjectHidden = setProjectHidden;`

**变更 C — 项目项右键事件**：
在 `renderProjectsPane` 中 `itemEl` 的事件绑定区域（约第 740-748 行），新增 contextmenu 监听：

```ts
itemEl.addEventListener('contextmenu', (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    this.showProjectContextMenu(event, project);
});
```

**变更 D — 新增 `showProjectContextMenu` 方法**：

```ts
private showProjectContextMenu(event: MouseEvent, project: ProjectFolderEntry): void {
    const menu = new Menu();
    const isArchived = this.getHiddenProjectNames().includes(project.name);

    menu.addItem((item) =>
        item
            .setTitle(t('view.projectMenu.editSpec'))
            .onClick(() => {
                void this.openProjectSpecByProject(project);
            }),
    );

    menu.addItem((item) =>
        item
            .setTitle(
                isArchived
                    ? t('view.projectMenu.unarchive')
                    : t('view.projectMenu.archive'),
            )
            .onClick(() => {
                void this.setProjectHidden(project.name, !isArchived);
            }),
    );

    menu.showAtMouseEvent(event);
}
```

**变更 E — 新增 `openProjectSpecByProject` 方法**：
（与 `IOTOProjectCenterView.openProjectSpec` 逻辑一致）：

```ts
private async openProjectSpecByProject(project: ProjectFolderEntry): Promise<void> {
    const filePath = `${project.path}/${PROJECT_METADATA_FILE_NAME}`;
    let file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
        file = await this.app.vault.create(
            filePath,
            '---\nIOTOProject:\n---\n',
        );
    }
    const leaf = this.ensurePreviewLeaf();
    await leaf.openFile(file as TFile, { active: true });
}
```

## 假设与决策

1. **不复用代码提取**：`openProjectSpec` 逻辑代码量很小（~10行），两个视图各自独立实现比引入共享模块更简单。两个视图各自维护自己的 `previewLeaf` 状态。
2. **存档后自动刷新**：调用 `setProjectHidden` 后，`main.ts` 的 `applySettingsToOpenViews()` 会自动触发两个视图的 `refreshFromVaultChange()`，无需手动刷新。
3. **菜单项顺序**：编辑项目规范在上，存档/取消存档在下，符合操作频率优先级。

## 验证步骤

1. `npm run build` 编译通过
2. `npm run lint` 无报错
3. 在 Obsidian 中：
   - 右键项目 → 显示菜单含"编辑项目规范"和"存档"
   - 点击"编辑项目规范"→ 右侧 panel 打开 `_project.md`（不存在时自动创建）
   - 点击"存档"→ 项目从列表消失，项目中心中该项目标记为存档
   - 已存档的项目右键 → 显示"取消存档"→ 点击后项目恢复显示
   - 切换中英文 → 菜单文本正确
