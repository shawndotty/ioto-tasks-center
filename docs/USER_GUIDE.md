# IOTO Tasks Center User Guide

Simplified Chinese: [USER_GUIDE.zh-CN.md](USER_GUIDE.zh-CN.md)

Back to overview: [README.md](../README.md)

IOTO Tasks Center is an Obsidian community plugin for managing Markdown task files by project. It provides a dedicated **Tasks center** for day-to-day task execution and a **Project center** for project-level metadata management, while keeping your tasks as plain Markdown notes inside your vault.

## Version

- Latest version: `2.1.1`
- Release date: `2026-06-15`
- Minimum Obsidian version: `1.1.0`
- Platform support: desktop and mobile (`isDesktopOnly: false`)
- Repository: [shawndotty/ioto-tasks-center](https://github.com/shawndotty/ioto-tasks-center)
- Releases: [GitHub Releases](https://github.com/shawndotty/ioto-tasks-center/releases)

## Overview

The plugin treats:

- the first-level folders under your configured **tasks root** as **projects**
- the first-level Markdown files inside each project folder as **task files**

Default tasks root path: `3-任务`

This design lets you keep using normal Markdown notes, wikilinks, templates, and frontmatter, while adding a focused management UI for:

- project navigation
- task creation
- hierarchy management with `UpTask`
- priority and core-task metadata
- status summaries from checklist items
- search, filtering, sorting, grouping, and popover-based navigation

## What's New in 2.1.1

Version `2.1.1` focuses on task-list workflow improvements:

- Adds native submenu behavior for creating subtasks from the task context menu
- Makes the **Core tasks** tab the first and default task filter
- Adds hover popovers for incomplete checklist items on `To do` and `In progress` status badges
- Lets you choose priority and whether a new task is a core task directly in the creation modal
- Adds optional subtask-count badges in the task list
- Adds configurable badge background mode: **Multicolor** or **Monochrome**

## Core Features

### Tasks center

- Project list with counts for incomplete tasks
- Compact and regular layouts depending on available width
- Task list with filter tabs, search, sorting, and grouping
- Persistent task preview pane on the right
- Scroll-state preservation during refreshes and common operations

### Project center

- Dedicated project table view
- Search, refresh, and create-project actions
- Editable project category, start date, due date, and archive state
- Sorting by project columns
- Archive state synced with hidden-project behavior in the tasks view

### Task creation

- Supports four task types:
  - normal
  - date
  - topic
  - plan
- Per-task-type template configuration
- Template sources:
  - template file
  - inline template content
- Date-task filename format is configurable
- Non-date task creation modal supports:
  - task name
  - priority
  - core-task toggle

### Task hierarchy and subtasks

- Drag a task onto another task to set `UpTask`
- Drag to the **remove parent task** zone to clear `UpTask`
- Nested visual hierarchy with collapse and expand
- Create subtasks from the task context menu
- Convert selected text in the editor into a new subtask note
- Optional subtask-count badge with hover popover listing direct subtasks

### Task metadata and status

- Priority metadata stored in frontmatter and usable for sorting/grouping
- Core-task marking with a star badge
- Task status derived from checklist items in the note
- Status badges for:
  - To do
  - In progress
  - Done
  - No tasks
- Hover popover for incomplete checklist items on active-status tasks
- Click a checklist item in the popover to open the source note and select that checklist line

### Outlink insights

- Optional badge counts for outlinks into:
  - input notes root
  - output notes root
  - outcome notes root
- Hover popover listing matched linked notes
- Click to open linked notes in the preview pane
- `Cmd`/`Ctrl` hover support for native Obsidian preview on outlink items

### Search, filters, and organization

- Filter tabs:
  - Core tasks
  - Today
  - Incomplete
  - Completed
  - All
- Search popover with focus, clear, and keyboard support
- Task sorting:
  - created time
  - updated time
  - file name
  - priority
- Task grouping:
  - none
  - status
  - priority
- Collapsible group sections

### Task context menu

Right-click on a task row to access actions such as:

- mark or unmark as core task
- create subtask
- set or clear priority
- delete task

## File Organization

The plugin does not create a database. It works directly with vault files.

- Tasks root: vault-relative folder, default `3-任务`
- Project: first-level folder under the tasks root
- Task file: first-level Markdown note under a project folder

Example:

```text
3-任务/
  Project Alpha/
    Kickoff.md
    Alpha-2026-06-15.md
  Project Beta/
    Release review.md
```

The task list only scans the first level of each project folder. Nested task hierarchy is represented with frontmatter, not nested directories.

## Frontmatter Fields

The plugin reads and writes these fields:

| Field | Type | Purpose |
| --- | --- | --- |
| `Project` | YAML list | Stores the project name |
| `UpTask` | YAML list | Stores the parent task wikilink, for example `[[Parent task]]` |
| `Priority` | scalar number | Stores task priority |
| `Subject` | YAML list | Used by topic tasks |
| `Plan` | YAML list | Used by plan tasks |
| `Starred` | boolean | Marks a task as a core task |

## Commands

The plugin currently exposes these commands:

- **Open tasks center view**
- **Open project center view**
- **Convert selected text to subtask**

The convert-to-subtask command:

- works only when the active file is inside the configured tasks root
- creates the new subtask in the same project folder
- inherits the current task's `Project`
- writes `UpTask` pointing to the current task
- replaces the selected text with a wikilink to the new subtask

## Settings Reference

### Basic settings

- **Tasks root path**
  - Vault-relative path used to discover projects
- **Input / Output / Outcome notes root path**
  - Used for outlink counting and popover grouping
- **Open tasks center**
  - Shortcut entry from the settings tab
- **Open project center**
  - Shortcut entry from the settings tab
- **Date task date format**
  - Default: `YYYY-MM-DD`

### Task list presentation

- **Project list sorting**
  - By incomplete task count
  - By name
- **Task sort mode**
  - Created descending / ascending
  - Updated descending / ascending
  - Name ascending / descending
  - Priority descending / ascending
- **Task group mode**
  - None
  - Status
  - Priority
- **Show task priority**
- **Show subtask count**

### Outlink badges

- **Show task outlink counts**
- **Show input outlink count**
- **Show output outlink count**
- **Show outcome outlink count**
- **Task list link badge backgrounds**
  - `Multicolor` (default)
  - `Monochrome`

### Task types

You can enable or disable each creation type individually:

- normal
- date
- topic
- plan

At least one task type must remain enabled.

### Task templates

Each task type has an independent template configuration:

- source mode: `file` or `inline`
- template file path
- inline template content

Templater integration is optional. If you use template files handled by Templater, configure the corresponding template path here.

## Quick Start

### 1. Prepare your folder structure

Create a tasks root such as:

```text
3-任务/
  My Project/
```

### 2. Open the Tasks center

Use either:

- the plugin command palette entry
- the button in plugin settings

### 3. Create your first task

- Select a project
- Click the add-task action
- Choose a task type
- For non-date tasks, enter:
  - title
  - optional priority
  - whether it is a core task

### 4. Build hierarchy

- Drag a task onto another task to make it a subtask
- Or use the task context menu to create a subtask directly

### 5. Review progress

- Use status badges to see checklist progress
- Hover the status badge to inspect incomplete checklist items
- Hover outlink or subtask badges to navigate related notes quickly

## Usage Examples

### Example 1: Daily project review

- Open **Tasks center**
- Switch to **Core tasks**
- Sort by priority
- Hover the `In progress` badge to inspect unfinished checklist items
- Open the task note directly from the checklist popover if needed

### Example 2: Build a task hierarchy

- Create a parent task called `Launch plan`
- Right-click it and choose **Add subtask**
- Create subtasks such as `Draft copy`, `Prepare assets`, and `QA review`
- Hover the subtask-count badge to jump across direct subtasks quickly

### Example 3: Track note relationships

- Configure input, output, and outcome root paths
- Enable outlink counts
- Hover the outlink badge to see linked notes under those roots
- Click a linked note to open it in the preview pane

## Installation

### Option 1: Community Plugins

If the plugin is available in the Obsidian community catalog:

1. Open **Settings → Community plugins**
2. Disable safe mode if needed
3. Search for `IOTO Tasks Center`
4. Install and enable it

### Option 2: Manual installation

1. Download the latest release assets from [GitHub Releases](https://github.com/shawndotty/ioto-tasks-center/releases)
2. Copy these files into:

   ```text
   <YourVault>/.obsidian/plugins/ioto-tasks-center/
   ```

3. Required files:
   - `main.js`
   - `manifest.json`
   - `styles.css`
4. Reload Obsidian
5. Enable the plugin in **Settings → Community plugins**

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

## Compatibility Notes

- The plugin is not desktop-only and is intended to work on both desktop and mobile.
- Some interactions are naturally more convenient on desktop, especially:
  - drag and drop for task hierarchy
  - hover-based preview and popovers
- The plugin works with plain Markdown notes inside your vault and does not require a remote service.
- Templater is optional, not required.

## Troubleshooting

### The plugin view is empty

Check the following:

- the tasks root path exists
- your project folders are directly under the tasks root
- your task notes are directly inside the project folder, not nested deeper

### My task does not appear in the list

Possible causes:

- the file is not under the configured tasks root
- the file is inside a nested subfolder that is not scanned
- the current filter tab hides it
- the current search query filters it out

### Drag and drop does not behave as expected

Check whether:

- you are trying to drop a task onto itself
- you are trying to drop a task onto one of its descendants
- the target task is valid and visible

### Outlink badges do not appear

Check whether:

- **Show task outlink counts** is enabled
- the corresponding input/output/outcome root paths are configured correctly
- the task note actually links to notes inside those root folders
- the count is greater than zero, because zero-value badges are hidden

### Status popover is empty

This is expected when the task note has no incomplete checklist items.

### Downloads from GitHub are slow or blocked

You can still install manually by:

- building locally with `npm run build`
- copying `main.js`, `manifest.json`, and `styles.css` into the plugin folder yourself

## Release History

Release dates below are based on the repository's GitHub Releases page.

### 2.1.1 — 2026-06-15

- Native submenu behavior for subtask creation
- Core tasks tab moved to the first position and made the default
- Incomplete checklist popover on `To do` and `In progress` badges
- Priority and core-task options in the task-creation modal
- Optional subtask-count badges
- Multicolor or monochrome badge background mode

### 2.1.0 — 2026-06-10

- Collapsible subtasks
- Outlink preview improvements
- Delete-task action in the task context menu
- Search popover workflow
- Context-menu-based subtask creation
- Core-task star badge
- Simplified priority options

### 2.0.9 — 2026-06-07

- Added Project center
- Project grouping by category in the Tasks center
- Drag-and-drop feedback improvements
- Core-task marking
- Input / output / outcome note visibility and counting support
- Settings page improvements

### 2.0.8 — 2026-06-05

- Version alignment update for the broader IOTO release line

### 1.0.0 — 2026-06-04

- Initial public release

## License

0-BSD
