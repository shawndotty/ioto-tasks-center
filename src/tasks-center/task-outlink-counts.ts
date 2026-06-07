export interface TaskOutlinkCounts {
	input: number;
	output: number;
	outcome: number;
}

export interface TaskOutlinkCountRoots {
	inputRootPath: string;
	outputRootPath: string;
	outcomeRootPath: string;
}

export interface TaskOutlinkTargets {
	input: string[];
	output: string[];
	outcome: string[];
}

export function countTaskOutlinksByRootPaths(
	resolvedLinksForSource: Record<string, number> | null | undefined,
	roots: TaskOutlinkCountRoots,
): TaskOutlinkCounts {
	const targets = groupTaskOutlinksByRootPaths(resolvedLinksForSource, roots);

	return {
		input: targets.input.length,
		output: targets.output.length,
		outcome: targets.outcome.length,
	};
}

export function groupTaskOutlinksByRootPaths(
	resolvedLinksForSource: Record<string, number> | null | undefined,
	roots: TaskOutlinkCountRoots,
): TaskOutlinkTargets {
	const inputTargets = new Set<string>();
	const outputTargets = new Set<string>();
	const outcomeTargets = new Set<string>();

	const destinations = Object.keys(resolvedLinksForSource ?? {});
	for (const destPath of destinations) {
		if (matchesRootPath(destPath, roots.inputRootPath)) {
			inputTargets.add(destPath);
		}
		if (matchesRootPath(destPath, roots.outputRootPath)) {
			outputTargets.add(destPath);
		}
		if (matchesRootPath(destPath, roots.outcomeRootPath)) {
			outcomeTargets.add(destPath);
		}
	}

	return {
		input: sortVaultPaths([...inputTargets]),
		output: sortVaultPaths([...outputTargets]),
		outcome: sortVaultPaths([...outcomeTargets]),
	};
}

function matchesRootPath(destPath: string, rootPath: string): boolean {
	return destPath === rootPath || destPath.startsWith(`${rootPath}/`);
}

function sortVaultPaths(paths: string[]): string[] {
	return paths.sort((left, right) =>
		left.localeCompare(right, undefined, { numeric: true }),
	);
}
