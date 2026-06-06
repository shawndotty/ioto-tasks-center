export function filterProjectCenterRowsByQuery<T extends { name: string }>(
	rows: T[],
	query: string,
): T[] {
	const trimmed = query.trim();
	if (!trimmed) {
		return rows;
	}

	const needle = trimmed.toLowerCase();
	return rows.filter((row) => row.name.toLowerCase().includes(needle));
}

