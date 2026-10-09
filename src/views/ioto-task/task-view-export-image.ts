import { Notice } from 'obsidian';

import { t } from '../../lang/helpter';
import {
	buildExportFileName,
	canvasToBlob,
	captureTaskViewCanvas,
	clampExportScale,
	composeExportFooter,
	composeExportHeader,
	copyCanvasToClipboard,
	readableTextColor,
	saveCanvasToVault,
	resolveExportBackground,
} from '../../export';
import type { IOTOTaskView } from '../iotoTaskView';
import { IOTO_TASK_SCROLL_SELECTOR } from './ioto-task-scroll';

/** 命令 / 工具栏入口：把当前所见导出为 PNG 附件（按内容全高的长图，写库内附件目录）。 */
export async function exportAsImage(view: IOTOTaskView): Promise<void> {
	const captured = await captureForExport(view);
	if (!captured) {
		return;
	}

	try {
		const path = await saveCanvasToVault(
			view.app,
			captured.canvas,
			buildExportFileName(captured.baseName, new Date()),
			{ sourcePath: view.file?.path },
		);
		new Notice(t('notice.exportTaskViewImage.saved', [path]));
	} catch (error) {
		console.error('[ioto-tasks-center] save exported image failed', error);
		new Notice(t('notice.exportTaskViewImage.failed'));
	}
}

/** 命令入口：把当前所见复制到系统剪贴板（恒 PNG）。桌面失败回退 Electron 原生剪贴板。 */
export async function copyImageToClipboard(view: IOTOTaskView): Promise<void> {
	const captured = await captureForExport(view);
	if (!captured) {
		return;
	}

	try {
		await copyCanvasToClipboard(captured.canvas);
		new Notice(t('notice.exportTaskViewImage.copied'));
		return;
	} catch {
		// 落到 Electron 回退（桌面）；移动端 / 无权限下同样会失败，最终给 Notice（不静默）。
	}

	if (await copyCanvasViaElectron(view, captured.canvas)) {
		new Notice(t('notice.exportTaskViewImage.copied'));
		return;
	}
	new Notice(t('notice.exportTaskViewImage.copyFailed'));
}

/**
 * 导出共用链：重入锁 → 生成中 Notice → 解析宽度 / 背景 / 倍率 → 光栅化。
 *
 * **完全不改实时 DOM**（含滚动位置、选中态、卡片类）：`captureTaskViewCanvas` 拍的是
 * 重建后的离屏克隆，瞬时态（选中 / 待删除确认）在克隆上摘除（[[Plan-20261006-102142]] §三.7）。
 */
export async function captureForExport(view: IOTOTaskView): Promise<{
	canvas: HTMLCanvasElement;
	baseName: string;
} | null> {
	if (view.isExporting) {
		return null;
	}

	const scrollEl = view.contentEl.querySelector<HTMLElement>(
		IOTO_TASK_SCROLL_SELECTOR,
	);
	if (!scrollEl || scrollEl.scrollHeight <= 0) {
		new Notice(t('notice.exportTaskViewImage.failed'));
		return null;
	}

	view.isExporting = true;
	new Notice(t('notice.exportTaskViewImage.generating'));
	try {
		const options = view.exportOptionsProvider();
		const width =
			options.widthMode === 'fixed'
				? options.fixedWidth
				: scrollEl.clientWidth;
		const backgroundColor = resolveExportBackground(view.contentEl);
		const desiredScale = clampExportScale(options.scale);

		const result = await captureTaskViewCanvas(scrollEl, {
			width,
			desiredScale,
			backgroundColor,
		});

		const baseName =
			view.app.workspace.getActiveFile()?.basename ??
			view.file?.basename ??
			view.getDisplayText();
		let canvas = options.withHeader
			? composeExportHeader(result.canvas, {
					title: baseName,
					at: new Date(),
					backgroundColor,
					textColor: readableTextColor(backgroundColor),
					scale: result.scale,
				})
			: result.canvas;
		// 先页眉、后页尾，各自只在一端追加，互不干扰（[[Discuss-20261008-091032]] §2.4）。
		if (options.withFooter) {
			canvas = composeExportFooter(canvas, {
				backgroundColor,
				textColor: readableTextColor(backgroundColor),
				scale: result.scale,
			});
		}

		// 逐条如实提示：降倍率 / 封顶 / 拍不到内容 / 玻璃主题降级（[[Plan-20261006-102142]] §三.5）。
		if (result.scale < desiredScale) {
			new Notice(
				t('notice.exportTaskViewImage.scaleReduced', [
					String(result.scale),
				]),
			);
		}
		if (result.heightCapped) {
			new Notice(t('notice.exportTaskViewImage.heightCapped'));
		}
		if (result.partial) {
			new Notice(t('notice.exportTaskViewImage.partial'));
		}
		if (view.appearanceStyleProvider() === 'glass') {
			new Notice(t('notice.exportTaskViewImage.glassDegraded'));
		}

		return { canvas, baseName };
	} catch (error) {
		console.error('[ioto-tasks-center] capture task view failed', error);
		new Notice(t('notice.exportTaskViewImage.failed'));
		return null;
	} finally {
		view.isExporting = false;
	}
}

/** 桌面回退：`navigator.clipboard` 不可用时走 Electron 原生剪贴板；失败返回 false（由调用方提示）。 */
export async function copyCanvasViaElectron(
	view: IOTOTaskView,
	canvas: HTMLCanvasElement,
): Promise<boolean> {
	try {
		const blob = await canvasToBlob(canvas, 'image/png');
		const buffer = await blob.arrayBuffer();
		// 渲染进程 `require('electron')` 可用（nodeIntegration 开启，见 [[reference_obsidian_renderer_electron_access]]）；
		// 移动端没有 `require`，故整段包在 try 里。`require` / `Buffer` 由 nodeIntegration 提供，
		// 不是浏览器全局（本插件 eslint globals 为 browser），这里就地声明。
		/* eslint-disable no-undef, @typescript-eslint/no-require-imports */
		const electron = require('electron') as {
			clipboard: { writeImage: (image: unknown) => void };
			nativeImage: { createFromBuffer: (data: Buffer) => unknown };
		};
		electron.clipboard.writeImage(
			electron.nativeImage.createFromBuffer(Buffer.from(buffer)),
		);
		/* eslint-enable no-undef, @typescript-eslint/no-require-imports */
		return true;
	} catch {
		return false;
	}
}
