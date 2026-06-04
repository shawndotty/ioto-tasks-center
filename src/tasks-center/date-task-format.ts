/* eslint-disable no-restricted-imports, import/no-extraneous-dependencies */
import moment from 'moment';
import { getCurrentLang } from '../lang/helpter';

export const DEFAULT_DATE_TASK_DATE_FORMAT = 'YYYY-MM-DD';

export function normalizeDateTaskDateFormat(format: string): string {
	const normalized = format.trim();
	return normalized || DEFAULT_DATE_TASK_DATE_FORMAT;
}

export function formatDateByPattern(date: Date, format: string): string {
	const effectiveFormat = normalizeDateTaskDateFormat(format);
	return moment(date).locale(getCurrentLang()).format(effectiveFormat);
}
