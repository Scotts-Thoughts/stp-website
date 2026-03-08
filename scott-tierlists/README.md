# Scott tierlists (bundled with build)

Place tierlist JSON files named `scott-*.json` in this folder. They will be:

1. **Included in the app build** – copied into `bundled-workspace` when you run `npm run generate-workspace` (or `npm run electron:build`).
2. **Added to existing workspaces** – when the Electron app starts, any bundled Scott tierlist that is not already in the user's workspace is copied in (existing files are never overwritten).

Example: `scott-yellow.json`, `scott-crystal.json`, etc.
