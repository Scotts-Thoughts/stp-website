import { EVOLVES_FROM } from './evolutions';
import { getNationalDexNumber, getSpeciesGeneration } from './generations';

const dex = (name: string) => getNationalDexNumber(name) ?? Infinity;
const byDex = (a: string, b: string) => dex(a) - dex(b) || a.localeCompare(b);

/**
 * Splits species into evolutionary lines, each ordered lowest stage to highest, so the last
 * name is the stage a line's tierlist image shows. A branching family gives one line per
 * final stage ("Eevee, Vaporeon", "Eevee, Jolteon", ...), and a species that doesn't evolve
 * is a line of its own.
 *
 * Only the given species are linked: with just Gen 1 the Pikachu line is "Pikachu, Raichu",
 * and a stage that skips the range still joins its family (Gen 1 + 4 links Magnemite to
 * Magnezone). Pass plain species names (getSpeciesRootName); forms aren't part of a line.
 */
export function getEvolutionLines(species: Iterable<string>): string[][] {
    const set = new Set(species);

    /** The nearest pre-evolution that's in the set. */
    const parentOf = (name: string) => {
        for (let from = EVOLVES_FROM[name]; from; from = EVOLVES_FROM[from]) {
            if (set.has(from)) return from;
        }
        return undefined;
    };

    const children = new Map<string, string[]>();
    const roots: string[] = [];
    for (const name of set) {
        const parent = parentOf(name);
        if (!parent) roots.push(name);
        else if (children.has(parent)) children.get(parent)!.push(name);
        else children.set(parent, [name]);
    }

    const lines: string[][] = [];
    const walk = (path: string[]) => {
        const next = children.get(path[path.length - 1]);
        if (!next) lines.push(path);
        else for (const child of next.sort(byDex)) walk([...path, child]);
    };
    for (const root of roots) walk([root]);
    // A line sits where its newest member was introduced: "Munchlax, Snorlax" with Munchlax
    // in Gen 4, "Rhyhorn, Rhydon, Rhyperior" with Rhyperior.
    return lines.sort((a, b) => byDex(lineNewest(a), lineNewest(b)) || byDex(lineFinal(a), lineFinal(b)));
}

/** The most recently introduced member of a line (highest national dex number). */
export function lineNewest(line: string[]): string {
    return line.reduce((newest, name) => byDex(name, newest) > 0 ? name : newest);
}

/** The generation a line belongs to: that of its most recently introduced member. */
export function lineGeneration(line: string[]): string | null {
    return getSpeciesGeneration(lineNewest(line));
}

/** The highest stage of a line: the species its tierlist entry shows by default. */
export function lineFinal(line: string[]): string {
    return line[line.length - 1];
}
