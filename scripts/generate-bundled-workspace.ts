/**
 * Generates bundled-workspace with blank tierlists for each game defined in the app.
 * Run before electron:build so the built app ships with one empty tierlist per game.
 * Does not include any pre-existing (e.g. "scott") tierlists.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TIERLIST_GAMES } from '../src/constants/games'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'bundled-workspace')

function tierlistFilename(gameName: string): string {
  return `${gameName.toLowerCase().replace(/[^a-z0-9]/gi, '_')}.json`
}

function blankTierlistJson(game: { name: string; platform: string; cartridgeImage?: string }) {
  return {
    name: 'Default Tierlist',
    game: game.name,
    total: [0],
    thresholds_first: {},
    thresholds_best: {},
    entries: {},
    platform: game.platform,
    ...(game.cartridgeImage && { cartridgeImage: game.cartridgeImage }),
    visible: true,
  }
}

function main() {
  if (fs.existsSync(OUT_DIR)) {
    const entries = fs.readdirSync(OUT_DIR, { withFileTypes: true })
    for (const e of entries) {
      fs.rmSync(path.join(OUT_DIR, e.name), { recursive: true })
    }
  } else {
    fs.mkdirSync(OUT_DIR, { recursive: true })
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'settings.json'),
    JSON.stringify({}, null, 2),
    'utf-8'
  )
  fs.writeFileSync(
    path.join(OUT_DIR, 'pokemon.json'),
    JSON.stringify({}, null, 2),
    'utf-8'
  )

  for (const game of TIERLIST_GAMES) {
    const filename = tierlistFilename(game.name)
    const content = blankTierlistJson(game)
    fs.writeFileSync(
      path.join(OUT_DIR, filename),
      JSON.stringify(content, null, 2),
      'utf-8'
    )
  }

  // Copy Scott tierlists from scott-tierlists/ if present (add-if-missing at runtime for existing workspaces)
  const scottSourceDir = path.join(ROOT, 'scott-tierlists')
  if (fs.existsSync(scottSourceDir)) {
    const scottFiles = fs.readdirSync(scottSourceDir).filter((f) => f.startsWith('scott-') && f.endsWith('.json'))
    for (const file of scottFiles) {
      fs.copyFileSync(path.join(scottSourceDir, file), path.join(OUT_DIR, file))
    }
    if (scottFiles.length > 0) {
      console.log(`Added ${scottFiles.length} Scott tierlist(s) to bundled-workspace.`)
    }
  }

  console.log(`Generated bundled-workspace: settings.json, pokemon.json, and ${TIERLIST_GAMES.length} blank tierlists.`)
}

main()
