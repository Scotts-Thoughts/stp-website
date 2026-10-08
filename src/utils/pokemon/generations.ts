import { getSpeciesRootName } from '../pokemon';
import { NATIONAL_DEX } from './national-dex';

export const generations = [
    "Gen 1",
    "Gen 2",
    "Gen 3",
    "Gen 4",
    "Gen 5",
    "Gen 6",
    "Gen 7",
    "Gen 8",
    "Gen 9",
];

/** Last national dex number introduced in each generation, in order. */
const GENERATION_LAST_DEX_NUMBER = [151, 251, 386, 493, 649, 721, 809, 905, 1025];

/**
 * The generation a species was introduced in, by its national dex number. Forms share
 * their base species' number, so an Alolan Rattata or a Mega counts as Gen 1.
 */
export function getGenerationFromDexNumber(dexNumber: number): string | null {
    const index = GENERATION_LAST_DEX_NUMBER.findIndex(last => dexNumber <= last);
    return index === -1 ? null : generations[index];
}

/** Spelling-insensitive key, so "Porygon-Z" finds "PorygonZ" and "Farfetch’d" finds "Farfetch'd". */
const looseKey = (name: string) =>
    name.normalize('NFD').replace(/♀/g, 'f').replace(/♂/g, 'm').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
let looseIndex: Map<string, number> | undefined;

/** National dex number of any species, form, Mega or alternative-move name; null if unknown. */
export function getNationalDexNumber(pokemonName: string): number | null {
    const root = getSpeciesRootName(pokemonName);
    const exact = NATIONAL_DEX[root];
    if (exact !== undefined) return exact;
    looseIndex ??= new Map(Object.entries(NATIONAL_DEX).map(([name, num]) => [looseKey(name), num]));
    return looseIndex.get(looseKey(root)) ?? null;
}

/** The generation ("Gen 1" ...) a name's species was introduced in; null if unknown. Needs no pokedex data. */
export function getSpeciesGeneration(pokemonName: string): string | null {
    const dexNumber = getNationalDexNumber(pokemonName);
    return dexNumber === null ? null : getGenerationFromDexNumber(dexNumber);
}
