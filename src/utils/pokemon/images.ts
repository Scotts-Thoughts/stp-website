import {
    getBaseSpeciesName,
    getFormNameForFile,
    removeAlternativeMoveType,
    sanitizePokemonFileName,
    HYPHENATED_SPECIES,
    REGIONAL_PREFIXES,
} from '../pokemon';
import { getPokemonPokedexId } from './pokedex';

/**
 * Resolves the on-disk image path for a Pokemon name.
 *
 * Extracted from PkmnImage.vue so it can be exercised by scripts/verify-pokemon-data.ts.
 *
 * @param pokemon        display name, possibly with a form and/or alternative-move suffix
 * @param imageSource    tierlist image set; undefined means the default thumbnails
 * @param game           tierlist game, only used to look up the Yellow sprite's dex number
 * @param useBaseSpecies set once a form-specific image has 404'd, to retry the base species
 */
export function resolvePokemonImagePath(
    pokemon: string,
    imageSource: string | undefined,
    game: string,
    useBaseSpecies = false,
): string {
    // Remove alternative move type suffix before processing image path
    let pokemonName = removeAlternativeMoveType(useBaseSpecies ? getBaseSpeciesName(pokemon) : pokemon);

    // Handle regional forms (space-separated, e.g., "Alolan Marowak" -> "Alolan-Marowak")
    const isRegionalForm = REGIONAL_PREFIXES.some(prefix => pokemonName.startsWith(prefix + ' '));

    if (isRegionalForm) {
        // Convert all spaces to dashes for file naming: "Alolan Marowak" -> "Alolan-Marowak"
        // Also handles "Paldean Tauros (Combat Breed)" -> "Paldean-Tauros-(Combat-Breed)"
        pokemonName = pokemonName.replace(/\s+/g, '-');
    } else if (!HYPHENATED_SPECIES.has(pokemonName)) {
        // Handle regular dash-separated forms (e.g., "Deoxys-Attack")
        // But exclude alternative move type suffixes which we already removed,
        // and species whose name legitimately contains a hyphen (e.g. "Chi-Yu")
        const dashIndex = pokemonName.indexOf('-');
        if (dashIndex !== -1) {
            const baseName = pokemonName.substring(0, dashIndex);
            const formName = pokemonName.substring(dashIndex + 1);
            const formNameForFile = getFormNameForFile(formName);
            pokemonName = `${baseName}-${formNameForFile}`;
        }
    }

    // Normalize characters that can't appear in / don't match the on-disk filenames
    // (accents like "Flabébé" -> "Flabebe", "Type: Null" -> "Type_Null").
    // Keep the un-sanitized name for the Pokedex ID lookup, which expects the real species name.
    const fileName = sanitizePokemonFileName(pokemonName);

    if (imageSource) {
        if (imageSource === 'yellow-sprites') {
            const pokedexId = getPokemonPokedexId(game, pokemonName);
            if (pokedexId) {
                return `./images/${imageSource}/${pokedexId}.png`;
            }
            // Fallback to pokemon name if Pokedex ID not found
            return `./images/${imageSource}/${fileName}.png`;
        }
        return `./images/${imageSource}/${fileName}.png`;
    }
    return `./images/pokemon_thumbnail/${fileName}.png`;
}
