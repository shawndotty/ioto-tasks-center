# IOTO Tasks Center

Simplified Chinese: [README.zh-CN.md](README.zh-CN.md)

Full guide: [docs/USER_GUIDE.md](docs/USER_GUIDE.md)

IOTO Tasks Center is an Obsidian community plugin for managing Markdown task files by project. It gives you a dedicated **Tasks center** for execution and a **Project center** for project metadata, while keeping everything as plain Markdown notes in your vault.

## Version

- Latest version: `2.1.1`
- Release date: `2026-06-15`
- Minimum Obsidian version: `1.1.0`
- Platform support: desktop and mobile
- Releases: [GitHub Releases](https://github.com/shawndotty/ioto-tasks-center/releases)

## Why This Plugin

- Keeps your tasks as normal Markdown files
- Organizes task files by project folders
- Adds hierarchy, metadata, search, popovers, and preview without locking data into a database
- Supports both lightweight daily execution and higher-level project management

## Highlights

- **Tasks center**
  - Project list, task list, preview pane, search, filter tabs, sorting, grouping
- **Project center**
  - Table-based project management for category, dates, archive state, and task count
- **Task creation**
  - Four task types: normal, date, topic, plan
  - Per-type templates
  - Optional priority and core-task flag during creation
- **Hierarchy**
  - Drag and drop `UpTask`
  - Context-menu subtask creation
  - Collapsible subtasks
  - Subtask count badges with hover popovers
- **Insight badges**
  - Status popovers for incomplete checklist items
  - Input/output/outcome outlink badges and popovers
  - Multicolor or monochrome badge background mode

## What's New in 2.1.1

- Native submenu behavior for creating subtasks
- Core tasks tab becomes the first and default filter
- Incomplete checklist popovers on `To do` and `In progress` badges
- Priority and core-task options added to the creation modal
- Optional subtask count badges in the task list
- Configurable badge background mode: **Multicolor** or **Monochrome**

## Quick Start

1. Create a tasks root such as `3-任务/`
2. Put project folders directly under it
3. Open **Tasks center**
4. Create tasks or subtasks
5. Configure templates, outlink roots, and badge options in plugin settings

Example structure:

```text
3-任务/
  Project Alpha/
    Kickoff.md
    Launch plan.md
```

## Installation

### Community Plugins

1. Open **Settings → Community plugins**
2. Search for `IOTO Tasks Center`
3. Install and enable it

### Manual Install

Copy these files into `<YourVault>/.obsidian/plugins/ioto-tasks-center/`:

- `main.js`
- `manifest.json`
- `styles.css`

Then reload Obsidian and enable the plugin.

## Documentation

- Full user guide: [docs/USER_GUIDE.md](docs/USER_GUIDE.md)
- Chinese full guide: [docs/USER_GUIDE.zh-CN.md](docs/USER_GUIDE.zh-CN.md)
- Chinese overview: [README.zh-CN.md](README.zh-CN.md)

The full guide includes:

- file organization
- frontmatter fields
- commands
- complete settings reference
- usage examples
- compatibility notes
- troubleshooting
- release history

## Release History

- `2.1.1` — task list workflow upgrades, status checklist popovers, subtask badges, badge color modes
- `2.1.0` — subtask collapse, context-menu subtask creation, delete action, search popover
- `2.0.9` — Project center, project category grouping, core-task support, outlink visibility improvements
- `2.0.8` — version alignment update
- `1.0.0` — initial public release

## License

0-BSD
