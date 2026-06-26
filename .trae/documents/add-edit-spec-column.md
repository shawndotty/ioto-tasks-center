# 计划：在项目中心表格增加"编辑项目规范"列

## 概述

在项目中心视图表格最右侧增加一列，列名为"编辑项目规范"，每行显示编辑图标按钮，点击后在右侧 Panel 打开对应项目文件夹下的 `_project.md` 文件。

## 当前状态分析

- 表格使用 CSS Grid 6 列布局，定义在 `styles.css` 的 `.ioto-project-center__row` 中
- 6 列依次为：projectName、category、startDate、dueDate、taskCount、archived
- 表头通过 `createHeaderCell()` 创建可排序按钮，排序键类型为 `ProjectCenterSortKey`
- 数据行依次调用 `renderProjectNameCell`、`renderCategoryCell`、`renderDateCell(x2)`、`renderTaskCountCell`、`renderArchivedCell`
- `_project.md` 的文件名常量 `PROJECT_METADATA_FILE_NAME` 定义在 `src/tasks-center/project-metadata.ts`
- i18n 翻译文件在 `src/lang/locale/` 下（en.ts、zh-cn.ts、zh-tw.ts）
- 任务列表打开文件的模式：通过 `app.workspace` 在右侧分屏创建 leaf 并用 `leaf.openFile(file)` 打开

## 变更清单

### 1. i18n 翻译文件 — 新增列名 key

**文件**：
- `src/lang/locale/en.ts`
- `src/lang/locale/zh-cn.ts`
- `src/lang/locale/zh-tw.ts`

**变更**：在每个文件的 `projectCenter.columns` 区段末尾新增一行：
```ts
'projectCenter.columns.editSpec': '...',
```

| 语言 | 翻译值 |
|------|--------|
| en | `Edit spec` |
| zh-cn | `编辑项目规范` |
| zh-tw | `編輯專案規範` |

### 2. styles.css — 更新 Grid 列宽

**文件**：`styles.css`

**变更**：在 `.ioto-project-center__row` 的 `grid-template-columns` 末尾追加第 7 列（小固定宽度，仅容纳图标按钮）：

```css
grid-template-columns:
    minmax(180px, 1.4fr)
    minmax(140px, 1fr)
    minmax(140px, 1fr)
    minmax(140px, 1fr)
    minmax(90px, 0.6fr)
    minmax(90px, 0.6fr)
    minmax(52px, 52px);  /* 新增第7列 */
```

### 3. iotoProjectCenterView.ts — 核心逻辑

**文件**：`src/views/iotoProjectCenterView.ts`

**变更 A — 表头**：在 `renderTable()` 方法中，6 个 `createHeaderCell` 调用之后，追加一个普通表头单元格（不可排序）：

```ts
// 新列：非排序表头
const editSpecHeader = headerRowEl.createDiv({
    cls: 'ioto-project-center__cell ioto-project-center__cell--editSpec',
    text: t('projectCenter.columns.editSpec'),
});
```

**变更 B — 数据行**：在循环内 `this.renderArchivedCell(rowEl, row)` 之后追加：

```ts
this.renderEditSpecCell(rowEl, row);
```

**变更 C — 新增方法 `renderEditSpecCell`**：

```ts
private renderEditSpecCell(rowEl: HTMLElement, row: ProjectCenterRow): void {
    const cellEl = rowEl.createDiv({
        cls: 'ioto-project-center__cell ioto-project-center__cell--editSpec',
    });
    const buttonEl = cellEl.createEl('button', {
        cls: 'ioto-project-center__icon-button',
        attr: {
            'aria-label': t('projectCenter.columns.editSpec'),
            title: t('projectCenter.columns.editSpec'),
        },
    });
    setIcon(buttonEl, 'file-edit');  // Obsidian 内置图标
    buttonEl.addEventListener('click', () => {
        void this.openProjectSpec(row);
    });
}
```

**变更 D — 新增方法 `openProjectSpec`**：

```ts
private async openProjectSpec(row: ProjectCenterRow): Promise<void> {
    const filePath = `${row.path}/${PROJECT_METADATA_FILE_NAME}`;
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
        new Notice(t('projectCenter.notice.specNotFound'));
        return;
    }
    // 在右侧 Panel 打开文件（与任务列表中打开文件的方式一致）
    const leaf = this.app.workspace.getLeaf('split', 'vertical');
    await leaf.openFile(file, { active: true });
}
```

**变更 E — 新增导入**：从 `obsidian` 导入 `TFile`（检查是否已导入），从 `../tasks-center/project-metadata` 导入 `PROJECT_METADATA_FILE_NAME`。

### 4. i18n 翻译文件 — 新增错误提示 key

**文件**：同上述 3 个 locale 文件

**变更**：新增 `projectCenter.notice.specNotFound` key：

| 语言 | 翻译值 |
|------|--------|
| en | `Project spec file not found.` |
| zh-cn | `未找到项目规范文件。` |
| zh-tw | `未找到專案規範檔案。` |

## 假设与决策

1. **新列不可排序**：这是一个操作列（按钮），不作为排序依据，因此表头使用纯 `<div>` 而非 `createHeaderCell` 按钮，也不将新 key 加入 `ProjectCenterSortKey` 联合类型。
2. **使用 Obsidian 内置图标 `file-edit`**：Obsidian 内置 Lucide 图标 `file-edit`，无需额外引入图标库。
3. **复用现有 `.ioto-project-center__icon-button` 样式**：与搜索/刷新/新建按钮一致的按钮样式。
4. **打开方式**：使用 `workspace.getLeaf('split', 'vertical')` 在右侧分屏打开，与任务列表 `openFileInPreview` 的模式一致。
5. **_project.md 路径**：`row.path` 是项目文件夹路径，拼接 `_project.md` 文件名得到完整路径。

## 验证步骤

1. 运行 `npm run build` 确保 TypeScript 编译无错误
2. 运行 `npm run lint` 确保无 lint 错误
3. 在 Obsidian 中加载插件，切换到项目中心视图，验证：
   - 表头新增第 7 列"编辑项目规范"（根据语言显示对应文字）
   - 每行末尾显示编辑图标按钮
   - 点击图标按钮，右侧 Panel 打开对应项目的 `_project.md`
   - 切换中英文，确认列名文本正确切换
