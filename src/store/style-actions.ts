/**
 * Style commands for the selection or the whole active tierlist, shared by the context
 * menu, Edit View and keyboard shortcuts.
 *
 * pokemon.json keeps a Pokemon's scale, offset, saturation and flip once per workspace,
 * so resetting them here also changes that Pokemon on every other tierlist. Nothing is
 * written to disk until Save Workspace.
 */
import { useTierlist, useToast, useWorkspace } from '.';
import { removeAlternativeMoveType } from '../utils/pokemon';
import { applyAutoMargins, selectedPairs, wholeTierlistPairs } from './auto-margins';

const STYLE_DEFAULTS = { scale: 1, offset: 0, saturation: 1, flip: false };

export type StyleProperty = keyof typeof STYLE_DEFAULTS;

const NOT_SAVED = 'Save Workspace to keep it.';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function tierlistPokemon(): string[] {
    return [...new Set(Object.keys(useWorkspace().activeTierlist.entries).map(removeAlternativeMoveType))];
}

function resetProperties(properties: StyleProperty[]): number {
    const settings = useWorkspace().pokemonSettings;
    let changed = 0;
    for (const name of tierlistPokemon()) {
        const setting = settings[name];
        if (!setting) continue;
        let touched = false;
        for (const property of properties) {
            if (setting[property] === STYLE_DEFAULTS[property]) continue;
            (setting[property] as number | boolean) = STYLE_DEFAULTS[property];
            touched = true;
        }
        if (touched) changed++;
    }
    return changed;
}

/** Sets the margin of each selected Pokemon from the art, overwriting what was there. */
export async function autoMarginSelected() {
    const toast = useToast();
    const selected = useTierlist().selectedPkmn.size;
    if (selected === 0) {
        toast.addToast('Select a Pokemon first', 'warning', { timeout: 2000 });
        return;
    }
    const pairs = selectedPairs();
    if (pairs.length === 0) {
        toast.addToast('The first Pokemon in a row has no margin', 'warning', { timeout: 2000 });
        return;
    }
    await applyAutoMargins(pairs);
}

/** Replaces every margin of the active tierlist with the one worked out from the art. */
export async function autoMarginWholeTierlist() {
    const toast = useToast();
    const pairs = wholeTierlistPairs();
    const name = useWorkspace().activeTierlist.name;
    if (!confirm(`Replace ${plural(pairs.length, 'margin')} in "${name}" with auto margins?\n\nHand-set margins between these Pokemon are overwritten, in every category and date view.`)) return;

    const id = toast.addToast('Working out margins...', 'info', { timeout: -1, pending: true });
    const result = await applyAutoMargins(pairs);
    toast.removeToast(id);
    if (!result) return;
    const skipped = result.missingArt ? ` ${plural(result.missingArt, 'pair')} left as is (no art).` : '';
    toast.addToast(`Auto margins applied to ${plural(result.applied, 'pair')}.${skipped} ${NOT_SAVED}`, 'success', { timeout: 4000 });
}

/** Back to the defaults for every Pokemon of the active tierlist, one property at a time. */
export function resetStyleWholeTierlist(property: StyleProperty) {
    const pokemon = tierlistPokemon();
    if (!confirm(`Reset ${property} for all ${pokemon.length} Pokemon in "${useWorkspace().activeTierlist.name}"?\n\nThis setting is shared across tier lists, so these Pokemon also change on every other tier list that has them.`)) return;
    const changed = resetProperties([property]);
    useToast().addToast(`Reset ${property} on ${changed} Pokemon. ${NOT_SAVED}`, 'success', { timeout: 3000 });
}

/** Resets every style property, then re-spaces the list, since auto margins depend on them. */
export async function resetAllStyleWholeTierlist() {
    const toast = useToast();
    const pokemon = tierlistPokemon();
    if (!confirm(`Reset scale, offset, saturation, flip and margins for all ${pokemon.length} Pokemon in "${useWorkspace().activeTierlist.name}"?\n\nThese settings are shared across tier lists, so these Pokemon also change on every other tier list that has them.`)) return;

    const changed = resetProperties(Object.keys(STYLE_DEFAULTS) as StyleProperty[]);
    const id = toast.addToast('Working out margins...', 'info', { timeout: -1, pending: true });
    const result = await applyAutoMargins(wholeTierlistPairs());
    toast.removeToast(id);
    if (!result) return;
    toast.addToast(`Reset style on ${changed} Pokemon and ${plural(result.applied, 'margin')}. ${NOT_SAVED}`, 'success', { timeout: 4000 });
}
