/**
 * Every keyboard-assignable action in the app, and the keys the user has given them.
 *
 * Actions are identified by a stable id, so a binding survives a label change. Keys are
 * kept as canonical strings ("Ctrl+Shift+K", "Space", "F1"); "" means unassigned.
 * Only differences from the defaults are stored, so a changed default still reaches
 * anyone who hasn't touched that action.
 */
import { ref } from 'vue';
import { defineStore } from 'pinia';

/** Where an action can fire. Two actions only clash when they share a scope. */
export type ShortcutScope = 'main' | 'timeline' | 'edit-view';

export type ShortcutAction = {
    id: string
    label: string
    group: string
    default: string
    scopes: ShortcutScope[]
};

const MAIN: ShortcutScope[] = ['main'];
const TIMELINE: ShortcutScope[] = ['timeline'];
const EVERYWHERE: ShortcutScope[] = ['main', 'timeline'];
const EDIT_VIEW: ShortcutScope[] = ['edit-view'];
/** Style actions run from the tier list and also while Edit View is open. */
const STYLE: ShortcutScope[] = ['main', 'edit-view'];

function actions(group: string, scopes: ShortcutScope[], list: [id: string, label: string, key?: string][]): ShortcutAction[] {
    return list.map(([id, label, key = '']) => ({ id, label, group, default: key, scopes }));
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
    ...actions('Windows', MAIN, [
        ['import-csv', 'Import CSV', 'V'],
        ['insert-metrics', 'Insert Metrics', 'X'],
        ['edit-metrics', 'Edit Metrics', 'Z'],
        ['edit-view', 'Edit View', 'C'],
        ['edit-filter', 'Edit Filter', 'F'],
        ['thresholds', 'Thresholds', 'G'],
        ['assign-species', 'Assign Species', 'S'],
        ['quick-date', 'Quick Date Filter', 'Q'],
        ['states', 'States', 'A'],
        ['shortcuts', 'Keyboard Shortcuts'],
    ]),
    ...actions('Windows', EVERYWHERE, [
        ['search', 'Search', 'Space'],
    ]),
    ...actions('View', MAIN, [
        ['toggle-category', 'Toggle Category', 'D'],
        ['toggle-table', 'Show/Hide Table', 'T'],
        ['toggle-popout', 'Show/Hide Popout', 'R'],
        ['toggle-box-art', 'Show/Hide Box Art'],
        ['hide-selected', 'Hide Selected', 'H'],
        ['set-current-date', 'Set to Current Date', 'W'],
        ['set-max-date', 'Set to Max Date', 'E'],
        ['cycle-credits', 'Cycle Credits', 'Ctrl+Q'],
    ]),
    ...actions('View', EVERYWHERE, [
        ['toggle-timeline', 'Show/Hide Timeline', 'N'],
    ]),
    ...actions('Style', STYLE, [
        ['auto-margin', 'Auto Margin: Selected'],
        ['auto-margin-all', 'Auto Margin: Whole Tier List'],
        ['reset-scale', 'Reset Scale: Whole Tier List'],
        ['reset-offset', 'Reset Offset: Whole Tier List'],
        ['reset-saturation', 'Reset Saturation: Whole Tier List'],
        ['reset-flip', 'Reset Flip: Whole Tier List'],
        ['reset-all-style', 'Reset All Style: Whole Tier List'],
    ]),
    ...actions('Edit View (while open)', EDIT_VIEW, [
        ['scale-inc', 'Scale Up', 'D'],
        ['scale-dec', 'Scale Down', 'A'],
        ['offset-inc', 'Offset Up', 'W'],
        ['offset-dec', 'Offset Down', 'S'],
        ['saturation-inc', 'Saturation Up', 'E'],
        ['saturation-dec', 'Saturation Down', 'Q'],
        ['margin-inc', 'Margin Up', 'G'],
        ['margin-dec', 'Margin Down', 'F'],
        ['flip-inc', 'Flip On', 'H'],
        ['flip-dec', 'Flip Off', 'J'],
    ]),
    ...actions('Workspace', MAIN, [
        ['save-workspace', 'Save Workspace', 'Ctrl+S'],
        ['reload-workspace', 'Reload Workspace', 'Ctrl+R'],
        ['close-tierlist', 'Close Tierlist', 'Alt+W'],
        ['capture-state', 'Capture State', 'B'],
    ]),
    ...actions('Export', EVERYWHERE, [
        ['export-png', 'Export as PNG', 'Ctrl+E'],
        ['animate-reranking', 'Animate Re-Ranking On/Off'],
        ['play-reranking', 'Play Re-Ranking Animation', 'Ctrl+F1'],
    ]),
    ...actions('Export', MAIN, [
        ['export-rerank-video', 'Export Re-Ranking as Video'],
        ['export-change-animation', 'Export Change Animation'],
    ]),
    ...actions('Timeline', TIMELINE, [
        ['timeline-snapshot', 'Snapshot'],
        ['timeline-camera', 'Automate Camera'],
        ['timeline-play', 'Play / Stop Playback', 'P'],
        ['timeline-export', 'Export Sequence as .mov'],
    ]),
];

const ACTIONS_BY_ID = new Map(SHORTCUT_ACTIONS.map(a => [a.id, a]));

function keyName(e: KeyboardEvent): string {
    if (['Control', 'Shift', 'Alt', 'Meta', 'Dead', 'Process', 'Unidentified'].includes(e.key)) return '';
    // The digit row: with Shift held e.key would be "!" and so on.
    if (e.code.startsWith('Digit')) return e.code.slice('Digit'.length);
    if (e.key === ' ') return 'Space';
    return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

/** The canonical string of a key press; "" if it's only modifiers. */
export function eventToShortcut(e: KeyboardEvent): string {
    const key = keyName(e);
    if (!key || e.metaKey) return '';
    return `${e.ctrlKey ? 'Ctrl+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.altKey ? 'Alt+' : ''}${key}`;
}

/** True while focus is somewhere a keystroke is text, not a command. */
export function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
    return target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(target.type);
}

export const useShortcuts = defineStore('shortcuts', () => {
    /** Differences from the defaults: action id -> key, "" for one the user unassigned. */
    const overrides = ref<Record<string, string>>({});
    /** True while the Shortcuts window waits for a key, so the key doesn't also run something. */
    const recording = ref(false);

    function bindingOf(id: string): string {
        return overrides.value[id] ?? ACTIONS_BY_ID.get(id)?.default ?? '';
    }

    /**
     * Whether this key press is the action's key. With `shiftIsFine`, Shift may be held on
     * top of a key that doesn't include it (Edit View's fine adjustment).
     */
    function matches(id: string, e: KeyboardEvent, { shiftIsFine = false } = {}): boolean {
        if (recording.value) return false;
        const binding = bindingOf(id);
        if (!binding) return false;
        const pressed = eventToShortcut(e);
        return pressed === binding || (shiftIsFine && e.shiftKey && pressed.replace('Shift+', '') === binding);
    }

    function setBinding(id: string, key: string) {
        if (key === (ACTIONS_BY_ID.get(id)?.default ?? '')) delete overrides.value[id];
        else overrides.value[id] = key;
    }

    /** Gives an action a key, taking it from any action it would clash with. Returns those. */
    function assign(id: string, key: string): ShortcutAction[] {
        const scopes = ACTIONS_BY_ID.get(id)?.scopes ?? [];
        const taken = SHORTCUT_ACTIONS.filter(a =>
            a.id !== id && bindingOf(a.id) === key && a.scopes.some(s => scopes.includes(s)));
        for (const action of taken) setBinding(action.id, '');
        setBinding(id, key);
        return taken;
    }

    function clear(id: string) {
        setBinding(id, '');
    }

    function restoreDefault(id: string): ShortcutAction[] {
        return assign(id, ACTIONS_BY_ID.get(id)?.default ?? '');
    }

    function restoreAllDefaults() {
        overrides.value = {};
    }

    return { overrides, recording, bindingOf, matches, assign, clear, restoreDefault, restoreAllDefaults };
}, {
    persist: 'temp',
    exclude: ['recording'],
});
