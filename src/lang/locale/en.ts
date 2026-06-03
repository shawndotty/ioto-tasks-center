const en = {
	'command.openTasksCenterView': 'Open tasks center view',
	'command.convertSelectedTextToSubtask': 'Convert selected text to subtask',
	'view.title': 'Tasks center',
	'view.projectsPaneTitle': 'Projects',
	'view.tasksPaneTitle': 'Tasks',
	'view.projectsPaneDesc':
		'Select a project to view its task files on the right.',
	'view.tasksPane.addTask': 'Add task',
	'view.tasksPane.addTaskCreating': 'Creating...',
	'view.tasksPane.addTaskReady': 'Add task in {0}',
	'view.tasksPane.addTaskSelectProject': 'Select a project first',
	'view.tasksPane.addTaskLoading': 'Wait for the task list to finish loading',
	'view.projectsPane.addProject': 'Add project',
	'view.projectsPane.addProjectCreating': 'Creating project...',
	'view.projectsPane.addProjectLoading':
		'Wait for the project list to finish loading',
	'view.projectsPane.addProjectRootMissing': 'Create the {0} folder first',
	'view.projectsPane.addProjectReady': 'Add project under {0}',
	'view.state.loadingProjectsTitle': 'Loading projects',
	'view.state.loadingProjectsDesc': 'Reading first-level folders under {0}.',
	'view.state.rootMissingTitle': 'Tasks root not found',
	'view.state.rootMissingDesc': 'Create the {0} folder in your vault first.',
	'view.state.noVisibleProjectsTitle': 'No visible projects',
	'view.state.noVisibleProjectsDesc':
		'All projects are hidden. You can unhide them in plugin settings.',
	'view.state.noProjectsTitle': 'No projects yet',
	'view.state.noProjectsDesc':
		'There are no first-level project folders under {0}.',
	'view.state.cannotLoadTasksTitle': 'Cannot load tasks',
	'view.state.cannotLoadTasksDesc':
		'The tasks root folder {0} does not exist, so task files cannot be read.',
	'view.state.selectProjectTitle': 'Select a project',
	'view.state.selectProjectDesc':
		'When projects exist, the first one is auto-selected. Otherwise, create a project first.',
	'view.state.loadingTasksTitle': 'Loading tasks',
	'view.state.loadingTasksDesc': 'Reading Markdown files under {0}/{1}.',
	'view.state.noTaskDataTitle': 'No task data yet',
	'view.state.noTaskDataDesc':
		'Waiting for the view to finish its first task load.',
	'view.state.projectMissingTitle': 'Project folder unavailable',
	'view.state.projectMissingDesc':
		'{0} is currently unavailable. The view will recover on the next refresh.',
	'view.state.emptyProjectTitle': 'No task files',
	'view.state.emptyProjectDesc':
		'There are no Markdown task files under {0}.',
	'view.removeParentDropZone': 'Drag a task here to remove its parent task',
	'view.group.expand': 'Expand {0} group',
	'view.group.collapse': 'Collapse {0} group',
	'view.search.placeholder': 'Search task file names',
	'view.search.clear': 'Clear task search',
	'view.search.clearShort': 'Clear search',
	'view.search.button': 'Search',
	'view.search.run': 'Run task search',
	'view.projectSwitcher.loadingProjects': 'Loading projects...',
	'view.projectSwitcher.loadingTasks': 'Loading tasks...',
	'view.projectSwitcher.default': 'Switch project',
	'view.projectSwitcher.current': 'Current project: {0}',
	'view.projectSwitcher.currentSuffix': '{0} (current)',
	'view.taskListSettings': 'Task list presentation settings',
	'view.description.noneSelected': 'No project is currently selected',
	'view.description.currentProject':
		'Current project: {0}, {1} files, sorted by {2}{3}{4}',
	'view.description.groupPrefix': ', {0}',
	'view.description.priorityVisible': ', show priority',
	'view.filter.current': 'Current filter',
	'view.filter.emptyTitle': 'No tasks in the current filter',
	'view.filter.emptyDesc':
		'There are no visible task files under the {0} tab.',
	'view.search.emptyTitle': 'No matching tasks',
	'view.search.emptyDesc':
		'No task files in the current project match "{0}" in their file name.',
	'view.notice.draggedTaskMissing': 'The dragged task file was not found.',
	'view.notice.updateUpTaskFailed': 'Failed to update UpTask.',
	'view.notice.removeUpTaskFailed': 'Failed to remove UpTask.',
	'view.notice.projectAlreadyExists':
		'That project already exists. The existing project has been selected.',
	'view.notice.createProjectFailed': 'Failed to create project.',
	'view.notice.currentProjectUnavailable':
		'The current project is unavailable. Please choose another project and try again.',
	'view.notice.createTaskFailed': 'Failed to create task file.',
	'view.notice.updateTaskSortFailed': 'Failed to update task list sorting.',
	'view.notice.updateTaskGroupFailed': 'Failed to update task list grouping.',
	'view.notice.updateTaskPriorityDisplayFailed':
		'Failed to update task priority visibility.',
	'view.notice.invalidDropSelf': 'A task cannot be dragged onto itself.',
	'view.notice.invalidDropDescendant':
		'A parent task cannot be dragged under its own child task.',
	'view.notice.invalidDropUnavailable':
		'The drop target is unavailable. Please try again.',
	'view.label.currentFilter': 'Current filter',
	'menu.category.sort': 'Sort',
	'menu.category.group': 'Group',
	'menu.category.priority': 'Priority',
	'menu.currentSuffix': ' (current)',
	'menu.priority.show': 'Show',
	'menu.priority.hide': 'Hide',
	'task.filter.today': 'Today',
	'task.filter.incomplete': 'Incomplete',
	'task.filter.completed': 'Completed',
	'task.filter.all': 'All',
	'task.status.todo': 'To do',
	'task.status.inProgress': 'In progress',
	'task.status.completed': 'Completed',
	'task.status.empty': 'No tasks',
	'task.status.summary.empty': 'No checkbox tasks detected',
	'task.status.summary.completed': '{0}/{1} completed',
	'task.status.summary.todo': '{0} pending',
	'task.sort.incompleteCount': 'By incomplete task count',
	'task.sort.projectName': 'By project name',
	'task.sort.createdDesc': 'Created time (new to old)',
	'task.sort.createdAsc': 'Created time (old to new)',
	'task.sort.updatedDesc': 'Updated time (new to old)',
	'task.sort.updatedAsc': 'Updated time (old to new)',
	'task.sort.nameAsc': 'File name (A to Z)',
	'task.sort.nameDesc': 'File name (Z to A)',
	'task.sort.priorityDesc': 'Priority (high to low)',
	'task.sort.priorityAsc': 'Priority (low to high)',
	'task.group.none': 'No grouping',
	'task.group.status': 'Group by status',
	'task.group.priority': 'Group by priority',
	'task.group.priorityUnset': 'Priority not set',
	'task.template.source.file': 'Use template file',
	'task.template.source.inline': 'Enter template content directly',
	'task.type.date': 'Date task',
	'task.type.plan': 'Plan task',
	'task.type.topic': 'Topic task',
	'task.type.normal': 'Normal task',
	'task.type.fileName.plan': 'Plan',
	'task.type.fileName.topic': 'Topic',
	'modal.defaultDescription': 'Please enter a name.',
	'modal.confirm': 'Confirm',
	'modal.cancel': 'Cancel',
	'settings.heading.main': 'Tasks center',
	'settings.tasksRootPath.name': 'Tasks root path',
	'settings.tasksRootPath.desc':
		'Enter a vault-relative path. First-level folders under this directory are treated as projects.',
	'settings.viewEntry.name': 'View entry',
	'settings.viewEntry.desc':
		'Open the tasks center from the command palette, or directly from here.',
	'settings.viewEntry.button': 'Open tasks center',
	'settings.taskListBehavior.name': 'Task list behavior',
	'settings.taskListBehavior.desc':
		'Only first-level Markdown files in the current project are shown on the right. Clicking a task opens it in the pinned pane on the right side of the tasks center.',
	'settings.autoRefresh.name': 'Auto refresh',
	'settings.autoRefresh.desc':
		'When files under {0} are created, deleted, renamed, or modified, open tasks center views refresh automatically.',
	'settings.heading.taskCreation': 'Task creation',
	'settings.taskTemplate.name': 'Task templates',
	'settings.taskTemplate.desc':
		'Configure templates for the four task types independently, using either a template file or inline content.',
	'settings.dateTaskFormat.name': 'Date task date format',
	'settings.dateTaskFormat.desc':
		'Supports Moment/Day.js patterns such as {0} or YYYY-MM-DD. Invalid input falls back to the default.',
	'settings.heading.projectSort': 'Project list sorting',
	'settings.projectSort.name': 'Sorting rule',
	'settings.projectSort.desc':
		'Controls how the project list on the left is sorted. The default is by incomplete task count, descending.',
	'settings.heading.hiddenProjects': 'Hidden projects',
	'settings.hiddenProjects.desc':
		'Checked projects are hidden from the left-side project list. Changes apply immediately and are saved automatically.',
	'settings.hiddenProjects.loading': 'Loading project list...',
	'settings.hiddenProjects.rootMissingName': 'Tasks root not found',
	'settings.hiddenProjects.rootMissingDesc':
		'Create the {0} folder in your vault first.',
	'settings.hiddenProjects.emptyName': 'No configurable projects',
	'settings.hiddenProjects.emptyDesc':
		'There are no first-level project folders under {0}.',
	'settings.hiddenProjects.withIncomplete':
		'Currently has {0} incomplete tasks',
	'settings.hiddenProjects.withoutIncomplete':
		'Currently has no incomplete tasks',
	'settings.taskTemplate.heading': '{0} template',
	'settings.taskTemplate.source.name': 'Template source',
	'settings.taskTemplate.source.desc': 'Choose the template source for {0}.',
	'settings.taskTemplate.filePath.name': 'Template file path',
	'settings.taskTemplate.filePath.desc': '{0}{1}',
	'settings.taskTemplate.filePath.templater':
		'This mode supports Templater. Current template folder: {0}',
	'settings.taskTemplate.filePath.templaterGeneric':
		'This mode supports Templater.',
	'settings.taskTemplate.sourceDisabled':
		' This source is currently disabled.',
	'settings.taskTemplate.filePath.placeholder':
		'0-Helper/IOTO/Templates/Templater/OBIOTO/IOTO-loader-create-task.md',
	'settings.taskTemplate.selectButton': 'Choose template',
	'settings.taskTemplate.clearButton': 'Clear',
	'settings.taskTemplate.inline.name': 'Template content',
	'settings.taskTemplate.inline.desc':
		'Write the content here directly into new files without executing Templater.{0}',
	'settings.taskTemplate.inline.placeholder':
		'# {0}\n\nWrite template content here',
	'notice.convertSelectedTextToSubtaskFailed':
		'Failed to convert the selected text to a subtask.',
	'error.projectNameEmpty': 'Project name cannot be empty.',
	'error.taskNameEmpty': 'Task name cannot be empty.',
	'error.createProjectRootMissing': 'Create the {0} folder first.',
	'error.targetPathUnavailable': 'Target path is unavailable: {0}',
	'error.currentTaskFileUnavailable':
		'There is no available task file right now.',
	'error.invalidSubtaskName':
		'The selected text cannot be used as a subtask name.',
	'error.subtaskSelfReference':
		'The current task file cannot be converted into its own subtask.',
	'error.fileOutsideTasksRoot':
		'The current file is not inside the tasks root.',
	'error.invalidProjectDirectory':
		'The current file is not inside a valid project directory.',
	'error.parentTaskTitleEmpty': 'Parent task title cannot be empty.',
	'notice.taskFileExists':
		'That task file already exists. The existing file has been opened for you.',
	'notice.templateInsertedOnly':
		'The template was inserted into the original text, but Templater syntax was not executed automatically.',
	'modal.newProject.title': 'New project',
	'modal.newProject.placeholder': 'Enter project name',
	'modal.newProject.desc': 'Please enter a name for the new project.',
	'modal.create': 'Create',
	'modal.newPlanTask.title': 'New plan task',
	'modal.newPlanTask.placeholder': 'Enter plan name',
	'modal.newTopicTask.title': 'New topic task',
	'modal.newTopicTask.placeholder': 'Enter topic name',
	'modal.newNormalTask.title': 'New normal task',
	'modal.newNormalTask.placeholder': 'Enter task name',
	'modal.newTask.desc': 'Please enter a name for the new task file.',
} as const;

export default en;
