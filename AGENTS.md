# IOTO Tasks Center — Obsidian community plugin

## Project overview

- Obsidian Community Plugin (TypeScript → bundled JavaScript via esbuild).

- **Purpose**: manage Markdown task files organized by project folders. Provides a **Tasks center** view for execution (project list, task list, preview, search, filters) and a **Project center** view for project metadata (category, dates, archive state, task counts). All data stays as plain Markdown notes in the vault.

- Plugin metadata (`manifest.json`):

  - `id`: `ioto-tasks-center` (matches folder name; never change)

  - `name`: `IOTO Tasks Center`

  - `version`: `2.4.5`, `minAppVersion`: `1.1.0`

  - `author`: Johnny Learns

  - `isDesktopOnly`: `false` — must stay mobile-compatible (no Node/Electron-only APIs)

- Release artifacts: `main.js`, `manifest.json`, `styles.css` at the plugin root.

## Core domain concepts

- **Tasks root path**: configurable vault folder containing project folders (default `3-任务`). Each project folder contains task Markdown files.

- **Outlink roots**: `1-输入` (input), `2-输出` (output), `4-成果` (outcome) — used for outlink count badges on tasks (see `src/tasks-center/task-outlink-counts.ts`).

- **Task metadata** (frontmatter/derived): `Project`, `Status`, `Priority`, `Starred`, `UpTask` (parent task), subtask hierarchy, input/output/outcome links.

- **Task status** is derived from checklist items in the note: `todo` | `in-progress` | `completed` | `empty` (see `src/tasks-center/types.ts`).

- **Task creation types**: `normal`, `date`, `topic`, `plan` — each with its own configurable template (`taskTemplateConfigs`), plus a separate batch template (`batchTemplateConfig`).

- **Cursor marker**: templates may contain `%%Cursor%%` (case-insensitive); it is stripped on creation and the editor cursor lands at that offset (see `src/tasks-center/cursor-marker.ts`).

- **Task search**: two entry modes (`taskSearchEntryMode`: `inline` or `modal`), backed by a cached search index and Obsidian's internal fuzzy-match API (`src/views/tasks-center/task-search-*.ts`, `fuzzy-match.ts`).

- Task notes also integrate with Obsidian's native **file menu** (core/priority/starred items, configurable via `showTaskNoteCoreMenu` / `showTaskNotePriorityMenu`); see `src/tasks-center/task-note-menu.ts`.

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
npm run dep:check  # dependency-cruiser: fail on value-level circular deps (type-only cycles allowed)
npm run version    # version-bump.mjs; updates manifest.json + versions.json
npm run build:deploy  # build + zip + tag + release to GitHub & Gitee (see "Versioning & releases")
```

## Source structure

```
src/
  main.ts                        # Plugin entry: IOTOTasksCenter lifecycle only (onload/loadSettings/refresh); update* methods are thin delegates
  settings-updaters.ts           # Settings update functions (core + barrel): SettingsUpdaterHost, resolveExportOptions, simple compare-style updaters; re-exports extended set
  settings-updaters-extended.ts  # Settings update functions (complex): root-path / template / array / export-image updaters needing normalize/merge/set helpers + areStringArraysEqual
  task-view-routing.ts           # Task view routing/activation helpers (openFileAsIOTOTask, setLeafToMarkdown, activate*, getTasksCenterView, appendTaskViewMenuItems, ...)
  settings.ts                    # Settings barrel: re-exports public API + slim SettingTab class
  settings-types.ts              # Settings types, constants, DEFAULT_SETTINGS
  settings-options.ts            # get*Options + is*Mode type guards
  settings-normalizers.ts        # normalize* functions
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
    cursor-marker.ts             # %%Cursor%% template placeholder stripping/offset
    frontmatter-properties.ts    # Atomic frontmatter rewrite via vault.process
    task-note-menu.ts            # Native file-menu items for task notes
    task-path.ts                 # Path normalization, isPathInsideRoot
    project-creation.ts          # Project folder creation
    project-metadata.ts          # Project frontmatter metadata
    project-sort.ts              # Project sorting
    date-task-format.ts          # Date task file name format (default YYYY-MM-DD)
    task-outlink-counts.ts       # Input/output/outcome outlink counts
    enabled-task-creation-types.ts
    data.ts                      # Vault data loading
  views/                         # View layer
    iotoTasksCenterView.ts       # Tasks center view (IOTO_TASKS_CENTER_VIEW_TYPE)
    iotoProjectCenterView.ts     # Project center view (IOTO_PROJECT_CENTER_VIEW_TYPE) — lifecycle + state + render orchestrator; rendering/actions split into project-center-* sub-modules
    iotoTaskView.ts              # Task view (IOTO_TASK_VIEW_TYPE) — lifecycle + state + thin delegate orchestrator; logic split into ioto-task/task-view-* sub-modules (Phase 7)
    task-hover-preview.ts        # Hover link source registration
    task-drag.ts, task-hierarchy.ts, task-search.ts, task-filter-tabs.ts,
    task-list-presentation.ts, task-list-scroll.ts, task-preview-state.ts,
    project-center-scroll.ts, project-center-search.ts, project-center-sort.ts,
    project-center-types.ts, project-center-header.ts, project-center-renderer.ts,
    project-center-cells.ts, project-center-card.ts, project-center-actions.ts,
    project-list-group.ts, project-list-scroll.ts
    tasks-center/                # Tasks center view submodules
      constants.ts, data-loader.ts, helpers.ts
      projects-pane-renderer.ts, tasks-pane-renderer.ts, task-row-renderer.ts
      drag-controller.ts, search-controller.ts, popover-controller.ts
      batch-edit-operations.ts, menus.ts, task-operations.ts
      task-time-filter.ts, outlink-badge-sync.ts, preview-leaf.ts
      task-search-index.ts, task-search-session.ts, task-search-row.ts,
      fuzzy-match.ts             # Fuzzy search: index cache + Obsidian internal API wrapper
      touch-gesture.ts           # Mobile long-press drag gestures
      task-search-ops.ts         # Task search query/focus/summary/filter counts/incremental render (split from iotoTasksCenterView)
      task-tabs-renderer.ts      # Task tabs + compact filter switcher (split from iotoTasksCenterView)
      task-list-queries.ts       # Visible tasks/collapse/batch edit/description (split from iotoTasksCenterView)
      deferred-refresh.ts        # Hover preview + deferred vault refresh (split from iotoTasksCenterView)
      compact-layout.ts         # Project switcher + resize observer + header toggle (split from iotoTasksCenterView)
      empty-states.ts           # Filter/search empty states (split from iotoTasksCenterView)
      task-file-opening.ts      # Task file opening + preview editor ops (split from iotoTasksCenterView)
    ioto-task/                  # Task view submodules
      render-note.ts, render-sections.ts, render-checklist-card.ts,
      render-card-actions.ts, render-card-keybind.ts, render-control-badges.ts
      card-navigation.ts, commit-task-line.ts, delete-confirm.ts,
      edit-autosave.ts, embedded-editor.ts, fit-anchored-popup.ts,
      ioto-task-scroll.ts, item-control-bridge.ts, list-transition.ts,
      recent-task-filter.ts, search-highlight.ts, search-scope.ts,
      select-mode-scope.ts, task-query-filter.ts
      task-view-constants.ts, task-view-helpers.ts   # Shared constants/interfaces + line/query helpers (split from iotoTaskView)
      task-view-toolbar.ts      # Toolbar build/state/refresh + appearance/recent-count/entry-template (split from iotoTaskView)
      task-view-search.ts       # In-view keyword search: reveal/toggle/input/query/match/highlight (split from iotoTaskView)
      task-view-filters.ts      # Frontmatter-backed filters: onlyTaskBlocks/onlyPending/recentOnly (split from iotoTaskView)
      task-view-render.ts       # renderNote + list transition + selection class + reload + editor/link controllers (split from iotoTaskView)
      task-view-zoom.ts         # Card focus-zoom: enter/exit/DOM/sync/edit-flush/focus (split from iotoTaskView)
      task-view-command-readiness.ts  # Command readiness polling + dispatch (split from iotoTaskView)
      task-view-selection.ts    # Select state machine: select/delete/indent/insert/pending-delete/continuation (split from iotoTaskView)
      task-view-inline-edit.ts  # Inline title editor: begin/commit/destroy/refresh/autosave (split from iotoTaskView)
      task-view-continuation-edit.ts  # Continuation editor: begin/new/enter/delete/escape/commit/destroy/autosave (split from iotoTaskView)
      task-view-editor-handlers.ts    # CodeMirror event handlers: escape/soft-break/enter/delete/indent + runLineAction/toggleTask (split from iotoTaskView)
      task-view-item-control-host.ts  # Item control bridge host + quick panel + AI item source (split from iotoTaskView)
      task-view-task-commands.ts      # Add task / append block / entry template / run task (split from iotoTaskView)
      task-view-external-writeback.ts # External editor writeback window (Templater etc.) (split from iotoTaskView)
      task-view-export-image.ts       # Export as image / copy to clipboard / Electron canvas (split from iotoTaskView)
  ui/                            # Modals and popovers
    taskCreationModal.ts, taskNameModal.ts, batchTaskModals.ts,
    batchTemplateEditModal.ts, confirmModal.ts, tabbed-settings.ts,
    task-outlink-popover.ts, task-search-modal.ts, task-status-checklist-popover.ts
    settings-tab/                  # Settings tab section renderers (split from settings.ts)
      helpers.ts, basic-general-section.ts, basic-display-section.ts,
      task-types-section.ts, task-templates-section.ts,
      batch-templates-section.ts, entry-templates-section.ts
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

- `scripts/` — `deploy-release.mjs`, the one-command release script (`npm run build:deploy`).

- `.github/workflows/` — `lint.yml` (lints every commit on all branches). Releases are produced locally by `npm run build:deploy`, not by CI.

## Architecture patterns (follow these)

### main.ts stays minimal

`main.ts` only handles lifecycle: load/save settings, register views, commands, hover link source, task note file-menu, settings tab, and vault refresh events. All feature logic lives in `tasks-center/` (domain), `views/` (UI), and `ui/` (modals/popovers).

### Dependency-injected views

Views are constructed in `main.ts` with **getter callbacks** for reading settings and **update callbacks** for persisting changes (see `registerView` calls in `src/main.ts`). This keeps views decoupled from the plugin instance. New view settings should follow the same pattern: add getter + updater, never import the plugin singleton into views.

### 跨模块引用类型一律 `import type`

Layering 约束：子模块**反向**引用宿主（视图/设置）的类型时，必须写 `import type`（或内联 `type` 前缀）。

**Why**：本仓依赖图里存在大量类型级环，全靠 `import type` 在编译期擦除才没变成运行期值级环。

**How enforced**：已由 `verbatimModuleSyntax`（类型误用值语法 → 编译报错 `TS1484`）+ `dependency-cruiser`（值图有环 → `npm run dep:check` / CI 报红）**双重门禁**保障；本段仅作「为什么」说明，**不是唯一防线**。（方案出处：`Plan-20261009-142035`；叶子类型模块先例：`src/views/ioto-task/render-note-types.ts`。）

### View state access discipline

任务视图（`IOTOTaskView`）拆出的子模块访问视图状态时，遵循以下纪律：

- **读**：只读字段走 `readonly` 声明或 getter；不要为了取一个值而先写后读。
- **写**：改状态**集中在少数「状态迁移点」**（如 `task-view-selection` / `task-view-inline-edit` / `task-view-zoom` / `task-view-continuation-edit`），不要在多个模块零散直写同一字段。
- **新增跨模块访问**：优先给 barrel 加**薄委托方法**，而不是直接摸状态字段。

**Why**：拆分子模块后，barrel 的状态字段以默认（public）修饰符暴露、被子模块直读写约 130 处；`private` 只是编译期修饰符，本次拆分**刻意**选择了「`view` 首参 + 薄委托」而非接口化（成本差异所致，见 `Report-20261009-104208` §四.2）。

**How enforced**：由 `TaskViewHost` 契约接口（`src/views/ioto-task/task-view-host.ts`，编译期拦下未声明成员的访问）+ `scripts/check-view-writes.mjs`（拦下未登记的直写）保障；本段仅作「为什么」说明，**不是唯一防线**。（方案出处：`Plan-20261009-155708`；迁移先例：`SettingsUpdaterHost` / `ProjectCenterViewContext`。）

### Settings lifecycle

- Every setting has a `normalize*` function applied on load (`loadSettings`) and on update (see `src/settings-normalizers.ts` and `src/tasks-center/*`).

- Update methods follow the pattern: normalize → skip if unchanged → `saveSettings()` → `applySettingsToOpenViews()`. The implementation lives in `src/settings-updaters.ts` (simple compare-style updaters) and `src/settings-updaters-extended.ts` (updaters needing normalize/merge/set helpers); `main.ts` keeps the public `update*` methods as thin delegates over `SettingsUpdaterHost` so view callbacks and the settings tab keep calling `plugin.updateXxx` unchanged.

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

- `itc-focus-task-search` — focus the task search entry (opens the Tasks center first if needed)

- `itc-clear-task-search` — clear the active task search

Some batch commands are currently commented out in `main.ts`; keep them there unless asked otherwise.

## Testing

- Tests use `node:test` + `jiti` to import TypeScript modules directly (no build step needed). See any file in `tests/` for the pattern; `tests/stubs/obsidian.mjs` stubs the `obsidian` module for tests that need it.

- `tests/locale-key-alignment.test.mjs` enforces that `en`, `zh-cn`, `zh-tw` locale keys stay in sync — run it after any i18n change.

- When adding/changing logic in `src/tasks-center/` or pure helpers in `src/views/`, add or update the matching `tests/*.test.mjs`.

- Run `npm test` before finishing any change.

## Coding conventions

- TypeScript with `"strict": true`.

- Split large files: if a file exceeds \~200-300 lines, break it into focused modules.

- `tasks-center/` modules must stay UI-free and testable; DOM rendering belongs in `views/` or `ui/`.

- Prefer `async/await`; handle errors with user-visible `Notice` where appropriate.

- For read-modify-write of note content, use `vault.process` (atomic) via `src/tasks-center/frontmatter-properties.ts` instead of `vault.read` + `vault.modify`.

- Register all DOM/app/interval listeners with `this.register*` helpers so reload/unload is safe.

- Keep startup light: heavy work is deferred to view opening, not `onload`.

## Linting

- ESLint 9 flat config (`eslint.config.mts`) with `eslint-plugin-obsidianmd` recommended rules.

- Run `npm run lint` before committing; CI lints every commit on all branches.

- **Dependency gate**: `npm run dep:check` (dependency-cruiser, config `.dependency-cruiser.cjs`) fails the build on **value-level** circular dependencies. Type-only cycles (`import type`) are intentionally allowed — they are erased at compile time. CI runs it after `npm run lint`.

## Versioning & releases

- Bump `version` in `manifest.json` (SemVer) and update `versions.json` (plugin version → minimum app version). `npm run version` automates this; commit the bump before releasing (the release script does not commit).

- Publish with `npm run build:deploy`: it runs `npm run build`, packs `main.js` / `manifest.json` / `styles.css` into `ioto-tasks-center.zip`, creates and pushes the tag `v<version>` (matching `manifest.json`'s `version`, with a leading `v`), then creates a Release on GitHub and Gitee, each with all 4 assets attached. GitHub reuses the logged-in `gh`; Gitee needs `GITEE_TOKEN` (or a local `.gitee-token` file). Flags: `--dry-run` / `--github-only` / `--gitee-only` / `--force` / `--notes` / `--notes-file`. Releases are created by this script, not by CI.

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

