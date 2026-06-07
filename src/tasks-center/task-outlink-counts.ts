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

export function countTaskOutlinksByRootPaths(
	resolvedLinksForSource: Record<string, number> | null | undefined,
	roots: TaskOutlinkCountRoots,
): TaskOutlinkCounts {
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
		input: inputTargets.size,
		output: outputTargets.size,
		outcome: outcomeTargets.size,
	};
}

function matchesRootPath(destPath: string, rootPath: string): boolean {
	return destPath === rootPath || destPath.startsWith(`${rootPath}/`);
}
