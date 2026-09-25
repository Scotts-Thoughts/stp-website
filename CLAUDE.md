# CLAUDE.md

## Version bumps

The version lives in exactly three places. Change all three and nothing else:

- `package.json`, the top-level `"version"`
- `package-lock.json`, the `"version"` on line 3 (top level) and line 9 (`packages[""]`)

Edit those lines directly rather than running `npm version`, which can rewrite the whole lock file.

Leave these alone:

- `release/latest.yml` is electron-builder output and is regenerated on every build.
- The `v0.8.0` / `v0.9.0` in `README.md` is an example in prose, not the current version.

To ship: commit the bump, then run `npm run build:release`. It tags `v<package.json version>`
and force-pushes the tag. That tag triggers `.github/workflows/release.yml`, which re-sets the
version from the tag (`scripts/set-version-from-tag.cjs`) and publishes the release.
