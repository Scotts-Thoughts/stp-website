# External Change Detection

## Overview

The tierlist app loads every workspace JSON file into memory at startup and only re-reads from disk on full reload. When the companion **scheduler** app writes to a tierlist file (e.g. to sync a project's release date back to a Pokemon's attempt), the tierlist app's in-memory state goes stale. Worse, `saveWorkspace()` writes **all** in-memory tierlists back to disk, so any unrelated save would silently overwrite the scheduler's edit.

The external-change detection feature closes this gap: when a tracked file's mtime advances out-of-band, the next time the tierlist window gains focus, the user is prompted to either reload the file from disk or keep their in-memory copy.

## Architecture

### Detection: main process (`electron/main.ts`)

The main process maintains an mtime snapshot per file the renderer has touched:

```ts
const fileMtimes = new Map<string, number>()
```

Snapshots are recorded in two places:

- **On read** (`fs:readFile` IPC handler) — captures the mtime as the renderer pulls the file into memory. This is the baseline against which future external writes are compared.
- **On write** (`fs:writeFile` IPC handler) — refreshes the snapshot so the app's own writes don't trigger a false-positive on the next focus event.

When the main `BrowserWindow` emits `'focus'`, every tracked file is `statSync`'d and any whose mtime exceeds the stored snapshot (with a 1ms fudge) is reported via IPC channel `workspace:externalChange` as an array of filenames.

```ts
mainWindow.on('focus', () => {
  const changed = detectExternalChanges()
  if (changed.length > 0) {
    mainWindow.webContents.send('workspace:externalChange', changed)
  }
})
```

Two additional IPC handlers support the renderer's lifecycle:

- `watch:acknowledgeChange(filename)` — re-snapshots the current mtime, marking the change as handled. Called both when the user reloads from disk and when they choose "Keep current".
- `watch:checkNow()` — manual trigger that returns the current changed-file list without waiting for a focus event. Reserved for fallback / debugging.

### Renderer bridge (`electron/preload.cjs` + `preload.ts`)

The preload script exposes the watch API on `window.electronWatch`:

```ts
window.electronWatch = {
  onExternalChange: (callback: (filenames: string[]) => void) => () => void,
  acknowledgeChange: (filename: string) => Promise<void>,
  checkNow: () => Promise<string[]>,
}
```

`onExternalChange` registers an IPC listener for `workspace:externalChange` and returns a cleanup function. The renderer subscribes once at app mount and keeps the subscription for the app's lifetime.

> **Important:** the runtime preload file is `electron/preload.cjs`, not `preload.ts`. The build script copies the `.cjs` directly to `dist-electron/`. Both files exist for historical reasons; they must be kept in sync manually.

### Workspace store (`src/store/workspace.ts`)

Three new functions on the Pinia workspace store handle the renderer side of the workflow:

- **`reloadFiles(filenames)`** — re-reads each file from disk via `fs.read`, parses with `parseTierlist`, replaces the matching entry in `tierlists.value` (preserving array order), refreshes `tierlistBackups`, and calls `electronWatch.acknowledgeChange` for each file. Used when the user accepts a reload.

- **`acknowledgeExternalChange(filename)`** — only updates the main-process mtime snapshot, without re-reading. Used when the user chooses "Keep current". The user's next save will overwrite the external edit, but the popup won't re-fire on the next focus event.

- **`summarizeUnsavedChanges(filename)`** — diffs the live in-memory tierlist against the load-time backup stored in `tierlistBackups`. Returns `null` if there are no unsaved changes, or `{ added, removed, modified }` counts of Pokemon entries that differ. Used by the modal to warn the user when reloading would discard local edits.

The diff compares stringified entry contents (functions are dropped by `JSON.stringify`; Date fields serialize consistently to ISO strings, which is sufficient for equality checks).

### Modal UI (`src/components/ExternalChangesModal.vue`)

Vue component rendered globally via `<Teleport to="body">` from `App.vue`. Receives a `filenames` prop and emits `close` when the user resolves the prompt.

For each filename:
- The display name comes from `workspace.tierlists.find(t => t.filename === filename).name`.
- If `summarizeUnsavedChanges` returns non-null, an inline warning shows the diff summary in amber: `Unsaved local edits will be lost: +2 entries, ~5 modified`.

Two action buttons:
- **Reload from disk** — if any row has unsaved changes, a native `confirm()` dialog asks before discarding. Then calls `workspace.reloadFiles(filenames)`.
- **Keep current** — calls `workspace.acknowledgeExternalChange(filename)` for each, closing without reading from disk.

Clicking the modal overlay (outside the dialog) is treated as "Keep current".

### Global wire-up (`src/app/App.vue`)

The listener is registered in a top-level `onMounted` and torn down in `onBeforeUnmount`:

```ts
const externalChangedFiles = ref<string[]>([])

onMounted(() => {
  if (window.electronWatch) {
    unsubscribeExternalChange = window.electronWatch.onExternalChange((filenames) => {
      mergeChangedFiles(filenames)
    })
  }
})
```

`mergeChangedFiles` filters the incoming list to filenames that exist in `workspace.tierlists`, then unions with the existing pending list (so back-to-back focus events don't drop changes). The modal renders whenever `externalChangedFiles.value.length > 0`.

Filtering excludes `settings.json` and `pokemon.json` since the scheduler integration only writes tierlists; surfacing them would just confuse the user.

## End-to-end flow

1. **Renderer reads tierlist** at workspace load → main records mtime.
2. **Scheduler writes the same file** externally → on-disk mtime advances.
3. **User refocuses the tierlist window** → `BrowserWindow.on('focus')` fires.
4. **Main stat-checks all tracked files** → finds newer mtime on `gen5-black.json` (etc.).
5. **IPC `workspace:externalChange`** sent with the changed-file list.
6. **Renderer listener** filters to known tierlists, populates `externalChangedFiles`.
7. **Modal renders** via global teleport, listing affected tierlists and any unsaved-edit warnings.
8. User picks **Reload** (re-read from disk) or **Keep** (acknowledge + ignore). Either way the mtime baseline is refreshed so the popup won't re-fire until the next external write.

## Limitations

- **Detection is gated on the focus event.** Writes that happen while the tierlist app is already focused are not detected until the user blurs and refocuses the window. The scheduler workflow involves the user switching apps, so this is the intended behavior; if you need real-time detection, swap in `chokidar` or `fs.watch` and queue events for the next focus.

- **Browser (non-Electron) builds do not support this feature.** `window.electronWatch` is undefined; the listener registration is a no-op, and external file changes go undetected.

- **Files that have never been read by the renderer are not tracked.** Any tierlist not loaded at workspace startup (none, in the current design) would not be detectable.

- **The diff summary is per-entry, not per-attempt.** A modified entry might have changed in any number of attempts; the count is "1 modified entry", not "N modified attempts". Sufficient for the user to gauge magnitude before reloading.

- **Dropbox-synced workspaces remain authoritative on local mtime.** If both apps run on the same machine writing to the same Dropbox folder, mtime detection works. Two machines syncing through Dropbox is out of scope.

## Files

| File | Role |
|---|---|
| `electron/main.ts` | mtime tracking, focus handler, IPC handlers |
| `electron/preload.cjs` | runtime preload — exposes `window.electronWatch` |
| `electron/preload.ts` | type-source preload — kept in sync with `.cjs` manually |
| `src/utils/electron-fs.ts` | `Window['electronWatch']` typings |
| `src/store/workspace.ts` | `reloadFiles`, `acknowledgeExternalChange`, `summarizeUnsavedChanges` |
| `src/components/ExternalChangesModal.vue` | popup UI |
| `src/app/App.vue` | global listener registration + modal mount |
