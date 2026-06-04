// Solution inspired by obsidian-kanban and optimized for robustness and clarity.

/* eslint-disable no-restricted-imports, import/no-extraneous-dependencies */
import moment from 'moment';
import en from './locale/en';
import zhCN from './locale/zh-cn';
import zhTW from './locale/zh-tw';

type TranslationKey = keyof typeof en;
type LocaleDictionary = Record<TranslationKey, string>;

const localeMap: Record<string, Partial<LocaleDictionary>> = {
	en,
	'zh-cn': zhCN,
	'zh-tw': zhTW,
};

// Cache for the fully resolved locale object and language string.
let cachedLocale: LocaleDictionary | null = null;
let cachedLang: string | null = null;

function getConfiguredObsidianLanguage(): string | null {
	try {
		// eslint-disable-next-line obsidianmd/prefer-get-language
		const storedLanguage = window.localStorage.getItem('language');
		if (storedLanguage && storedLanguage.trim().length > 0) {
			return storedLanguage;
		}
	} catch {
		// Ignore storage access failures and continue to other fallbacks.
	}

	try {
		const htmlLanguage = activeDocument.documentElement.lang;
		if (htmlLanguage && htmlLanguage.trim().length > 0) {
			return htmlLanguage;
		}
	} catch {
		// Ignore DOM access failures and continue to moment locale fallback.
	}

	return null;
}

/**
 * Determines the current language from plugin settings or Obsidian's locale.
 */
export function getCurrentLang(): string {
	try {
		return resolveLocaleKey(
			getConfiguredObsidianLanguage() ?? moment.locale(),
		);
	} catch (e) {
		console.error(
			"Failed to get language setting, falling back to 'en'",
			e,
		);
		return 'en';
	}
}

export function resolveLocaleKey(lang: string | null | undefined): string {
	const normalizedLang = (lang ?? 'en').toLowerCase().replace(/_/g, '-');

	if (localeMap[normalizedLang]) {
		return normalizedLang;
	}

	if (normalizedLang.startsWith('zh-tw')) {
		return 'zh-tw';
	}

	if (
		normalizedLang.startsWith('zh-hk') ||
		normalizedLang.startsWith('zh-mo')
	) {
		return 'zh-tw';
	}

	if (normalizedLang === 'zh' || normalizedLang.startsWith('zh-cn')) {
		return 'zh-cn';
	}

	if (normalizedLang.startsWith('en')) {
		return 'en';
	}

	const primaryLang = normalizedLang.split('-')[0] ?? 'en';
	if (localeMap[primaryLang]) {
		return primaryLang;
	}

	return 'en';
}

/**
 * Gets the appropriate locale object.
 * It merges the specific locale with the English fallback to ensure all keys are present.
 * The result is cached to avoid re-computation on subsequent calls.
 */
function _get_locale(): LocaleDictionary {
	const lang = getCurrentLang();

	// Return cached locale if language hasn't changed.
	if (cachedLocale && cachedLang === lang) {
		return cachedLocale;
	}

	const baseLocale = en as LocaleDictionary;
	const specificLocale = localeMap[lang];

	// Create a new locale object with 'en' as a fallback for missing keys.
	// This makes the translation lookup more robust.
	const locale =
		specificLocale && specificLocale !== baseLocale
			? { ...baseLocale, ...specificLocale }
			: baseLocale;

	cachedLocale = locale;
	cachedLang = lang;
	return locale;
}

/**
 * Translates a string key into the current language.
 * @param str The key of the string to translate.
 * @param args Optional arguments for string interpolation (e.g. "{0}", "{1}").
 * @returns The translated string.
 */
export function translate(
	lang: string,
	str: TranslationKey,
	args?: string[],
): string {
	const localeKey = resolveLocaleKey(lang);
	const baseLocale = en as LocaleDictionary;
	const specificLocale = localeMap[localeKey];
	let msg = (specificLocale && specificLocale[str]) || baseLocale[str] || str;
	if (args && args.length > 0) {
		args.forEach((arg, index) => {
			msg = msg.replace(new RegExp(`\\{${index}\\}`, 'g'), arg);
		});
	}
	return msg;
}

export function resetLocaleCache(): void {
	cachedLocale = null;
	cachedLang = null;
}

export function t(str: TranslationKey, args?: string[]): string {
	let msg = _get_locale()[str];
	if (args && args.length > 0) {
		args.forEach((arg, index) => {
			msg = msg.replace(new RegExp(`\\{${index}\\}`, 'g'), arg);
		});
	}
	return msg;
}
