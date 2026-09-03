# IOTO Tasks Center — Obsidian community plugin

## Project overview

- Obsidian Community Plugin (TypeScript → bundled JavaScript via esbuild).

- **Purpose**: manage Markdown task files organized by project folders. Provides a **Tasks center** view for execution (project list, task list, preview, search, filters) and a **Project center** view for project metadata (category, dates, archive state, task counts). All data stays as plain Markdown notes in the vault.

- Plugin metadata (`manifest.json`):

  - `id`: `ioto-tasks-center` (matches folder name; never change)

  - `name`: `IOTO Tasks Center`

  - `version`: `2.3.6`, `minAppVersion`: `1.1.0`

  - `author`: Johnny Learns

  - `isDesktopOnly`: `false` — must stay mobile-compatible (no Node/Electron-only APIs)

- Release artifacts: `main.js`, `manifest.json`, `styles.css` at the plugin root.

## Core domain concepts

- **Tasks root path**: configurable vault folder containing project folders (default `3-任务`). Each project folder contains task Markdown files.

- **Outlink roots**: `1-输入` (input), `2-输出` (output), `4-成果` (outcome) — used for outlink count badges on tasks (see `src/tasks-center/task-outlink-counts.ts`).

- **Task metadata** (frontmatter/derived): `Project`, `Status`, `Priority`, `Starred`, `UpTask` (parent task), subtask hierarchy, input/output/outcome links.

- **Task status** is derived from checklist items in the note: `todo` | `in-progress` | `completed` | `empty` (see `src/tasks-center/types.ts`).

- **Task creation types**: `normal`, `date`, `topic`, `plan` — each with its own configurable template (`taskTemplateConfigs`), plus a separate batch template (`batchTemplateConfig`).

- Vault events (`create`/`delete`/`modify`/`rename`) trigger view refresh only when the affected path is under the tasks root.

## Environment & tooling

- **Package manager: npm**. **Bundler: esbuild** (`esbuild.config.mjs`). Types: `obsidian` package.

- TypeScript strict mode.

```bash
npm install        # install dependencies
npm run dev        # esbuild watch mode (dev sourcemaps)
npm run build      # typecheck (tsc -noEmit -skipLibCheck) + esbuild production
npm test           # node --test tests/**/*.test.mjs
npm run lint       # eslint .
npm run version    # version-bump.mjs; updates manifest.json + versions.json
```

## Source structure

```
src/
  main.ts                        # Plugin entry: IOTOTasksCenter lifecycle only
  settings.ts                    # Settings interface, defaults, normalizers, settings tab
  tasks-center/                  # Core domain logic (no DOM/UI)
    types.ts                     # Shared types, default root paths, path normalizers
    task-creation.ts             # Task file creation, templates, frontmatter helpers
    task-deletion.ts             # Task deletion
    task-priority.ts             # Priority read/write
    task-starred.ts              # Starred read/write
    up-task-assignment.ts        # UpTask (parent) assignment
    selected-text-subtask.ts     # Editor command: selection → subtask
    task-template-config.ts      # Per-type template configs
    batch-task-template.ts       # Batch creation template
    project-creation.ts          # Project folder creation
    project-metadata.ts          # Project frontmatter metadata
    project-sort.ts              # Project sorting
    date-task-format.ts          # Date task file name format (default YYYY-MM-DD)
    task-outlink-counts.ts       # Input/output/outcome outlink counts
    enabled-task-creation-types.ts
    data.ts                      # Vault data loading
  views/                         # View layer
    iotoTasksCenterView.ts       # Tasks center view (IOTO_TASKS_CENTER_VIEW_TYPE)
    iotoProjectCenterView.ts     # Project center view (IOTO_PROJECT_CENTER_VIEW_TYPE)
    task-hover-preview.ts        # Hover link source registration
    task-drag.ts, task-hierarchy.ts, task-search.ts, task-filter-tabs.ts,
    task-list-presentation.ts, task-list-scroll.ts, task-preview-state.ts,
    project-center-scroll.ts, project-center-search.ts, project-center-sort.ts,
    project-list-group.ts, project-list-scroll.ts
    tasks-center/                # Tasks center view submodules
      constants.ts, data-loader.ts, helpers.ts
      projects-pane-renderer.ts, tasks-pane-renderer.ts, task-row-renderer.ts
      drag-controller.ts, search-controller.ts, popover-controller.ts
      batch-edit-operations.ts, menus.ts, task-operations.ts
      task-time-filter.ts, outlink-badge-sync.ts, preview-leaf.ts
  ui/                            # Modals and popovers
    taskCreationModal.ts, taskNameModal.ts, batchTaskModals.ts,
    batchTemplateEditModal.ts, confirmModal.ts, tabbed-settings.ts,
    task-outlink-popover.ts, task-search-popover.ts, task-status-checklist-popover.ts
  modals/ImportModal.ts          # Import dialog
  lang/                          # i18n
    helpter.ts                   # t(), getCurrentLang(); TranslationKey = keyof typeof en
    locale/en.ts, zh-cn.ts, zh-tw.ts
  typings/obsidian-ex.d.ts       # Obsidian type extensions
```

Other folders/files:

- `tests/` — unit tests (`*.test.mjs`, node:test + jiti to import TS modules). Feature modules are expected to have matching tests.

- `docs/` — user guide (English + Simplified Chinese).

- `plans/` — design docs for larger features (Chinese).

- `styles.css` — plugin styles (single file, shipped as release artifact).

- `eslint.config.mts` — ESLint 9 flat config with `eslint-plugin-obsidianmd` recommended rules.

- `.github/workflows/` — `lint.yml` (lints every commit), `release.yml`.

## Architecture patterns (follow these)

### main.ts stays minimal

`main.ts` only handles lifecycle: load/save settings, register views, commands, hover link source, settings tab, and vault refresh events. All feature logic lives in `tasks-center/` (domain), `views/` (UI), and `ui/` (modals/popovers).

### Dependency-injected views

Views are constructed in `main.ts` with **getter callbacks** for reading settings and **update callbacks** for persisting changes (see `registerView` calls in `src/main.ts`). This keeps views decoupled from the plugin instance. New view settings should follow the same pattern: add getter + updater, never import the plugin singleton into views.

### Settings lifecycle

- Every setting has a `normalize*` function applied on load (`loadSettings`) and on update (see `src/settings.ts` and `src/tasks-center/*`).

- Update methods follow the pattern: normalize → skip if unchanged → `saveSettings()` → `applySettingsToOpenViews()`.

- Persist via `this.loadData()` / `this.saveData()` only.

- Legacy settings migration happens in `loadSettings` (e.g., `resultRootPath` → `outcomeRootPath`, `taskTemplatePath` → `taskTemplateConfigs`).

### i18n is mandatory for user-facing strings

- Use `t('key')` from `src/lang/helpter.ts`. Never hardcode UI strings.

- `TranslationKey` is `keyof typeof en`, so adding a key requires updating **all three** locale files: `locale/en.ts`, `locale/zh-cn.ts`, `locale/zh-tw.ts`.

### Commands

Registered in `main.ts` with stable IDs (don't rename once released). Current active commands:

- `open-tasks-center-view` — open the Tasks center

- `open-project-center-view` — open the Project center

- `convert-selected-text-to-subtask` — editor command (Alt+Shift+3), uses `editorCheckCallback`

- `batch-create-tasks-from-template`

- `itc-toggle-batch-edit-mode`

Some batch commands are currently commented out in `main.ts`; keep them there unless asked otherwise.

## Testing

- Tests use `node:test` + `jiti` to import TypeScript modules directly (no build step needed). See any file in `tests/` for the pattern.

- When adding/changing logic in `src/tasks-center/` or pure helpers in `src/views/`, add or update the matching `tests/*.test.mjs`.

- Run `npm test` before finishing any change.

## Coding conventions

- TypeScript with `"strict": true`.

- Split large files: if a file exceeds \~200-300 lines, break it into focused modules.

- `tasks-center/` modules must stay UI-free and testable; DOM rendering belongs in `views/` or `ui/`.

- Prefer `async/await`; handle errors with user-visible `Notice` where appropriate.

- Register all DOM/app/interval listeners with `this.register*` helpers so reload/unload is safe.

- Keep startup light: heavy work is deferred to view opening, not `onload`.

## Linting

- ESLint 9 flat config (`eslint.config.mts`) with `eslint-plugin-obsidianmd` recommended rules.

- Run `npm run lint` before committing; CI lints every commit on all branches.

## Versioning & releases

- Bump `version` in `manifest.json` (SemVer) and update `versions.json` (plugin version → minimum app version). `npm run version` automates this.

- Create a GitHub release whose tag exactly matches `manifest.json`'s `version` (no leading `v`). Attach `manifest.json`, `main.js`, and `styles.css` as individual assets.

- Update `docs/USER_GUIDE.md` (+ Chinese version) and the README version/changelog sections when shipping user-facing changes.

## UX & copy guidelines

- Prefer sentence case for headings, buttons, and titles.

- Use **bold** for literal UI labels and arrow notation for navigation: **Settings → Community plugins**.

- Keep in-app strings short, consistent, jargon-free — in all three locales.

## Security, privacy, and compliance

- Plugin is fully local/offline. Do not add network requests, telemetry, or remote code execution.

- Read/write only within the vault, and preferably only under the configured root paths.

- Follow Obsidian Developer Policies and Plugin Guidelines (<https://docs.obsidian.md/Developer+policies>).

## Manual testing in a vault

Copy `main.js`, `manifest.json`, `styles.css` into `<Vault>/.obsidian/plugins/ioto-tasks-center/`, reload Obsidian, enable in **Settings → Community plugins**, then run **IOTO Tasks Center: Open tasks center view**.

## Troubleshooting

- Plugin doesn't load: ensure `main.js` + `manifest.json` are at the top level of the plugin folder; run `npm run build`.

- Commands not appearing: verify `addCommand` runs in `onload` and IDs are unique.

- Settings not persisting: ensure `loadData`/`saveData` are awaited and `applySettingsToOpenViews()` runs after changes.

- View not refreshing: vault-change refresh only fires for paths under `tasksRootPath`; check `shouldRefreshTasksCenter` in `src/main.ts`.

## References

- User guide: [docs/USER\_GUIDE.md](docs/USER_GUIDE.md)

- Obsidian API docs: <https://docs.obsidian.md>

- Plugin guidelines: <https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines>

