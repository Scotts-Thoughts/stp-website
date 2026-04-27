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

Releases are built and published by **GitHub Actions** — no local build, no token on your machine. Source lives in [`stp-website`](https://github.com/Scotts-Thoughts/stp-website); the workflow uploads the resulting installer to the public release repo [`scotts-thoughts-tierlist-creator`](https://github.com/Scotts-Thoughts/scotts-thoughts-tierlist-creator), which is where `electron-updater` looks for new versions.

#### Day-to-day release flow

1. Commit and push all the changes you want shipped.
2. From the project root:
   ```cmd
   release.bat
   ```
   This bumps the patch version in `package.json`, commits the bump, pushes to `main`, then pushes a `vX.Y.Z` tag.
3. The tag push triggers `.github/workflows/release.yml`, which:
   - Builds the Windows installer on a `windows-latest` runner
   - Creates a GitHub Release in `scotts-thoughts-tierlist-creator` with auto-generated release notes and the `.exe` attached
4. Track progress at https://github.com/Scotts-Thoughts/stp-website/actions
5. The release appears at https://github.com/Scotts-Thoughts/scotts-thoughts-tierlist-creator/releases

For a minor or major bump instead of patch, do it manually:
```cmd
npm version minor
git push origin main
npm run build:release
```

#### One-time setup: the `RELEASE_TOKEN` secret

Because the workflow publishes to a *different* repo than it runs in, the default `GITHUB_TOKEN` isn't sufficient — a Personal Access Token (PAT) must be stored as a secret on `stp-website`. This is a **one-time** setup; the token never touches your local machine.

1. Create a fine-grained PAT: https://github.com/settings/personal-access-tokens/new
   - **Resource owner**: `Scotts-Thoughts`
   - **Repository access**: Only select repositories → `scotts-thoughts-tierlist-creator`
   - **Permissions**: Contents → **Read and write** (leave everything else at No access)
   - **Expiration**: 1 year (set a calendar reminder to rotate)
2. Copy the generated token (starts with `github_pat_`).
3. Add it as a repository secret on `stp-website`:
   - Go to https://github.com/Scotts-Thoughts/stp-website/settings/secrets/actions
   - **New repository secret** → Name: `RELEASE_TOKEN` → Value: paste the token

When the token expires, repeat the steps and update the secret value — nothing else changes.

#### Local fallback (rarely needed)

`npm run electron:release` builds and publishes from your machine instead of CI. It requires `GH_TOKEN` set in your shell environment (same scope as the PAT above). Prefer the CI flow — local publishing exists only as a backup if Actions is down.

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
| `npm run electron:build` | Full build + package installers (`--publish never` — used by CI and for local-only builds) |
| `npm run electron:release` | Full build + package + upload to GitHub Releases (local fallback; needs `GH_TOKEN`) |
| `npm run build:release` | Tag the current `package.json` version and push the tag (triggers CI) |
| `npm run generate-workspace` | Regenerate bundled workspace data |

## Release Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `build-windows` job fails with `GitHub Personal Access Token is not set, neither programmatically, nor using env "GH_TOKEN"` | `electron-builder` auto-detected the tag and tried to publish itself instead of letting the workflow's release step handle it. | Confirm `electron:build` in `package.json` ends with `--publish never`. |
| `publish` job fails with `Resource not accessible by integration` | The `RELEASE_TOKEN` secret is missing, expired, or doesn't have **Contents: Read and write** on `scotts-thoughts-tierlist-creator`. | Regenerate the PAT (see "One-time setup" above) and update the secret. |
| `publish` job fails with `Bad credentials` | The `RELEASE_TOKEN` value was pasted incorrectly or the PAT was deleted. | Re-add the secret with a fresh token. |
| `release.bat` fails at `git push origin main` | Local `main` is behind the remote (someone else pushed) or you have unpushed merge conflicts. | `git pull --rebase`, resolve, then re-run. |
| Tag pushed but no workflow run started | The tag doesn't match `v*`, or Actions is disabled on the repo. | Check the tag name and the Actions tab settings. |
| Auto-updater doesn't see a new release | Release was published as a *draft*, or the `version` in `package.json` for the new release isn't actually higher. | Check the Releases page on `scotts-thoughts-tierlist-creator` and the version field. |

## User Data Location

Tierlists and settings are stored in the OS-specific user data directory:

| Platform | Path |
|----------|------|
| Windows  | `%APPDATA%\pokemon-tierlist-creator\workspace\` |
| macOS    | `~/Library/Application Support/pokemon-tierlist-creator/workspace/` |
| Linux    | `~/.config/pokemon-tierlist-creator/workspace/` |
