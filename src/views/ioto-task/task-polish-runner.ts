/**
 * 任务描述润色的编排层（Plan-20261125-210407 §5.2）。
 *
 * 读行 → 拆正文 / 交付物尾 → 调 ioto-settings 的纯文本通道 → 清洗 → 预览 →
 * 原子写回。全程不建 TaskRun、不占运行锁、不碰续写区。
 */

import { Notice } from 'obsidian';

import { t } from '../../lang/helpter';
import { splitTaskLine } from '../../tasks-center/note-structure';
import {
	PolishPreviewModal,
	type PolishPreviewState,
} from '../../ui/polish-preview-modal';
import { commitTaskText } from './commit-task-line';
import { resolvePolishCapability } from './task-polish-capability';
import {
	sanitizePolishedText,
	validatePolishedText,
	type PolishRejectReason,
} from './task-polish-output';
import {
	buildPolishPrompt,
	splitDeliverableTail,
} from './task-polish-prompt';
import type { TaskViewHost } from './task-view-host';

/** 500 字上限 + 余量；不新增设置项。 */
export const POLISH_MAX_TOKENS = 1200;

const inFlight = new WeakMap<TaskViewHost, Set<number>>();

type RequestResult =
	| { ok: true; state: PolishPreviewState }
	| { ok: false; message: string };

export function runTaskPolish(view: TaskViewHost, line: number): void {
	const pending = inFlight.get(view) ?? new Set<number>();
	if (pending.has(line)) {
		return;
	}
	pending.add(line);
	inFlight.set(view, pending);

	const button = findPolishButton(view, line);
	setButtonPending(button, true);

	void (async () => {
		try {
			await executePolish(view, line);
		} catch (error) {
			console.error('task polish failed', error);
			new Notice(t('polish.description.errUnavailable'));
		} finally {
			pending.delete(line);
			setButtonPending(button, false);
		}
	})();
}

async function executePolish(
	view: TaskViewHost,
	line: number,
): Promise<void> {
	if (!view.supportsInlineEdit() || !view.file) {
		new Notice(t('notice.iotoTaskView.runTaskUnavailable'));
		return;
	}

	await view.flushInlineEdits();

	const originalLine = view.lineAt(line);
	const parts = splitTaskLine(originalLine);
	if (!parts) {
		new Notice(t('polish.description.errNoDescription'));
		return;
	}

	const { prose, trailingDeliverables } = splitDeliverableTail(parts.body);
	if (prose.trim() === '') {
		new Notice(t('polish.description.errNoDescription'));
		return;
	}

	const continuationCount = view.countContinuationLines(line);

	const capability = resolvePolishCapability(view.app);
	if (!capability) {
		new Notice(t('polish.description.errUnavailable'));
		return;
	}

	const request = async (): Promise<RequestResult> => {
		const res = await capability.generatePlainText(
			buildPolishPrompt(prose),
			{ maxTokens: POLISH_MAX_TOKENS },
		);
		if (!res.ok) {
			return { ok: false, message: rejectMessage(res.reason, res.message) };
		}

		const sanitized = sanitizePolishedText(res.text);
		const validation = validatePolishedText({
			originalProse: prose,
			cleaned: sanitized.text,
			flags: sanitized.flags,
		});

		const statusLines: string[] = [];
		if (sanitized.flags.controlsRemoved) {
			statusLines.push(t('polish.description.warnControlsRemoved'));
		}
		if (sanitized.flags.hallucinatedDeliverablesRemoved) {
			statusLines.push(t('polish.description.warnDeliverablesRemoved'));
		}
		if (res.truncated) {
			statusLines.push(t('polish.description.warnTruncated'));
		}
		if (continuationCount > 0) {
			statusLines.push(
				t('polish.description.warnContinuation', [
					String(continuationCount),
				]),
			);
		}

		return {
			ok: true,
			state: {
				text: validation.text,
				canApply: validation.ok,
				blockedReason: validation.ok
					? null
					: validationMessage(validation.reasons),
				statusLines,
			},
		};
	};

	const first = await request();
	if (!first.ok) {
		new Notice(first.message);
		return;
	}

	const modal = new PolishPreviewModal(view.app, {
		original: prose,
		initial: first.state,
		onRegenerate: async (): Promise<PolishPreviewState> => {
			const next = await request();
			if (next.ok) {
				return next.state;
			}
			return {
				text: '',
				canApply: false,
				blockedReason: next.message,
				statusLines: [],
			};
		},
	});

	const result = await modal.openAndWait();
	if (result.action !== 'apply') {
		return;
	}

	const nextBody = [result.state.text, trailingDeliverables]
		.filter((part) => part.length > 0)
		.join(' ');

	const file = view.file;
	if (!file) {
		return;
	}

	const outcome = await commitTaskText(view.app, file, {
		line,
		originalLine,
		nextBody,
	});

	if (outcome.status === 'ok') {
		new Notice(t('polish.description.applied'));
		view.applyOutcome(outcome);
		// `reloadFromVault` 会因 `lastLoadedText` 已同步而短路；纯正文替换走单卡刷新。
		view.refreshCard(line);
		return;
	}

	if (outcome.status === 'conflict') {
		// 只提示、不覆盖：交给 applyOutcome 的既有冲突文案 + 重载。
		view.applyOutcome(outcome);
		await view.reloadFromVault();
		return;
	}

	new Notice(t('polish.description.warnUnchanged'));
}

function findPolishButton(
	view: TaskViewHost,
	line: number,
): HTMLButtonElement | null {
	return (
		view
			.queryCard(line)
			?.querySelector<HTMLButtonElement>(
				'.ioto-task-view__card-action-btn[data-action="polish-description"]',
			) ?? null
	);
}

function setButtonPending(
	button: HTMLButtonElement | null,
	pending: boolean,
): void {
	if (!button) {
		return;
	}
	button.disabled = pending;
	button.classList.toggle('is-loading', pending);
	if (pending) {
		button.setAttribute('aria-busy', 'true');
	} else {
		button.removeAttribute('aria-busy');
	}
}

function rejectMessage(reason: string, message?: string): string {
	switch (reason) {
		case 'no-model':
			return t('polish.description.errNoModel');
		case 'no-key':
			return t('polish.description.errNoKey');
		case 'timeout':
			return t('polish.description.errTimeout');
		case 'http':
			return t('polish.description.errHttp', [message ?? '']);
		case 'network':
			return t('polish.description.errNetwork');
		case 'parse':
			return t('polish.description.errParse');
		case 'empty':
			return t('polish.description.errEmpty');
		default:
			return t('polish.description.errUnavailable');
	}
}

function validationMessage(reasons: PolishRejectReason[]): string {
	if (reasons.includes('links-changed')) {
		return t('polish.description.warnLinksChanged');
	}
	if (reasons.includes('too-long')) {
		return t('polish.description.warnTooLong');
	}
	if (reasons.includes('empty')) {
		return t('polish.description.errEmpty');
	}
	return t('polish.description.warnUnchanged');
}