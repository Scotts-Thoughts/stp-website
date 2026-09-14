import { ref } from 'vue';
import { getBaseSpeciesName } from '../pokemon';

/**
 * One entry of a per-game pokedex file. The data carries far more (base stats, learnsets,
 * abilities, evolution family, ...) — see public/data/pokedex/ — but this is all the app
 * reads today. Widen the type as features start using more of it.
 */
export type PokedexEntry = {
    species: string
    type_1: string
    type_2: string
    growth_rate: string
    national_dex_number?: number
}

type PokedexSection = Record<string, PokedexEntry>;

/**
 * Data lives in public/data/pokedex/<file>.js, one classic script per game that assigns
 * `window.pokedexData[<key>]`. The files are generated from the Solodex dataset by
 * scripts/sync-pokedex-data.ts (`npm run sync-pokedex`); never edit them by hand.
 *
 * Keys are the Solodex game names. Order is release order: getPokemonData walks forward
 * through it when a species is missing from a game, and the Mega Evolution dex comes last
 * so every game can fall through to it.
 */
export const POKEDEX_FILES: Record<string, string> = {
    "Red and Blue": "red_blue",
    "Yellow": "yellow",
    "Gold and Silver": "gold_silver",
    "Crystal": "crystal",
    "Ruby and Sapphire": "ruby_sapphire",
    "Emerald": "emerald",
    "FireRed and LeafGreen": "firered_leafgreen",
    "Diamond and Pearl": "diamond_pearl",
    "Platinum": "platinum",
    "HeartGold and SoulSilver": "heartgold_soulsilver",
    "Black and White": "black_white",
    "Black 2 and White 2": "black2_white2",
    "X and Y": "x_y",
    "Omega Ruby and Alpha Sapphire": "omega_ruby_alpha_sapphire",
    "Sun and Moon": "sun_moon",
    "Ultra Sun and Ultra Moon": "ultra_sun_ultra_moon",
    "Sword and Shield": "sword_shield",
    "Brilliant Diamond and Shining Pearl": "brilliant_diamond_shining_pearl",
    "Legends Arceus": "legends_arceus",
    "Scarlet and Violet": "scarlet_violet",
    "Legends Z-A": "legends_za",
    "Mega Evolutions": "mega_evolution_pokedex",
};

const gameListReleaseOrder = Object.keys(POKEDEX_FILES);

/** Where the per-game scripts register themselves. Scripts (verify, sync) set window = globalThis. */
function getPokedexData(): Record<string, PokedexSection> | undefined {
    const g = globalThis as any;
    return (typeof window !== 'undefined' && (window as any).pokedexData) || g.pokedexData;
}

/**
 * Bumped every time a section finishes loading. getPokemonData / hasPokedexData read it, so
 * any Vue computed that called them re-evaluates once the data it asked for has arrived.
 */
const pokedexVersion = ref(0);
const sectionLoads = new Map<string, Promise<void>>();

/**
 * Loads one game's pokedex file on demand by injecting a <script> tag — that works from the
 * dev server, a plain web build and Electron's file:// pages alike (module imports and
 * fetch() do not). Resolves once the section is registered (or has failed; a failure is
 * logged and not retried). No-op outside a browser, where scripts preload the files via eval.
 */
export function loadPokedexSection(key: string): Promise<void> {
    const file = POKEDEX_FILES[key];
    if (!file || getPokedexData()?.[key]) return Promise.resolve();
    let pending = sectionLoads.get(key);
    if (pending) return pending;
    if (typeof document === 'undefined') return Promise.resolve();
    pending = new Promise<void>(resolve => {
        const script = document.createElement('script');
        script.src = `./data/pokedex/${file}.js`;
        script.async = true;
        script.onload = () => { pokedexVersion.value++; resolve(); };
        script.onerror = () => { console.error(`Failed to load pokedex data for "${key}" (${script.src})`); resolve(); };
        document.head.appendChild(script);
    });
    sectionLoads.set(key, pending);
    return pending;
}

/** Kicks off loading the data a tierlist for this game needs, so filters don't flicker later. */
export function preloadPokedex(game: string): void {
    const key = mapGameNameToPokedexKey(game);
    if (key) void loadPokedexSection(key);
}

/**
 * Maps a tierlist game name to its POKEDEX_FILES key.
 *
 * Every entry of TIERLIST_GAMES must appear here, plus the alternate spellings that
 * already exist in saved tierlists ("Japanese Green", "Black2", "Red and Blue", ...).
 * Games with no data (Let's Go and the romhacks) are deliberately absent — getPokemonData
 * returns null for those rather than throwing.
 */
const GAME_TO_POKEDEX_KEY: Record<string, string> = {
    // Gen 1
    "Red": "Red and Blue",
    "Blue": "Red and Blue",
    "Red and Blue": "Red and Blue",
    "Green (Jpn)": "Red and Blue",
    "Japanese Green": "Red and Blue",
    "Green": "Red and Blue",
    "Yellow": "Yellow",
    // Gen 2
    "Gold": "Gold and Silver",
    "Silver": "Gold and Silver",
    "Gold and Silver": "Gold and Silver",
    "Crystal": "Crystal",
    // Gen 3
    "Ruby": "Ruby and Sapphire",
    "Sapphire": "Ruby and Sapphire",
    "Ruby and Sapphire": "Ruby and Sapphire",
    "Emerald": "Emerald",
    "FireRed": "FireRed and LeafGreen",
    "LeafGreen": "FireRed and LeafGreen",
    "FireRed and LeafGreen": "FireRed and LeafGreen",
    // Gen 4
    "Diamond": "Diamond and Pearl",
    "Pearl": "Diamond and Pearl",
    "Diamond and Pearl": "Diamond and Pearl",
    "Platinum": "Platinum",
    "HeartGold": "HeartGold and SoulSilver",
    "SoulSilver": "HeartGold and SoulSilver",
    "HeartGold and SoulSilver": "HeartGold and SoulSilver",
    // Gen 5
    "Black": "Black and White",
    "White": "Black and White",
    "Black and White": "Black and White",
    "Black 2": "Black 2 and White 2",
    "White 2": "Black 2 and White 2",
    "Black2": "Black 2 and White 2",
    "White2": "Black 2 and White 2",
    "Black 2 and White 2": "Black 2 and White 2",
    "Black and White and Black2 and White2": "Black 2 and White 2", // key of the retired combined file
    // Gen 6
    "X": "X and Y",
    "Y": "X and Y",
    "X and Y": "X and Y",
    "Omega Ruby": "Omega Ruby and Alpha Sapphire",
    "Alpha Sapphire": "Omega Ruby and Alpha Sapphire",
    "Omega Ruby and Alpha Sapphire": "Omega Ruby and Alpha Sapphire",
    // Gen 7
    "Sun": "Sun and Moon",
    "Moon": "Sun and Moon",
    "Sun and Moon": "Sun and Moon",
    "Ultra Sun": "Ultra Sun and Ultra Moon",
    "Ultra Moon": "Ultra Sun and Ultra Moon",
    "Ultra Sun and Ultra Moon": "Ultra Sun and Ultra Moon",
    // Gen 8
    "Sword": "Sword and Shield",
    "Shield": "Sword and Shield",
    "Sword and Shield": "Sword and Shield",
    "Brilliant Diamond": "Brilliant Diamond and Shining Pearl",
    "Shining Pearl": "Brilliant Diamond and Shining Pearl",
    "Brilliant Diamond and Shining Pearl": "Brilliant Diamond and Shining Pearl",
    "Legends Arceus": "Legends Arceus",
    "Legends: Arceus": "Legends Arceus",
    // Gen 9
    "Scarlet": "Scarlet and Violet",
    "Violet": "Scarlet and Violet",
    "Scarlett": "Scarlet and Violet", // tierlists saved before the spelling was corrected
    "Scarlet and Violet": "Scarlet and Violet",
    "Legends Z-A": "Legends Z-A",
    "Legends: Z-A": "Legends Z-A",
};

function mapGameNameToPokedexKey(game: string): string | undefined {
    return GAME_TO_POKEDEX_KEY[game];
}

/**
 * True once this game's pokedex section is loaded. A known-but-unloaded game starts
 * loading and reports false for now; callers that gate a filter on this let everything
 * through until the reactive re-run, which is preferable to an empty tierlist.
 */
export function hasPokedexData(game: string): boolean {
    void pokedexVersion.value;
    const key = mapGameNameToPokedexKey(game);
    if (!key) return false;
    if (getPokedexData()?.[key]) return true;
    void loadPokedexSection(key);
    return false;
}

/**
 * Collapses a species name to a comparison key, so the many spellings the app and the
 * data files use for the same Pokemon all meet in the middle:
 *
 *   "PorygonZ"        / "Porygon-Z"            -> "porygonz"
 *   "MimeJr"          / "Mime Jr."             -> "mimejr"
 *   "Nidoran_F"       / "Nidoran♀"             -> "nidoranf"
 *   "Ho-oh"           / "Ho-Oh"                -> "hooh"
 *   "Deoxys-Attack"   / "Deoxys (Attack)"      -> "deoxysattack"
 *   "Farfetch'd"      / "Farfetch’d"           -> "farfetchd"
 *   "Type: Null"      / "Type_Null"            -> "typenull"
 *   "Flabébé"                                  -> "flabebe"
 *
 * The gender symbols must map to letters before punctuation is stripped, otherwise
 * "Nidoran♀" and "Nidoran♂" would collide.
 */
function normalizeSpeciesKey(name: string): string {
    return name
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/♀/g, 'f')   // ♀
        .replace(/♂/g, 'm')   // ♂
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/**
 * Words the data files drop from form names but the display names keep, e.g. the dex
 * stores "Darmanitan (Zen)" and "Basculin (Blue)" for what the app calls
 * "Darmanitan-Zen Mode" and "Basculin-Blue Striped". Stripped as whole words only, so
 * a species name that merely contains the letters is never damaged.
 */
const FORM_FILLER_WORDS = new Set([
    'mode', 'form', 'forme', 'striped', 'cloak', 'sea', 'belly', 'style',
    'rider',  // "Calyrex-Ice Rider"    -> "Calyrex (Ice)"
    'face',   // "Eiscue-Noice Face"    -> "Eiscue (Noice)"
    'mane',   // "Necrozma-Dusk Mane"   -> "Necrozma (Dusk)"
    'wings',  // "Necrozma-Dawn Wings"  -> "Necrozma (Dawn)"
]);

/**
 * Display names whose data key cannot be reached by normalizing alone, because the
 * data files order or spell the form differently. Checked before any normalized match.
 */
const DATA_KEY_ALIASES: Record<string, string> = {
    'Mega Absol Z': 'Absol (Mega Z)',
    'Mega Garchomp Z': 'Garchomp (Mega Z)',
    'Mega Lucario Z': 'Lucario (Mega Z)',
    'Galarian Darmanitan': 'Darmanitan (Galar Standard)',
    'Galarian Darmanitan-Zen Mode': 'Darmanitan (Galar Zen)',
    'Paldean Tauros (Combat Breed)': 'Tauros (Paldea Combat Breed)',
    'Paldean Tauros (Blaze Breed)': 'Tauros (Paldea Blaze Breed)',
    'Paldean Tauros (Aqua Breed)': 'Tauros (Paldea Aqua Breed)',
    'Minior-Core': 'Minior (Red)',  // every Core colour shares one stat line
};

/** normalizeSpeciesKey, with filler form-words removed, or '' when nothing was dropped. */
function normalizeSpeciesKeyLoose(name: string): string {
    const words = name
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/♀/g, ' f ')
        .replace(/♂/g, ' m ')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
    const kept = words.filter(w => !FORM_FILLER_WORDS.has(w));
    if (kept.length === words.length || kept.length === 0) return '';
    return kept.join('');
}

/** Lazily built, per game section: normalized species key -> real key in the data. */
const normalizedIndexCache = new Map<string, Map<string, string>>();

function getNormalizedIndex(gameKey: string, section: Record<string, PokedexEntry>): Map<string, string> {
    let index = normalizedIndexCache.get(gameKey);
    if (!index) {
        index = new Map();
        // Exact normalized keys first, so a loose alias can never shadow a real match.
        for (const key of Object.keys(section)) {
            const norm = normalizeSpeciesKey(key);
            if (!index.has(norm)) index.set(norm, key);
        }
        for (const key of Object.keys(section)) {
            const loose = normalizeSpeciesKeyLoose(key);
            if (loose && !index.has(loose)) index.set(loose, key);
        }
        normalizedIndexCache.set(gameKey, index);
    }
    return index;
}

/**
 * Looks up a Pokemon's data for a game, falling forward through later generations when
 * the species did not exist yet in that game's data.
 *
 * Returns null when the species cannot be found, when the game has no pokedex data at
 * all (Let's Go, romhacks), or while a section it needs is still loading — in that case
 * the load is started and the reactive version bump re-runs the calling computed later.
 * It never throws — callers run inside Vue computeds, where a throw takes the whole view
 * down.
 */
export function getPokemonData(game: string, pokemonName: string): PokedexEntry | null {
    void pokedexVersion.value;
    const pokedexKey = mapGameNameToPokedexKey(game);
    if (!pokedexKey) return null;

    const index = gameListReleaseOrder.indexOf(pokedexKey);
    if (index === -1) return null;

    // Try the full name first so a form ("Deoxys-Attack") beats the base species, then
    // fall back to the base species for forms the data does not break out. An aliased
    // data key goes ahead of both, and the base of a regional form is aliased too.
    const baseName = getBaseSpeciesName(pokemonName);
    const lookupNames: string[] = [];
    for (const name of baseName === pokemonName ? [pokemonName] : [pokemonName, baseName]) {
        const alias = DATA_KEY_ALIASES[name];
        if (alias) lookupNames.push(alias);
        lookupNames.push(name);
    }

    // Exhaust each name across every game before trying the next, so a form that this
    // game's data lacks ("Shaymin-Sky" in Diamond) still finds "Shaymin (Sky)" in Platinum
    // instead of stopping at the plain "Shaymin" entry.
    for (const name of lookupNames) {
        for (let i = index; i < gameListReleaseOrder.length; i++) {
            const currentGame = gameListReleaseOrder[i];
            const currentPokedex = getPokedexData()?.[currentGame];
            if (!currentPokedex) {
                // Not loaded yet: start it and give up for now rather than skipping ahead to
                // a later game, which could hand back a different generation's stats.
                void loadPokedexSection(currentGame);
                return null;
            }
            const entry = currentPokedex[name];
            if (entry) return entry;
            const normalized = getNormalizedIndex(currentGame, currentPokedex);
            const key = normalized.get(normalizeSpeciesKey(name));
            if (key) return currentPokedex[key];
            const loose = normalizeSpeciesKeyLoose(name);
            if (loose) {
                const looseKey = normalized.get(loose);
                if (looseKey) return currentPokedex[looseKey];
            }
        }
    }

    return null;
}

export function getPokemonPokedexId(game: string, pokemonName: string): number | null {
    const pokemonData = getPokemonData(game, pokemonName);
    return pokemonData?.national_dex_number || null;
}
