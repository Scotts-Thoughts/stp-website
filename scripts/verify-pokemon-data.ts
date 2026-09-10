/**
 * Regression harness for Pokemon names / images / pokedex lookups.
 *
 * For every entry of every tierlist on disk it prints the resolved image path,
 * whether that file actually exists, and the pokedex lookup result. Run it before
 * and after a change and diff the two outputs to prove existing tierlists still
 * render identically:
 *
 *   npx tsx scripts/verify-pokemon-data.ts > before.txt
 *   ...make changes...
 *   npx tsx scripts/verify-pokemon-data.ts > after.txt
 *   diff before.txt after.txt
 *
 * Pass --audit for a summary of unreferenced images and unreachable names.
 */
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') + path.sep

// pokedex-data.js is a plain script that assigns a global; index.html loads it via <script>.
;(globalThis as any).window = globalThis
;(0, eval)(fs.readFileSync(ROOT + 'public/data/pokedex-data.js', 'utf8'))

const { pokemonNames } = await import('../src/utils/pokemon.ts')
const { resolvePokemonImagePath } = await import('../src/utils/pokemon/images.ts')
const { getPokemonData } = await import('../src/utils/pokemon/pokedex.ts')

const thumbs = new Set(fs.readdirSync(ROOT + 'public/images/pokemon_thumbnail'))
const yellow = new Set(fs.readdirSync(ROOT + 'public/images/yellow-sprites'))

function imageExists(p: string): boolean {
  const rel = p.replace('./images/', '')
  const slash = rel.indexOf('/')
  const dir = rel.substring(0, slash)
  const name = rel.substring(slash + 1)
  if (dir === 'pokemon_thumbnail') return thumbs.has(name)
  if (dir === 'yellow-sprites') return yellow.has(name)
  return fs.existsSync(ROOT + 'public/images/' + rel)
}

const files: string[] = []
function walk(d: string) {
  let ents: fs.Dirent[]
  try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.json')) files.push(p)
  }
}
;["scott's tierlists", 'scott-tierlists', 'bundled-workspace'].forEach(d => walk(ROOT + d))
files.sort()

const out: string[] = []
let entryCount = 0
let missingImages = 0
let nullDex = 0
let threw = 0

for (const f of files) {
  let j: any
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { continue }
  if (!j || !j.entries || typeof j.entries !== 'object') continue
  const rel = path.relative(ROOT, f).replace(/\\/g, '/')
  const game: string = j.game ?? '<none>'
  const src: string | undefined = j.imageSource
  out.push(`## ${rel}  game=${JSON.stringify(game)} imageSource=${JSON.stringify(src ?? null)}`)
  for (const name of Object.keys(j.entries).sort()) {
    entryCount++
    let img: string
    try { img = resolvePokemonImagePath(name, src, game, false) } catch (e: any) { img = 'THROW(' + e.message + ')'; threw++ }
    let status: string
    if (img.startsWith('THROW')) status = 'THROW'
    else if (imageExists(img)) status = 'ok'
    else { status = 'MISSING'; missingImages++ }
    let dex: string
    try {
      const d = getPokemonData(game, name)
      if (d) dex = `${d.type_1}/${d.type_2} ${d.growth_rate} #${(d as any).national_dex_number}`
      else { dex = 'NULL'; nullDex++ }
    } catch (e: any) { dex = 'THROW(' + e.message + ')'; threw++ }
    out.push(`  ${name}\t${status}\t${img}\tdex=${dex}`)
  }
}

process.stdout.write(out.join('\n') + '\n')
console.error(
  `tierlists=${files.length} entries=${entryCount} missingImages=${missingImages} nullDex=${nullDex} throws=${threw}`
)

if (process.argv.includes('--audit')) {
  const referenced = new Set<string>()
  for (const n of pokemonNames) {
    const p = resolvePokemonImagePath(n, undefined, '<none>', false)
    referenced.add(p.substring(p.lastIndexOf('/') + 1))
  }
  const orphans = [...thumbs].filter(f => f.endsWith('.png') && !referenced.has(f)).sort()
  const broken = pokemonNames
    .map(n => [n, resolvePokemonImagePath(n, undefined, '<none>', false)] as const)
    .filter(([, p]) => !imageExists(p))
  console.error(`\n--- AUDIT ---`)
  console.error(`names=${pokemonNames.length} thumbnails=${thumbs.size}`)
  console.error(`names with no thumbnail (${broken.length}):`)
  broken.forEach(([n, p]) => console.error(`  ${n} -> ${p}`))
  console.error(`thumbnails not reachable from pokemonNames (${orphans.length}):`)
  orphans.forEach(f => console.error(`  ${f}`))
}
