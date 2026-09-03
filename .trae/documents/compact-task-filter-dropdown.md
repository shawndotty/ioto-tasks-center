# 任务 Tabs 紧凑显示优化方案

## Summary

在紧凑布局（视图宽度 ≤ 720px，含移动端）下，将任务筛选 Tabs（核心任务/今天/未完成/已完成/全部）由「换行折叠的胶囊按钮组」改为「下拉切换器」——与现有紧凑模式项目切换器（`renderCompactProjectSwitcher` + `showProjectSwitcherMenu`）完全一致的交互模式。宽屏布局保持现状不变。

## Current state analysis

- `renderTaskTabs`（`src/views/iotoTasksCenterView.ts:919-970`）渲染 5 个 pill 按钮（label + count），容器 `.ioto-tasks-center__tabs` 为 `flex-wrap: wrap`（`styles.css:305-310`）。窄屏时 Tab 折成 2-3 行，占大量纵向空间，观感差。

- 插件已有紧凑布局机制：`ResizeObserver` 监听 `contentEl` 宽度，≤ `COMPACT_LAYOUT_BREAKPOINT`（720，`src/views/tasks-center/constants.ts:13`）时 `isCompactLayout = true` 并整树重渲染。移动端必然进入紧凑模式；桌面端把标签页拖窄同样会触发。

- 紧凑模式下项目切换已经是「全宽按钮 → 点击弹出 Obsidian `Menu`」的模式（`renderCompactProjectSwitcher` / `showProjectSwitcherMenu`，`iotoTasksCenterView.ts:648-664 / 852-880`），CSS 类为 `.ioto-tasks-center__project-switcher`（`styles.css:268-295`）。

## 方案选型（为什么不选「缩写 Tab」）

| 维度      | 方案 1：下拉切换器（推荐）   | 方案 2：未选中 Tab 只显示首字/首字母                   |
| ------- | ---------------- | ---------------------------------------- |
| 一致性     | 与紧凑项目切换器交互完全一致   | 引入全新交互模式                                 |
| 信息量     | 菜单内完整 label + 计数 | 丢失语义，仅剩首字                                |
| 歧义风险    | 无                | 英文 **Completed** 和 **Core** 首字母均为 C，无法区分 |
| 极窄屏表现   | 永远单行             | 5 个按钮仍可能折行                               |
| i18n 成本 | 2 个新 key         | 每种语言需新增 5 个短标签 key                       |

结论：**采用方案 1（下拉切换器）**，仅在紧凑布局下启用；宽屏保持现有 Tab 行。

## Proposed Changes

### 1. `src/views/iotoTasksCenterView.ts`

修改 `renderTaskTabs`（L919-970）：

- 在创建 `tabBarEl` 后按 `this.isCompactLayout` 分支：

  - 紧凑：调用新方法 `renderCompactTaskFilterSwitcher(tabBarEl)`；

  - 非紧凑：保持现有 Tab 列表渲染逻辑不变。

- 分支后保留现有的设置按钮（`sliders-horizontal`）渲染逻辑，两种模式共用。

新增私有方法 `renderCompactTaskFilterSwitcher(tabBarEl: HTMLElement): void`：

```ts
const taskFilterTabs = getTaskFilterTabs();
const counts = this.getTaskFilterCounts();
const activeTab = taskFilterTabs.find(
    (tab) => tab.key === this.activeTaskFilterTab,
) ?? taskFilterTabs[0];
const buttonLabel = t('view.taskFilterSwitcher.current', [
    activeTab.label,
    String(counts[activeTab.key]),
]);
const switcherEl = tabBarEl.createEl('button', {
    cls: 'ioto-tasks-center__task-filter-switcher',
    text: buttonLabel,
});
switcherEl.type = 'button';
switcherEl.ariaLabel = buttonLabel;
switcherEl.title = buttonLabel;
switcherEl.addEventListener('click', (event: MouseEvent) => {
    this.showTaskFilterSwitcherMenu(event);
});
```

新增私有方法 `showTaskFilterSwitcherMenu(event: MouseEvent): void`（仿照 `showProjectSwitcherMenu`）：

```ts
const menu = new Menu();
for (const tab of getTaskFilterTabs()) {
    const isActive = tab.key === this.activeTaskFilterTab;
    menu.addItem((item) => {
        item.setTitle(
            t('view.taskFilterSwitcher.menuItem', [
                tab.label,
                String(this.getTaskFilterCounts()[tab.key]),
            ]),
        );
        if (isActive) {
            item.setIcon('check');
        }
        item.onClick(() => {
            if (isActive) {
                return;
            }
            this.activeTaskFilterTab = tab.key;
            this.render();
        });
    });
}
menu.showAtMouseEvent(event);
```

（`Menu` 已在文件顶部 import，无需新增依赖。）

### 2. i18n：三个 locale 文件各加 2 个 key

`src/lang/locale/en.ts`（`view.projectSwitcher.*` 附近）：

```ts
'view.taskFilterSwitcher.current': 'Filter: {0} ({1})',
'view.taskFilterSwitcher.menuItem': '{0} ({1})',
```

`src/lang/locale/zh-cn.ts`：

```ts
'view.taskFilterSwitcher.current': '当前筛选：{0}（{1}）',
'view.taskFilterSwitcher.menuItem': '{0}（{1}）',
```

`src/lang/locale/zh-tw.ts`：

```ts
'view.taskFilterSwitcher.current': '當前篩選：{0}（{1}）',
'view.taskFilterSwitcher.menuItem': '{0}（{1}）',
```

### 3. `styles.css`

- 将现有三条 `.ioto-tasks-center__project-switcher` 规则（基础/hover/disabled，L268-295）的选择器扩展为同时命中 `.ioto-tasks-center__task-filter-switcher`，复用相同外观。

- 新增针对切换器在 tabs-bar 内的覆盖规则（不占满整行、与设置按钮同行、长文本省略）：

```css
.ioto-tasks-center__task-filter-switcher {
	display: block;
	flex: 1 1 auto;
	width: auto;
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
```

- 修改紧凑模式规则（L1388-1390）：

```css
.ioto-tasks-center--compact .ioto-tasks-center__tabs-settings {
	align-self: center;
}
```

（由 `flex-end` 改为 `center`，使设置图标按钮与单行切换器垂直居中对齐。）

### 4. 文档更新

- `docs/USER_GUIDE.md` L114-121（Search, filters, and organization → Filter tabs）补充一句：窄布局/移动端下，筛选 Tabs 收起为下拉切换器，点击弹出菜单选择。

- `docs/USER_GUIDE.zh-CN.md` 对应章节同步补充。

## Assumptions & Decisions

- 仅紧凑布局（≤720px）改变形态；宽屏完全不动。

- 不引入 `Platform.isMobile` 判断——现有 ResizeObserver 断点已同时覆盖移动端与桌面拖窄场景。

- 不新增设置项，不改变 `activeTaskFilterTab` 的持久化与过滤逻辑。

- 菜单项用 `setIcon('check')` 标记当前项（区别于项目菜单的「(current)」后缀方案，勾选更适合 Tab 语义且无文本歧义）。

- 不修改 `src/views/task-filter-tabs.ts`（无纯逻辑变更，label 查找沿用视图内已有的 `find` 模式），故不新增单测；既有测试全量回归。

- 版本号/发布流程不在本次范围（由 `npm run version` 与发布流程统一处理）。

## Verification

1. `npm run build` — tsc 类型检查 + esbuild 通过。
2. `npm test` — 既有测试（含 `task-filter-tabs.test.mjs`、`lang-helper.test.mjs` locale 完整性校验）通过。
3. `npm run lint` — ESLint 通过。
4. 手动验证（vault 内）：

   - 宽屏：Tab 行与改动前一致。

   - 将标签页拖窄至 ≤720px：Tabs 变为单个下拉按钮 + 设置按钮同行居中；按钮显示「当前筛选：xxx（n）」。

   - 点击按钮弹出 Menu：5 项均带计数、当前项有勾选；点选其它项后列表刷新、按钮文案更新。

   - 移动端（或远程预览）验证同样交互。

   - 三个语言切换验证文案正确。

