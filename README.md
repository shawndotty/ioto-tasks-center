# IOTO Tasks Center

简体中文: [README.zh-CN.md](README.zh-CN.md)

Manage Markdown task files by project in Obsidian. This plugin provides a dedicated “Tasks center” view with project navigation, task list filtering/search/sort/grouping, and lightweight task-file metadata (UpTask/Priority/Project).

## Overview

IOTO Tasks Center treats the first-level folders under your configured “tasks root” directory as **projects**, and shows the Markdown files inside each project as **task files**.

Default tasks root path: `3-任务`

## Key features

- Projects pane: lists projects (folders) under the tasks root, with sorting and hide controls
- Tasks pane: lists task files (Markdown files) in the selected project
- Filter tabs: Today / Incomplete / Completed / All
- Search: filters by task file name (within the current project)
- Sorting: created/updated time, name, priority
- Grouping: none / by status / by priority (with collapsible groups)
- Task status summary: counts checkbox tasks in the file and shows a summary (e.g., completed/total)
- Priority: set/clear `Priority` (0–9) for a task file and use it in sort/group
- UpTask hierarchy: drag & drop to set a parent task via `UpTask`; drag to the “remove parent task” zone to clear it
- Hover preview: hover task rows to preview without leaving the view
- Convert selected text to subtask: turns selected text in a task file into a new subtask file and replaces the selection with a wikilink
- Task creation with templates: create task files with optional templates (Templater file mode or inline content), per task type

## How it organizes files

- Tasks root path (vault-relative): defaults to `3-任务`
- Projects: first-level folders under the tasks root
- Task files: Markdown files directly under a project folder (only the first level is listed)

Example structure:

```text
3-任务/
  项目A/
    需求梳理.md
    项目A-2026-06-04.md
  项目B/
    发布复盘.md
```

## Frontmatter fields

This plugin reads/writes a small set of frontmatter fields:

- `Project`: list of project names (written as a YAML list)
- `UpTask`: list; stores a parent task wikilink like `[[Parent task]]`
- `Priority`: scalar number (0–9)
- `Subject`: list; used by “subject task” type
- `Plan`: list; used by “plan task” type

## Commands

- Open tasks center view
- Convert selected text to subtask
  - Works only when the current file is inside the configured tasks root.
  - The subtask is created in the same project and directory as the current task file.
  - The new subtask inherits `Project` and gets `UpTask` pointing to the current file.

## Settings

- Tasks root path: where projects are discovered
- View entry: open the tasks center view from settings
- Task templates
  - Configure templates per task type: date / plan / subject / normal
  - Template source: template file (optionally via Templater) or inline content
- Date task date format: controls the filename segment for date tasks (Moment/Day.js style patterns)
- Project list sorting: by incomplete task count (default) or by name
- Hidden projects: hide selected projects from the project list
- Task list presentation
  - Sort mode, group mode, and whether to show priority

## Installation

- Community plugins: (if published) install from **Settings → Community plugins**.
- Manual install:
  - Copy `main.js`, `manifest.json`, and `styles.css` (if present) into:
    - `<Vault>/.obsidian/plugins/ioto-tasks-center/`
  - Reload Obsidian and enable the plugin in **Settings → Community plugins**.

## Development

```bash
npm install
npm run dev
```

Other scripts:

```bash
npm run build
npm test
npm run lint
```

## License

0-BSD
