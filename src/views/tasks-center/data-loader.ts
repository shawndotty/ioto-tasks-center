import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import { listProjectFolders, listProjectTaskFiles } from '../../tasks-center/data';
import { filterHiddenProjectEntries, sortProjectEntries } from '../../tasks-center/project-sort';
import { getProjectMetadataFile, readProjectMetadataFromFrontmatter } from '../../tasks-center/project-metadata';
import { isIncompleteTaskStatus } from './constants';
import type { ProjectFolderEntry } from '../../tasks-center/types';

export async function refreshFromVaultChange(view: IOTOTasksCenterView): Promise<void> {
	view.outlinkPopover?.close();
	view.taskStatusChecklistPopover?.close();
	if (view.shouldDeferVaultRefresh()) {
		view.pendingVaultRefresh = true;
		view.scheduleDeferredVaultRefresh();
		return;
	}

	view.pendingVaultRefresh = false;
	if (view.deferredVaultRefreshTimer !== null) {
		window.clearTimeout(view.deferredVaultRefreshTimer);
		view.deferredVaultRefreshTimer = null;
	}

	const previousSelection = view.selectedProject;
	await loadProjects(view, previousSelection);
}

export async function loadProjects(
	view: IOTOTasksCenterView,
	preferredProject?: string | null,
): Promise<void> {
	const token = ++view.refreshToken;
	view.isProjectsLoading = true;
	view.render();

	const result = listProjectFolders(view.app, view.getTasksRootPath());
	if (token !== view.refreshToken) {
		return;
	}

	view.projectResult = result;
	view.projects = filterHiddenProjectEntries(
		result.projects,
		view.getHiddenProjectNames(),
	);
	view.projectIncompleteCounts = await buildProjectIncompleteCounts(
		view,
		result.projects,
	);
	applyProjectSorting(view);
	view.projectCategoryByName = buildProjectCategoryByName(
		view,
		view.projects,
	);
	view.isProjectsLoading = false;

	if (result.status !== 'success' || view.projects.length === 0) {
		view.selectedProject = null;
		view.taskResult = null;
		view.tasks = [];
		view.isTasksLoading = false;
		view.render();
		return;
	}

	const nextProject = resolveSelectedProject(view, preferredProject);
	const shouldPreserveTaskListState =
		nextProject === view.selectedProject;
	await selectProject(view, nextProject, {
		resetTaskListScroll: !shouldPreserveTaskListState,
		resetCollapsedSubtasks: !shouldPreserveTaskListState,
	});
}

export function resolveSelectedProject(
	view: IOTOTasksCenterView,
	preferredProject?: string | null,
): string {
	if (
		preferredProject &&
		view.projects.some((project) => project.name === preferredProject)
	) {
		return preferredProject;
	}

	const fallbackProject = view.projects[0];
	if (!fallbackProject) {
		throw new Error('No project is available for selection.');
	}

	return fallbackProject.name;
}

export async function selectProject(
	view: IOTOTasksCenterView,
	projectName: string,
	options: {
		resetTaskListScroll?: boolean;
		resetCollapsedSubtasks?: boolean;
	} = {},
): Promise<void> {
	const { resetTaskListScroll = true, resetCollapsedSubtasks = true } =
		options;
	view.selectedProject = projectName;
	if (resetTaskListScroll) {
		view.taskListScrollTop = 0;
	}
	if (resetCollapsedSubtasks) {
		view.collapsedSubtaskParents.clear();
	}
	view.isTasksLoading = true;
	view.render();
	await loadTasks(view, projectName);
}

export async function loadTasks(
	view: IOTOTasksCenterView,
	projectName: string,
): Promise<void> {
	const token = ++view.refreshToken;
	const result = await listProjectTaskFiles(
		view.app,
		view.getTasksRootPath(),
		projectName,
	);

	if (token !== view.refreshToken) {
		return;
	}

	view.taskResult = result;
	view.tasks = result.tasks;
	view.isTasksLoading = false;
	view.openedTaskPath = getCachedTaskPath(view, projectName);

	if (result.status === 'project-missing') {
		const nextProject = resolveSelectedProject(view, projectName);
		if (nextProject !== projectName) {
			await selectProject(view, nextProject);
			return;
		}
	}

	view.render();
}

export function getCachedTaskPath(
	view: IOTOTasksCenterView,
	projectName: string,
): string | null {
	const cachedTaskPath = view.lastOpenedTaskByProject.get(projectName);
	if (!cachedTaskPath) {
		return null;
	}

	return view.tasks.some((task) => task.path === cachedTaskPath)
		? cachedTaskPath
		: null;
}

export async function buildProjectIncompleteCounts(
	view: IOTOTasksCenterView,
	projects: ProjectFolderEntry[],
): Promise<Map<string, number>> {
	const tasksRootPath = view.getTasksRootPath();
	const entries = await Promise.all(
		projects.map(async (project) => {
			const result = await listProjectTaskFiles(
				view.app,
				tasksRootPath,
				project.name,
			);
			const incompleteCount = result.tasks.filter((task) =>
				isIncompleteTaskStatus(task.status.key),
			).length;
			return [project.name, incompleteCount] as const;
		}),
	);

	return new Map(entries);
}

export function buildProjectCategoryByName(
	view: IOTOTasksCenterView,
	projects: ProjectFolderEntry[],
): Map<string, string> {
	const tasksRootPath = view.getTasksRootPath();
	const entries = projects.map((project) => {
		const file = getProjectMetadataFile(
			view.app,
			tasksRootPath,
			project.name,
		);
		if (!file) {
			return [project.name, ''] as const;
		}

		const frontmatter =
			view.app.metadataCache.getFileCache(file)?.frontmatter;
		const metadata = readProjectMetadataFromFrontmatter(frontmatter);
		const category =
			typeof metadata?.category === 'string' ? metadata.category : '';
		return [project.name, category] as const;
	});

	return new Map(entries);
}

export function applyProjectSorting(view: IOTOTasksCenterView): void {
	view.projects = sortProjectEntries(
		view.projects,
		view.projectIncompleteCounts,
		view.getProjectListSortMode(),
	);
}
