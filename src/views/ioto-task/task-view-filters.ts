import {
	readBooleanProperty,
	readScalarProperty,
	writeScalarProperties,
} from '../../tasks-center/frontmatter-properties';
import type { TaskNoteFilters } from './render-note-types';
import type { IOTOTaskView } from '../iotoTaskView';
import {
	FILTER_PROPERTY_NAMES,
	PROPERTY_ONLY_PENDING,
	PROPERTY_ONLY_TASK_BLOCKS,
	PROPERTY_RECENT_ONLY,
} from './task-view-constants';
import { lineAt } from './task-view-helpers';

/** 从 `view.data`（frontmatter）重读过滤开关；缺失 = 关。 */
export function reloadFilters(view: IOTOTaskView): void {
	view.filters = {
		onlyTaskBlocks: readBooleanProperty(
			view.data,
			PROPERTY_ONLY_TASK_BLOCKS,
		),
		onlyPending: readBooleanProperty(view.data, PROPERTY_ONLY_PENDING),
		recentOnly: readBooleanProperty(view.data, PROPERTY_RECENT_ONLY),
	};
}

/**
 * 切换 ① / ②：先 `commitEdit`（避免与落盘交错），一次补齐两个属性键，写盘后
 * 按 frontmatter 行数变化平移 `selectedLine` / `collapsedSections`，再整树重绘。
 */
export async function toggleFilter(
	view: IOTOTaskView,
	kind: keyof TaskNoteFilters,
): Promise<void> {
	const file = view.file;
	if (!file) {
		return;
	}

	// 竞态：点开关注定先 blur → 异步 commitEdit；必须先落盘再写属性。
	await view.commitEdit();

	const oldContent = view.data;
	const nextValue = !view.filters[kind];

	const properties: Record<string, string> = {
		[FILTER_PROPERTY_NAMES[kind]]: nextValue ? 'true' : 'false',
	};
	// 首次 toggle 时一次补齐其余两个 key（把「行号平移」压成一次性事件）。
	for (const key of Object.keys(
		FILTER_PROPERTY_NAMES,
	) as (keyof TaskNoteFilters)[]) {
		if (key === kind) {
			continue;
		}
		const name = FILTER_PROPERTY_NAMES[key];
		if (readScalarProperty(oldContent, name) === null) {
			properties[name] = view.filters[key] ? 'true' : 'false';
		}
	}

	const newContent = await writeScalarProperties(
		view.app,
		file,
		properties,
	);
	const delta =
		newContent.split('\n').length - oldContent.split('\n').length;
	if (delta !== 0) {
		shiftTrackedLines(view, delta, oldContent, newContent);
	}

	// 🔴 红线：data / lastLoadedText 同步，避免 TextFileView 回写旧字节。
	view.data = newContent;
	view.lastLoadedText = newContent;
	view.renderNote(view.data, {
		skipAnchorRestore: kind === 'onlyTaskBlocks' && nextValue === false,
	});
}

/**
 * frontmatter 增行导致正文行号整体 ±Δ 后，把以行号为基准的跟踪态一起平移
 * （[[Plan-20261004-110845]] §5.1）。插入点恒在 frontmatter，故正文整体平移。
 */
export function shiftTrackedLines(
	view: IOTOTaskView,
	delta: number,
	oldContent: string,
	newContent: string,
): void {
	const newLines = newContent.split('\n');

	if (view.selectedLine !== null) {
		const target = view.selectedLine + delta;
		const oldLine = lineAt(view, view.selectedLine);
		if (target >= 0 && newLines[target] === oldLine) {
			view.selectedLine = target;
		} else {
			view.selectedLine = null;
		}
	}

	const shifted = new Set<string>();
	for (const key of view.collapsedSections) {
		// key = `level:startLine:title`（只 split 前两个 `:`，标题可能含 `:`）
		const firstColon = key.indexOf(':');
		const secondColon = key.indexOf(':', firstColon + 1);
		if (firstColon < 0 || secondColon < 0) {
			continue;
		}
		const level = key.slice(0, firstColon);
		const startLine = Number.parseInt(
			key.slice(firstColon + 1, secondColon),
			10,
		);
		if (Number.isNaN(startLine)) {
			continue;
		}
		const title = key.slice(secondColon + 1);
		shifted.add(`${level}:${startLine + delta}:${title}`);
	}
	view.collapsedSections = shifted;
}
