// global declaration for pokedex data (public/data/pokedex-data.js)
declare const pokedexData: Record<string, Record<string, {
    type_1: string
    type_2: string
    growth_rate: string
    national_dex_number?: number
}>>;

import { getBaseSpeciesName } from '../pokemon';

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
    // "Black and White",
];

export function getPokemonData(game: string, pokemonName: string) {
    if (!pokedexData[game]) {
        throw new Error(`Game "${game}" not found in pokedex data.`);
    }

    const index = gameListReleaseOrder.indexOf(game);
    if (index === -1) {
        throw new Error(`Game "${game}" not found in game list release order.`);
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