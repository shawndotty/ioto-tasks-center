export interface TaskPreviewOpenState {
	targetTaskPath: string;
	openedTaskPath: string | null;
	previewLeafAvailable: boolean;
	previewedFilePath: string | null;
}

export interface ActiveTaskPathState {
	openedTaskPath: string | null;
	previewLeafAvailable: boolean;
	previewedFilePath: string | null;
}

export function shouldSkipOpeningTask(
	state: TaskPreviewOpenState,
): boolean {
	return (
		state.previewLeafAvailable &&
		state.targetTaskPath === state.openedTaskPath &&
		state.targetTaskPath === state.previewedFilePath
	);
}

export function resolveActiveTaskPath(
	state: ActiveTaskPathState,
): string | null {
	if (state.previewLeafAvailable) {
		return state.previewedFilePath;
	}

	return state.openedTaskPath;
}
