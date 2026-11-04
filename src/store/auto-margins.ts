/**
 * Fills in the spacing of Pokemon pairs that become neighbours when an entry is added to
 * the active tierlist (a new species, or a new attempt that moves one to another tier).
 *
 * Every pair that is adjacent after the change but wasn't before gets an automatic margin,
 * worked out from the two pieces of art (see utils/auto-margin.ts), unless that pair
 * already has a hand-set value. Both sides of the added Pokemon are covered, as is the
 * pair that closes up behind a Pokemon that moved away. The values are stored exactly
 * like hand-set ones, in `pokemonSettings[right].margins[left]`, so Edit View can still
 * fine-tune them.
 */
import { useTierlist, useWorkspace } from '.';
import { removeAlternativeMoveType, getBaseSpeciesName } from '../utils/pokemon';
import { resolvePokemonImagePath } from '../utils/pokemon/images';
import {
    computeAutoMargin,
    getCachedSilhouette,
    loadSilhouette,
    STANDARD_OUTLINE,
    type Placement,
    type Silhouette,
} from '../utils/auto-margin';

type Pair = { left: string, right: string };

/** Adjacency before the pending change; null when no change is pending. */
let pairsBefore: Set<string> | null = null;
let tierlistBefore = '';

const pairKey = (p: Pair) => p.left + '\u0000' + p.right;

function currentPairs(): Pair[] {
    const pairs: Pair[] = [];
    for (const group of useTierlist().groupedEntries) {
        for (const entry of group) {
            if (entry.prev) pairs.push({ left: entry.prev, right: entry.pkmnName });
        }
    }
    return pairs;
}

/**
 * Call before adding an entry to the active tierlist. The first call in a tick snapshots
 * the rows; the pairs are compared once the tick's additions are all in (so a CSV import
 * doesn't spend margins on pairs that only existed half-way through), before Vue renders.
 */
export function noteEntriesChanging() {
    // Spacing is a nicety: nothing here may stop the entry itself from being added.
    try {
        if (pairsBefore) return;
        pairsBefore = new Set(currentPairs().map(pairKey));
        tierlistBefore = useWorkspace().activeTierlist.filename;
        queueMicrotask(applyAfterChange);
    } catch (e) {
        pairsBefore = null;
        console.warn('[auto-margin] skipped:', e);
    }
}

function applyAfterChange() {
    const before = pairsBefore;
    pairsBefore = null;
    if (!before) return;
    try {
        if (useWorkspace().activeTierlist.filename !== tierlistBefore) return;
        const added = currentPairs().filter(p => !before.has(pairKey(p)) && storedMargin(p) === undefined);
        if (added.length) fillMargins(added).catch(e => console.warn('[auto-margin] skipped:', e));
    } catch (e) {
        console.warn('[auto-margin] skipped:', e);
    }
}

function storedMargin({ left, right }: Pair): number | undefined {
    return useWorkspace().pokemonSettings[removeAlternativeMoveType(right)]?.margins[left];
}

/** Image paths an entry may be drawn from: its own art, then the base species' (as PkmnImage falls back). */
function imagePaths(pkmnName: string): string[] {
    const tierlist = useTierlist();
    const displayed = tierlist.getDisplayPokemon(pkmnName);
    const { imageSource, game } = tierlist.activeTierlist;
    const paths = [resolvePokemonImagePath(displayed, imageSource, game, false)];
    if (displayed !== getBaseSpeciesName(displayed)) {
        paths.push(resolvePokemonImagePath(displayed, imageSource, game, true));
    }
    return paths;
}

function cachedSilhouetteOf(pkmnName: string): Silhouette | null | undefined {
    for (const path of imagePaths(pkmnName)) {
        const s = getCachedSilhouette(path);
        if (s === undefined) return undefined;
        if (s) return s;
    }
    return null;
}

async function loadSilhouetteOf(pkmnName: string): Promise<Silhouette | null> {
    for (const path of imagePaths(pkmnName)) {
        const s = await loadSilhouette(path);
        if (s) return s;
    }
    return null;
}

function placement(pkmnName: string, silhouette: Silhouette): Placement {
    const settings = useWorkspace().pokemonSettings[removeAlternativeMoveType(pkmnName)];
    return {
        silhouette,
        scale: settings?.scale ?? 1,
        offset: settings?.offset ?? 0,
        flip: settings?.flip ?? false,
        outline: useTierlist().activeTierlist.imageSource === 'yellow-sprites' ? 0 : STANDARD_OUTLINE,
    };
}

function store(pair: Pair, value: number) {
    const workspace = useWorkspace();
    const key = removeAlternativeMoveType(pair.right);
    const settings = workspace.pokemonSettings[key] ??= {
        scale: 1,
        saturation: 1,
        offset: 0,
        flip: false,
        margins: {},
    };
    settings.margins ??= {};
    // A value set by hand in the meantime wins.
    if (settings.margins[pair.left] === undefined) settings.margins[pair.left] = value;
}

/** The automatic margin for a pair, from silhouettes already loaded; undefined if one isn't. */
function autoMarginFromCache(pair: Pair): number | null | undefined {
    const l = cachedSilhouetteOf(pair.left), r = cachedSilhouetteOf(pair.right);
    if (l === undefined || r === undefined) return undefined;
    if (!l || !r) return null;
    return computeAutoMargin(placement(pair.left, l), placement(pair.right, r));
}

/** Works out the automatic margin for a pair from its two pieces of art. */
export async function autoMarginFor(pair: Pair): Promise<number | null> {
    const [l, r] = await Promise.all([loadSilhouetteOf(pair.left), loadSilhouetteOf(pair.right)]);
    if (!l || !r) return null;
    return computeAutoMargin(placement(pair.left, l), placement(pair.right, r));
}

async function fillMargins(pairs: Pair[]) {
    // Pairs whose art is already loaded are filled now, before the next render, so a
    // re-ranking animation reads the final margin when it measures the moved Pokemon.
    const later: Pair[] = [];
    for (const pair of pairs) {
        const value = autoMarginFromCache(pair);
        if (value === undefined) later.push(pair);
        else if (value !== null) store(pair, value);
    }
    const tierlist = useWorkspace().activeTierlist.filename;
    for (const pair of later) {
        const value = await autoMarginFor(pair);
        if (value !== null && useWorkspace().activeTierlist.filename === tierlist) store(pair, value);
    }
}

/** Loads the art of these entries ahead of time, so their margins can be filled synchronously. */
export function preloadSilhouettes(pkmnNames: Iterable<string>) {
    try {
        for (const name of pkmnNames) loadSilhouetteOf(name).catch(() => {});
    } catch (e) {
        console.warn('[auto-margin] preload skipped:', e);
    }
}
