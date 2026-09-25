---
name: verify
description: Build, launch and drive the Electron app headlessly (no desktop automation) to verify export/rendering changes end to end over CDP.
---

# Verifying the app without touching the desktop

The owner does not want the desktop automated (no SendKeys / window focusing). Use the
dev-only hooks in `electron/main.ts` (ignored when packaged) and drive the page over CDP.

## Launch

```bash
npx tsc -p electron/tsconfig.json          # main-process changes only
npx vite --port 5183 --strictPort          # background
STP_HEADLESS=1 STP_AUTOSAVE_DIR=<out dir> VITE_DEV_SERVER_URL=http://localhost:5183 \
  npx electron . --remote-debugging-port=9333 --user-data-dir=<scratch userdata>
```

- `--user-data-dir` in the scratchpad keeps the real workspace untouched (seeded from `bundled-workspace/`).
- `STP_AUTOSAVE_DIR` answers both the video save dialog (`<dir>/<defaultName>`) and the folder picker (`<dir>`).
- TaskStop does not kill the spawned children — stop `electron`/`node` by StartTime with `Stop-Process`, and never touch instances you didn't start.

## Drive

Node 22 has a global `WebSocket`; connect to the `/json` target whose `url` starts with
`http://localhost:5183` (a DevTools page is listed first) and `Runtime.evaluate` an async IIFE
with `awaitPromise` + `returnByValue`. Print `exceptionDetails` and subscribe to
`Runtime.exceptionThrown` — otherwise script and renderer errors are silent.

- Chooser: click the "Scott's Tierlists" button first, then the `.cartridge` whose text matches the
  game and whose `.game-title` isn't "Default Tierlist" (a Default card opens a blocking `window.prompt`).
- Stores: `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('tierlist' | 'toast' | 'contextmenu' | 'global')`.
  `toast.toasts` is readonly — don't splice it; wait for a toast with `id` greater than the max seen before the action.
- Context menu: dispatch `contextmenu` on `.wrapper`, click the `.context-menu div` by label, then `contextmenu.hide()`.
- Component state: `el.__vueParentComponent.setupState` (`.wrapper` → ViewingTierlist).
- Modal buttons/lists are plain DOM; `<input type=date>` takes `value` + `dispatchEvent(new Event('input'))`.

## Check the output

`node_modules/ffmpeg-static/ffmpeg.exe` extracts frames (`-vf select=eq(n\,0)` first, `-sseof -0.05` last).
Videos are lossless PNG-in-MOV, so pixel diffs against the exported stills are exact: a change video's
first frame must equal the preceding still and consecutive videos must join with zero diffs.

## Gotchas

- A hidden window throttles rAF; the compositor's `nextFrame()` already races a 50 ms timeout.
- Starting a second export while one records corrupts the live view (sprites left hidden) — wait for
  `.change-overlay` to disappear and the wrapper to drop `exporting` between runs.
- Run helper Python with the Windows `py` launcher; the msys `python` on PATH can't see Windows paths.
