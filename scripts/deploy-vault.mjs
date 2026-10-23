#!/usr/bin/env node
/**
 * 把构建产物一键复制到本地 Obsidian 库的插件目录（默认 IOTO 主库）。
 *
 * 用法（在插件目录下执行）：
 *   npm run build:local                    # 构建 + 复制到默认库 ~/Documents/IOTO
 *   npm run build:local -- --vault <路径>   # 复制到指定库（路径为库根目录）
 *   node scripts/deploy-vault.mjs          # 只复制（复用已有构建产物，不重新构建）
 *
 * 约定：
 *   - 插件目录名取自 manifest.json 的 id，不使用 package.json 的 name。
 *   - 只覆盖 main.js / manifest.json / styles.css，库里的 data.json 等用户数据不会被碰。
 *   - 本脚本不改版本号、不打包、不提交 git，纯粹是「构建产物 → 库」的搬运。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = ['main.js', 'manifest.json', 'styles.css'];
const DEFAULT_VAULT = path.join(os.homedir(), 'Documents', 'IOTO');

const c = {
	reset: '\x1b[0m',
	dim: '\x1b[2m',
	bold: '\x1b[1m',
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	cyan: '\x1b[36m',
};

const log = {
	step: (m) => console.log(`\n${c.cyan}${c.bold}▶ ${m}${c.reset}`),
	info: (m) => console.log(`  ${m}`),
	ok: (m) => console.log(`  ${c.green}✓${c.reset} ${m}`),
	warn: (m) => console.log(`  ${c.yellow}!${c.reset} ${m}`),
	err: (m) => console.error(`  ${c.red}✗${c.reset} ${m}`),
};

function parseArgs(argv) {
	const opts = { vault: null, help: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--vault') opts.vault = argv[++i];
		else if (a.startsWith('--vault=')) opts.vault = a.slice('--vault='.length);
		else if (a === '--help' || a === '-h') opts.help = true;
		else throw new Error(`未知参数: ${a}（可用 --help 查看用法）`);
	}
	return opts;
}

function printHelp() {
	console.log(`部署构建产物到本地 Obsidian 库

用法:
  npm run build:local                    构建并复制到默认库（~/Documents/IOTO）
  npm run build:local -- --vault <路径>   构建并复制到指定库（库根目录）
  node scripts/deploy-vault.mjs [同上]    只复制，不重新构建

选项:
  --vault <路径>   目标 Obsidian 库根目录（默认 ${DEFAULT_VAULT}）
  -h, --help       显示本帮助
`);
}

/** 展开 ~ 开头的路径，并解析为绝对路径。 */
function resolveVaultPath(p) {
	const expanded = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
	return path.resolve(expanded);
}

function kb(bytes) {
	return `${(bytes / 1024).toFixed(1)} KB`;
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		printHelp();
		return;
	}

	log.step('解析目标库');
	const vault = resolveVaultPath(opts.vault || DEFAULT_VAULT);
	if (!existsSync(path.join(vault, '.obsidian'))) {
		throw new Error(
			`目标路径不像是 Obsidian 库（缺少 .obsidian 目录）：${vault}\n` +
				`    请用 --vault <库根目录> 指定正确的库，或检查默认路径 ${DEFAULT_VAULT}`
		);
	}

	const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
	const targetDir = path.join(vault, '.obsidian', 'plugins', manifest.id);
	log.ok(`插件 ${manifest.id} v${manifest.version}`);
	log.info(`→ ${targetDir}`);

	log.step('校验构建产物');
	for (const f of ASSETS) {
		if (!existsSync(path.join(ROOT, f))) {
			throw new Error(`构建产物缺失: ${f}（先执行 npm run build）`);
		}
	}
	log.ok(`${ASSETS.length} 个产物齐全`);

	log.step('复制到库');
	if (!existsSync(targetDir)) {
		mkdirSync(targetDir, { recursive: true });
		log.warn(`目标目录不存在，已创建: ${targetDir}`);
	}
	for (const f of ASSETS) {
		const src = path.join(ROOT, f);
		const dest = path.join(targetDir, f);
		if (src === dest) {
			log.warn(`${f} 源与目标为同一文件，已跳过`);
			continue;
		}
		const before = existsSync(dest) ? statSync(dest) : null;
		copyFileSync(src, dest);
		const after = statSync(dest);
		const delta =
			before && before.size !== after.size
				? `${c.dim}(${kb(before.size)} → ${kb(after.size)})${c.reset}`
				: `${c.dim}(${kb(after.size)})${c.reset}`;
		log.ok(`${f} ${delta}`);
	}

	log.step('完成');
	log.info(`若 Obsidian 已打开该库，请重载插件或执行「重新加载应用」后再测试。`);
}

try {
	main();
} catch (err) {
	log.err(err.message || String(err));
	process.exit(1);
}
