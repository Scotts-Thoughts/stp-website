// global declaration for pokedex data (public/data/pokedex-data.js)
// pokedexData is loaded globally via script tag in index.html
declare const pokedexData: Record<string, Record<string, {
    type_1: string
    type_2: string
    growth_rate: string
    national_dex_number?: number
}>>;

import { getBaseSpeciesName } from '../pokemon';

// Access pokedexData from global scope (loaded via script tag)
// The script attaches pokedexData to window for ES module access
function getPokedexData() {
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

// Map tierlist game names to pokedex data keys
function mapGameNameToPokedexKey(game: string): string {
    const gameMap: Record<string, string> = {
        "Black": "Black and White and Black2 and White2",
        "White": "Black and White and Black2 and White2",
        "Black2": "Black and White and Black2 and White2",
        "White2": "Black and White and Black2 and White2",
        "FireRed": "FireRed and LeafGreen",
        "LeafGreen": "FireRed and LeafGreen",
        "Diamond": "Diamond and Pearl",
        "Pearl": "Diamond and Pearl",
        "HeartGold": "HeartGold and SoulSilver",
        "SoulSilver": "HeartGold and SoulSilver",
        "Gold": "Gold and Silver",
        "Silver": "Gold and Silver",
        "Japanese Green": "Red and Blue", // Japanese Green uses same data as Red/Blue
    };
    
    return gameMap[game] || game;
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

export function getPokemonData(game: string, pokemonName: string) {
    const pokedexData = getPokedexData();
    
    if (!pokedexData) {
        throw new Error(`pokedexData is not loaded. Make sure /data/pokedex-data.js is loaded.`);
    }
    
    // Map the tierlist game name to the pokedex data key
    const pokedexKey = mapGameNameToPokedexKey(game);
    
    if (!pokedexData[pokedexKey]) {
        throw new Error(`Game "${game}" (mapped to "${pokedexKey}") not found in pokedex data.`);
    }

    const index = gameListReleaseOrder.indexOf(pokedexKey);
    if (index === -1) {
        throw new Error(`Game "${game}" (mapped to "${pokedexKey}") not found in game list release order.`);
    }

    // Extract base species name to handle forms (e.g., "Deoxys-Attack" -> "Deoxys")
    const baseName = getBaseSpeciesName(pokemonName);

    for (let i = index; i < gameListReleaseOrder.length; i++) {
        const currentGame = gameListReleaseOrder[i];
        const currentPokedex = pokedexData[currentGame];
        if (currentPokedex && currentPokedex[baseName]) {
            return currentPokedex[baseName];
        }
    }

    return null;
}

export function getPokemonPokedexId(game: string, pokemonName: string): number | null {
    const pokemonData = getPokemonData(game, pokemonName);
    return pokemonData?.national_dex_number || null;
}