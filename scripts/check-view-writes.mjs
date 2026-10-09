#!/usr/bin/env node
/**
 * 写操作门禁（[[Plan-20261009-155708]] 阶段 C / [[Discuss-20261009-154708]] §五.C）。
 *
 * 冻结 `src/views/ioto-task/**` 里对视图状态 `view.<field>` 的**直接赋值类写操作**，
 * 拦下「新增未登记直写」，把「状态访问纪律」（见 AGENTS.md「View state access discipline」）
 * 从约定升级为可检测门禁。
 *
 * - 只匹配**赋值类**写：`=` / `+=` / `-=` / `||=` / `&&=` / `??=` / `++` / `--`。
 *   `view.method()` 是 CallExpression，天然不会被匹配（绕开「被 delegate 方法误报」）。
 * - 白名单 ratchet：基线取自改造落地时的现状（67 处），出现**未登记**的 `(file, field)`
 *   即 `exit 1`。收敛写点后应同步删除对应白名单项（下方会提示「已失效项」）。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET_DIR = join(HERE, '..', 'src', 'views', 'ioto-task');

/** 赋值类写：`view.<field>` 后紧跟赋值/自增运算符（`=` 排除 `==`）。 */
const WRITE_RE =
	/\bview\.([A-Za-z_]\w*)\s*(?:=(?!=)|\+=|-=|\|\|=|&&=|\?\?=|\+\+|--)/g;

/**
 * 白名单基线：`<file> :: <field>`。取自 2026-10-09 阶段 B 落地后的现状。
 * 只在「新增写点」时报红；删除写点后请顺手删掉这里对应行。
 */
const WHITELIST = new Set([
	'task-view-command-readiness.ts :: commandReadinessTimer',
	'task-view-continuation-edit.ts :: autosaveRunning',
	'task-view-continuation-edit.ts :: continuationDraftContainerEl',
	'task-view-continuation-edit.ts :: continuationEndLine',
	'task-view-continuation-edit.ts :: continuationHandle',
	'task-view-continuation-edit.ts :: continuationHostEl',
	'task-view-continuation-edit.ts :: continuationIsNew',
	'task-view-continuation-edit.ts :: continuationLine',
	'task-view-continuation-edit.ts :: continuationOriginalLines',
	'task-view-continuation-edit.ts :: continuationStartLine',
	'task-view-continuation-edit.ts :: externalWritebackBlurred',
	'task-view-continuation-edit.ts :: externalWritebackDirty',
	'task-view-continuation-edit.ts :: selectedLine',
	// 三个行号字段的**唯一清零点**（[[Plan-20261010-070400]] C2/C3/C4）：
	// 原散落在 clear / onunload / runLineAction 三处的手写赋值收口到这里，
	// 加第四种编辑器只改这一处，不再新增写点。
	'task-view-editing-state.ts :: continuationLine',
	'task-view-editing-state.ts :: editingLine',
	'task-view-editing-state.ts :: sectionEditLine',
	'task-view-editor-handlers.ts :: data',
	'task-view-editor-handlers.ts :: editingOriginalLine',
	'task-view-editor-handlers.ts :: lastLoadedText',
	'task-view-editor-handlers.ts :: listTransitionCleanup',
	'task-view-editor-handlers.ts :: selectedLine',
	'task-view-export-image.ts :: isExporting',
	'task-view-external-writeback.ts :: externalWritebackActive',
	'task-view-external-writeback.ts :: externalWritebackBlurred',
	'task-view-external-writeback.ts :: externalWritebackDirty',
	'task-view-filters.ts :: collapsedSections',
	'task-view-filters.ts :: data',
	'task-view-filters.ts :: filters',
	'task-view-filters.ts :: lastLoadedText',
	'task-view-filters.ts :: selectedLine',
	'task-view-inline-edit.ts :: autosaveRunning',
	'task-view-inline-edit.ts :: editingHandle',
	'task-view-inline-edit.ts :: editingLine',
	'task-view-inline-edit.ts :: editingOriginalLine',
	'task-view-inline-edit.ts :: externalWritebackBlurred',
	'task-view-inline-edit.ts :: externalWritebackDirty',
	'task-view-inline-edit.ts :: pendingCommit',
	'task-view-item-control-host.ts :: editingOriginalLine',
	'task-view-render.ts :: data',
	'task-view-render.ts :: isRendering',
	'task-view-render.ts :: lastLoadedText',
	'task-view-render.ts :: listTransitionCleanup',
	'task-view-render.ts :: listTransitionToken',
	'task-view-render.ts :: selectedLine',
	'task-view-search.ts :: searchDebounce',
	'task-view-search.ts :: searchQuery',
	'task-view-search.ts :: selectedLine',
	'task-view-selection.ts :: editingLine',
	'task-view-selection.ts :: editingOriginalLine',
	'task-view-selection.ts :: pendingDeleteEl',
	'task-view-selection.ts :: pendingDeleteLine',
	'task-view-selection.ts :: selectedLine',
	'task-view-toolbar.ts :: addTaskEl',
	'task-view-toolbar.ts :: bodyEl',
	'task-view-toolbar.ts :: deleteTaskEl',
	'task-view-toolbar.ts :: runTaskEl',
	'task-view-toolbar.ts :: searchBarEl',
	'task-view-toolbar.ts :: searchInputEl',
	'task-view-toolbar.ts :: searchNextEl',
	'task-view-toolbar.ts :: searchPrevEl',
	'task-view-toolbar.ts :: searchToggleEl',
	'task-view-toolbar.ts :: togglePendingEl',
	'task-view-toolbar.ts :: toggleRecentEl',
	'task-view-toolbar.ts :: toggleTaskBlocksEl',
	'task-view-toolbar.ts :: toolbarEl',
	'task-view-zoom.ts :: editingLine',
	'task-view-zoom.ts :: editingOriginalLine',
	'task-view-zoom.ts :: zoomLine',
]);

/** 采集当前所有 `(file :: field)` 写点。 */
function collectWrites() {
	const found = new Set();
	for (const file of readdirSync(TARGET_DIR)) {
		if (!file.endsWith('.ts')) {
			continue;
		}
		const src = readFileSync(join(TARGET_DIR, file), 'utf8');
		let m;
		WRITE_RE.lastIndex = 0;
		while ((m = WRITE_RE.exec(src)) !== null) {
			found.add(`${file} :: ${m[1]}`);
		}
	}
	return found;
}

const found = collectWrites();
const unexpected = [...found].filter((k) => !WHITELIST.has(k)).sort();
const stale = [...WHITELIST].filter((k) => !found.has(k)).sort();

if (stale.length > 0) {
	console.warn(
		`提示：白名单有 ${stale.length} 项已失效（写点已移除），可顺手删除：`,
	);
	for (const k of stale) {
		console.warn(`  - ${k}`);
	}
}

if (unexpected.length > 0) {
	console.error(
		`\n✘ 发现 ${unexpected.length} 处未登记的 view 状态直写（应在少数「状态迁移点」内，或提为 barrel 薄委托方法）：`,
	);
	for (const k of unexpected) {
		console.error(`  - ${k}`);
	}
	console.error(
		`\n若确属合理写点，请将对应 (file, field) 加入 scripts/check-view-writes.mjs 的 WHITELIST（并说明理由）。`,
	);
	process.exit(1);
}

console.log(
	`✔ view 写操作门禁通过（${found.size} 处已登记写点，0 处未登记）`,
);
