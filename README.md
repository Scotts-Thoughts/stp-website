# Pokemon Tierlist Creator

A desktop application for ranking Pokemon solo challenge playthroughs into tiered lists. Built with Vue 3, Vite, and Electron.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- npm (included with Node.js)

## Setup

```bash
npm install
```

## Development

### Browser (web-only, no Electron)

```bash
npm run dev
```

Opens a Vite dev server (default `http://localhost:5183`). Hot-reloads on file changes. Does not include Electron features (file system access uses the browser File System Access API instead).

### Electron (desktop app)

```bash
npm run electron:dev
```

Starts the Vite dev server and launches Electron pointing at it. Dev tools open automatically. Changes to Vue files hot-reload; changes to `electron/main.ts` or `electron/preload.cjs` require restarting the command.

### Preview (Electron without dev tools)

```bash
npm run electron:preview
```

Builds the web app and runs it in Electron without dev tools. Useful for quick local testing of a production-like build.

## Building for Distribution

### Local build (no upload)

```bash
npm run electron:build
```

This runs the full pipeline:

1. `generate-workspace` — creates the `bundled-workspace/` directory with default tierlist data
2. `build` — TypeScript check + Vite production build → `dist/`
3. `tsc -p electron/tsconfig.json` — compiles Electron main process → `dist-electron/`
4. Copies `electron/preload.cjs` → `dist-electron/preload.cjs`
5. `electron-builder` — packages the app into installers

Output goes to `release/`:

| Platform | Targets |
|----------|---------|
| Windows  | NSIS installer + portable `.exe` |
| macOS    | `.dmg` |
| Linux    | `.AppImage` |

electron-builder builds for your current platform by default. To cross-compile, see the [electron-builder docs](https://www.electron.build/multi-platform-build).

### Publishing a release (with auto-update)

```bash
export GH_TOKEN=your_github_personal_access_token
npm run electron:release
```

Same as `electron:build` but also uploads the artifacts to GitHub Releases on the public release repo ([scotts-thoughts-tierlist-creator](https://github.com/Scotts-Thoughts/scotts-thoughts-tierlist-creator)). Users running older versions will be prompted to update on launch.

**GitHub token requirements:**
- Fine-grained personal access token
- Scoped to the `scotts-thoughts-tierlist-creator` repo only
- Permission: **Contents → Read and write**

On Windows (PowerShell), set the token with:
```powershell
$env:GH_TOKEN = "your_github_personal_access_token"
npm run electron:release
```

On Windows (cmd):
```cmd
set GH_TOKEN=your_github_personal_access_token
npm run electron:release
```

### Bumping the version

Before publishing a new release, update the version in `package.json`:

```json
"version": "0.8.0"
```

The auto-updater compares this version string against the latest GitHub Release to determine if an update is available.

## Release / Auto-Update Flow

When a user launches the app:

1. The app checks the public release repo for a newer version
2. If found, a dialog appears with three options:
   - **Update** — downloads and installs immediately, then relaunches
   - **Skip** — dismisses for this session only; an update button appears on the "Choose a Tierlist" screen
   - **Don't remind me** — suppresses the dialog for this version; the update button still appears on the "Choose a Tierlist" screen
3. If offline or the check fails, the app starts normally

The "Don't remind me" preference resets when a newer version is published (e.g., dismissed v0.8.0, but v0.9.0 will prompt again).

## Project Structure

```
├── electron/
│   ├── main.ts            # Electron main process (workspace init, IPC, auto-update)
│   ├── preload.ts         # Preload script (TypeScript source)
│   ├── preload.cjs        # Preload script (CommonJS, used at runtime)
│   └── tsconfig.json      # TypeScript config for Electron code
├── src/
│   ├── app/               # Top-level app screens (ChooseTierlist, etc.)
│   ├── components/        # Vue components (TierList, PkmnImage, etc.)
│   ├── constants/         # Game definitions, configuration
│   ├── store/             # Pinia stores (workspace, tierlist, global)
│   └── utils/             # Helpers (file system, Pokemon data, time formatting)
├── public/
│   ├── data/              # Pokemon data files (pokedex, version-specific)
│   └── images/            # Pokemon sprites, cartridge images, tier images
├── bundled-workspace/     # Generated default tierlists (built by generate-workspace)
├── scripts/               # Build scripts (generate-bundled-workspace.ts)
├── dist/                  # Vite build output (web app)
├── dist-electron/         # Compiled Electron code
└── release/               # electron-builder output (installers)
```

## npm Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server (browser only) |
| `npm run build` | TypeScript check + Vite production build |
| `npm run electron:dev` | Dev mode with Electron + hot reload |
| `npm run electron:preview` | Build + run in Electron (no dev tools) |
| `npm run electron:build` | Full build + package installers (local only) |
| `npm run electron:release` | Full build + package + upload to GitHub Releases |
| `npm run generate-workspace` | Regenerate bundled workspace data |

## User Data Location

Tierlists and settings are stored in the OS-specific user data directory:

| Platform | Path |
|----------|------|
| Windows  | `%APPDATA%\pokemon-tierlist-creator\workspace\` |
| macOS    | `~/Library/Application Support/pokemon-tierlist-creator/workspace/` |
| Linux    | `~/.config/pokemon-tierlist-creator/workspace/` |
