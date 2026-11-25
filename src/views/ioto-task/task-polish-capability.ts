/**
 * 任务描述润色能力探测（Plan-20261125-210407 §4.1）。
 *
 * 跨插件鸭子类型：只读 `app.plugins.plugins['ioto-settings'].serviceManager.aiService`，
 * 不 import ioto-settings、不新增网络代码。能力不可用时返回 `null`，按钮即不渲染。
 */

import type { App } from 'obsidian';

export type PlainTextResult =
	| { ok: true; text: string; truncated?: boolean }
	| { ok: false; reason: string; message?: string };

export type PolishCapability = {
	generatePlainText(
		prompt: string,
		opts?: { maxTokens?: number },
	): Promise<PlainTextResult>;
};

type AiServiceLike = {
	generatePlainText?: (
		prompt: string,
		opts?: { maxTokens?: number },
	) => Promise<PlainTextResult>;
};

type SettingsPluginLike = {
	serviceManager?: {
		aiService?: AiServiceLike | null;
	};
};

export function resolvePolishCapability(app: App): PolishCapability | null {
	const plugins = (
		app as unknown as {
			plugins?: { plugins?: Record<string, SettingsPluginLike | undefined> };
		}
	).plugins;
	const aiService =
		plugins?.plugins?.['ioto-settings']?.serviceManager?.aiService;
	if (!aiService || typeof aiService.generatePlainText !== 'function') {
		return null;
	}

	const generate = aiService.generatePlainText;
	return {
		// 绑定 this：调用方拿到的是解构后的函数，不能丢执行上下文。
		generatePlainText: (prompt, opts) => generate.call(aiService, prompt, opts),
	};
}