export const DEFAULT_DATE_TASK_DATE_FORMAT = 'YYYY-MM-DD';
const DATE_FORMAT_TOKENS = ['YYYY', 'YY', 'MM', 'M', 'DD', 'D'] as const;

export function normalizeDateTaskDateFormat(format: string): string {
	const normalized = format.trim();
	if (!normalized) {
		return DEFAULT_DATE_TASK_DATE_FORMAT;
	}

	return isSupportedDateTaskDateFormat(normalized)
		? normalized
		: DEFAULT_DATE_TASK_DATE_FORMAT;
}

export function formatDateByPattern(date: Date, format: string): string {
	const effectiveFormat = normalizeDateTaskDateFormat(format);
	let output = '';
	let index = 0;

	while (index < effectiveFormat.length) {
		const matchedToken = DATE_FORMAT_TOKENS.find((token) =>
			effectiveFormat.startsWith(token, index),
		);
		if (matchedToken) {
			output += formatDateToken(date, matchedToken);
			index += matchedToken.length;
			continue;
		}

		output += effectiveFormat[index] ?? '';
		index += 1;
	}

	return output;
}

function isSupportedDateTaskDateFormat(format: string): boolean {
	let index = 0;

	while (index < format.length) {
		const matchedToken = DATE_FORMAT_TOKENS.find((token) =>
			format.startsWith(token, index),
		);
		if (matchedToken) {
			index += matchedToken.length;
			continue;
		}

		const currentChar = format[index] ?? '';
		if (/[A-Za-z[\]]/.test(currentChar)) {
			return false;
		}

		index += 1;
	}

	return true;
}

function formatDateToken(
	date: Date,
	token: (typeof DATE_FORMAT_TOKENS)[number],
): string {
	const year = date.getFullYear();
	const month = date.getMonth() + 1;
	const day = date.getDate();

	switch (token) {
		case 'YYYY':
			return `${year}`;
		case 'YY':
			return `${year}`.slice(-2);
		case 'MM':
			return `${month}`.padStart(2, '0');
		case 'M':
			return `${month}`;
		case 'DD':
			return `${day}`.padStart(2, '0');
		case 'D':
			return `${day}`;
	}
}
