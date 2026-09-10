// global declaration for pokedex data (public/data/pokedex-data.js)
// pokedexData is loaded globally via script tag in index.html
declare const pokedexData: Record<string, Record<string, {
    type_1: string
    type_2: string
    growth_rate: string
    national_dex_number?: number
}>>;

type PokedexEntry = {
    type_1: string
    type_2: string
    growth_rate: string
    national_dex_number?: number
}

import { getBaseSpeciesName } from '../pokemon';

// Access pokedexData from global scope (loaded via script tag)
// The script attaches pokedexData to window for ES module access
function getPokedexData(): Record<string, Record<string, PokedexEntry>> | undefined {
    // Try accessing via window first (script attaches it there)
    if (typeof window !== 'undefined' && (window as any).pokedexData) {
        return (window as any).pokedexData;
    }
    // Fallback: try accessing via globalThis
    if (typeof globalThis !== 'undefined' && (globalThis as any).pokedexData) {
        return (globalThis as any).pokedexData;
    }
    // Last resort: try direct access (may work in some contexts)
    try {
        // @ts-ignore - pokedexData is declared globally via script tag
        if (typeof pokedexData !== 'undefined') {
            // @ts-ignore
            return pokedexData;
        }
    } catch (e) {
        // Not accessible directly
    }
    return undefined;
}

/**
 * Maps a tierlist game name to the key it is stored under in pokedex-data.js.
 *
 * Every entry of TIERLIST_GAMES must appear here, plus the alternate spellings that
 * already exist in saved tierlists ("Japanese Green", "Black2", "Red and Blue", ...).
 * Games with no data in pokedex-data.js (Gen 6 onwards, the remakes and the romhacks)
 * are deliberately absent — getPokemonData returns null for those rather than throwing.
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
    // Gen 5 — one shared dex for BW and B2W2
    "Black": "Black and White and Black2 and White2",
    "White": "Black and White and Black2 and White2",
    "Black 2": "Black and White and Black2 and White2",
    "White 2": "Black and White and Black2 and White2",
    "Black2": "Black and White and Black2 and White2",
    "White2": "Black and White and Black2 and White2",
    "Black and White and Black2 and White2": "Black and White and Black2 and White2",
};

function mapGameNameToPokedexKey(game: string): string | undefined {
    return GAME_TO_POKEDEX_KEY[game];
}

/** True when pokedex-data.js has a section for this game at all. */
export function hasPokedexData(game: string): boolean {
    const key = mapGameNameToPokedexKey(game);
    if (!key) return false;
    const data = getPokedexData();
    return !!data && !!data[key];
}

const gameListReleaseOrder = [
    "Red and Blue",
    "Yellow",
    "Gold and Silver",
    "Crystal",
    "Ruby and Sapphire",
    "Emerald",
    "FireRed and LeafGreen",
    "Diamond and Pearl",
    "Platinum",
    "HeartGold and SoulSilver",
    "Black and White and Black2 and White2",
];

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
const FORM_FILLER_WORDS = new Set(['mode', 'form', 'forme', 'striped', 'cloak', 'sea', 'belly', 'style']);

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
 * Returns null when the species cannot be found, or when the game has no pokedex data
 * at all (Gen 6 onwards). It never throws — callers run inside Vue computeds, where a
 * throw takes the whole view down.
 */
export function getPokemonData(game: string, pokemonName: string): PokedexEntry | null {
    const data = getPokedexData();
    if (!data) return null;

    const pokedexKey = mapGameNameToPokedexKey(game);
    if (!pokedexKey || !data[pokedexKey]) return null;

    const index = gameListReleaseOrder.indexOf(pokedexKey);
    if (index === -1) return null;

    // Try the full name first so a form ("Deoxys-Attack") beats the base species, then
    // fall back to the base species for forms the data does not break out.
    const baseName = getBaseSpeciesName(pokemonName);
    const lookupNames = baseName === pokemonName ? [pokemonName] : [pokemonName, baseName];

    for (let i = index; i < gameListReleaseOrder.length; i++) {
        const currentGame = gameListReleaseOrder[i];
        const currentPokedex = data[currentGame];
        if (!currentPokedex) continue;
        const normalized = getNormalizedIndex(currentGame, currentPokedex);

        // Resolve the full name (form included) completely before falling back to the base
        // species, otherwise "Rotom-Heat" would match the plain "Rotom" entry and never
        // reach "Rotom (Heat)".
        for (const name of lookupNames) {
            const entry = currentPokedex[name];
            if (entry) return entry;
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
