<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useTierlist } from '../store';
import { resolvePokemonImagePath } from '../utils/pokemon/images';
import { hasAlternativeMoveType } from '../utils/pokemon';
import { formatDate, parseDate } from '../utils/time';

/** Roster units ("Ranked" counts one per line, one per species outside a line) with no ranked entry yet. */
const props = defineProps<{
    units: string[];
    /** Units ranked on the graphic that aren't among the assigned species, with the entry that put each there. */
    unassigned: { unit: string; pkmnName: string }[];
}>();

const emit = defineEmits<{
    close: [];
}>();

const tierlist = useTierlist();

type Row = { unit: string; line: string[] | undefined; image: string; reason?: string };

/** Entries that would count toward Ranked if they were on the graphic (same rule as TierList). */
function counts(pkmnName: string): boolean {
    const tags = tierlist.activeTierlist.entries[pkmnName]?.tags ?? [];
    return !tags.includes('untracked') && !hasAlternativeMoveType(pkmnName);
}

/** Why an entry in the current view is filtered off the graphic, or undefined if it isn't. */
function hiddenReason(pkmnName: string): string | undefined {
    if (tierlist.restrictSpecies && !tierlist.restrictSpecies.has(pkmnName)) return 'Not in this State';
    if (tierlist.excludePokemonList.includes(pkmnName)) return 'Hidden';
    const tags = tierlist.activeTierlist.entries[pkmnName]?.tags ?? [];
    if (tierlist.excludeTagsList.some(tag => tags.includes(tag))) return 'Excluded by a tag filter';
    if (tierlist.includeTagsList.length && tierlist.includeTagsList.every(tag => !tags.includes(tag))) return 'Excluded by a tag filter';
    return undefined;
}

// Units each run list touches, keyed to the first entry that put them there.
function unitsOf(rows: { pkmnName: string }[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const { pkmnName } of rows) {
        if (!counts(pkmnName)) continue;
        const unit = tierlist.getRosterUnit(pkmnName);
        if (!map.has(unit)) map.set(unit, pkmnName);
    }
    return map;
}

/**
 * When an entry's stored runs first put it in this view: its first run (First), its second
 * run (Followup, which needs two) or its earliest run (Most Recent). undefined if it never will.
 */
function rankableFrom(pkmnName: string): number | undefined {
    const dates = (tierlist.activeTierlist.entries[pkmnName]?.attempts ?? []).map(a => a.releasedate);
    if (tierlist.activeCategory === 'first') return dates[0];
    dates.sort((a, b) => a - b);
    return tierlist.activeCategory === 'best' ? dates[1] : dates[0];
}

/** Units with stored runs that only reach this view after the display date, and the earliest such date. */
function futureUnits(): Map<string, number> {
    const cutoff = parseDate(tierlist.releaseDateTreshold);
    const map = new Map<string, number>();
    for (const pkmnName of Object.keys(tierlist.activeTierlist.entries)) {
        if (!counts(pkmnName)) continue;
        const date = rankableFrom(pkmnName);
        if (date === undefined || date <= cutoff) continue;
        const unit = tierlist.getRosterUnit(pkmnName);
        map.set(unit, Math.min(map.get(unit) ?? Infinity, date));
    }
    return map;
}

/** Shown only in the Followup / Most Recent views, where a single run doesn't rank. */
const showFirstComplete = computed(() => tierlist.activeCategory !== 'first');

const sections = computed(() => {
    // In this view but filtered off the graphic: the hidden ones.
    const inView = new Map<string, string>();
    for (const [unit, pkmnName] of unitsOf(tierlist.activeAttempts)) {
        if (hiddenReason(pkmnName)) inView.set(unit, pkmnName);
    }
    const future = futureUnits();
    const firstRun = showFirstComplete.value ? unitsOf(tierlist.firstAttempts) : new Map<string, string>();

    const hidden: Row[] = [], releasing: Row[] = [], firstComplete: Row[] = [], unranked: Row[] = [];
    for (const unit of props.units) {
        const row: Row = {
            unit,
            line: tierlist.getEntryLine(unit),
            image: resolvePokemonImagePath(unit, undefined, tierlist.activeTierlist.game),
        };
        const hiddenEntry = inView.get(unit);
        if (hiddenEntry) {
            row.reason = hiddenReason(hiddenEntry) + (hiddenEntry !== unit ? ` (${hiddenEntry})` : '');
            hidden.push(row);
        } else if (future.has(unit)) {
            row.reason = `Releases ${formatDate(future.get(unit)!)}`;
            releasing.push(row);
        } else if (firstRun.has(unit)) {
            firstComplete.push(row);
        } else {
            unranked.push(row);
        }
    }
    // Soonest release first.
    releasing.sort((a, b) => future.get(a.unit)! - future.get(b.unit)!);
    const unassigned: Row[] = props.unassigned.map(({ unit, pkmnName }) => ({
        unit,
        line: tierlist.getEntryLine(unit),
        image: resolvePokemonImagePath(unit, undefined, tierlist.activeTierlist.game),
        reason: pkmnName !== unit ? `Ranked as ${pkmnName}` : undefined,
    }));
    const unassignedSection = {
        key: 'unassigned', title: 'Not assigned',
        note: 'On the graphic, but not among the assigned species, so it doesn\'t count toward Ranked.',
        rows: unassigned,
    };
    // With every assigned species ranked, only the unassigned section has anything to show.
    if (!total.value) return unassigned.length ? [unassignedSection] : [];
    return [
        { key: 'future', title: 'Releasing in the future', note: 'Has results stored, but they release after the display date.', rows: releasing },
        ...(showFirstComplete.value ? [{ key: 'first', title: 'First playthrough complete', note: 'Has a first run, but this view needs a followup to rank it.', rows: firstComplete }] : []),
        { key: 'hidden', title: 'Hidden', note: 'Would rank in this view, but is filtered off the graphic.', rows: hidden },
        { key: 'unranked', title: 'Not yet ranked', note: 'No run yet.', rows: unranked },
        ...(unassigned.length ? [unassignedSection] : []),
    ];
});

const total = computed(() => props.units.length);
const lineCount = computed(() => props.units.filter(unit => tierlist.getEntryLine(unit)).length);

function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        event.stopPropagation();
        emit('close');
    }
}

onMounted(() => window.addEventListener('keydown', onKeydown, true));
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true));
</script>

<template>
    <Teleport to="body">
        <div class="modal-overlay" @click.self="emit('close')" @contextmenu.stop>
            <div class="modal unranked-modal">
                <h2>Assigned species</h2>
                <p class="modal-intro">
                    <template v-if="total">
                        {{ total }} of {{ tierlist.countedTotal?.value }} not on the graphic<template v-if="lineCount">,
                        including {{ lineCount }} evolutionary {{ lineCount === 1 ? 'line' : 'lines' }} (each counts once)</template>{{ tierlist.speciesFiltersActive ? ', counting only species that match the active filters' : '' }}.
                    </template>
                    <template v-else>Every assigned species{{ tierlist.speciesFiltersActive ? ' matching the active filters' : '' }} is ranked.</template>
                    Edit the assigned species with Assign Species (S).
                </p>
                <div v-if="sections.length" class="unranked-sections">
                    <section v-for="section in sections" :key="section.key" class="unranked-section">
                        <h3>{{ section.title }} <span class="unranked-count">{{ section.rows.length }}</span></h3>
                        <div class="unranked-note">{{ section.note }}</div>
                        <ul v-if="section.rows.length" class="unranked-list">
                            <li v-for="row in section.rows" :key="row.unit" class="unranked-row">
                                <img class="unranked-image" :src="row.image" alt="" loading="lazy"
                                     @error="($event.target as HTMLImageElement).style.visibility = 'hidden'" />
                                <div class="unranked-text">
                                    <div class="unranked-name">{{ row.unit }}</div>
                                    <div v-if="row.line && row.line.length > 1" class="unranked-line">
                                        {{ row.line.join(' → ') }}
                                    </div>
                                    <div v-if="row.reason" class="unranked-reason">{{ row.reason }}</div>
                                </div>
                            </li>
                        </ul>
                        <div v-else class="unranked-empty">None</div>
                    </section>
                </div>
                <div class="modal-actions">
                    <button class="close-btn" @click="emit('close')">Close</button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
}

.unranked-modal {
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 10px;
    padding: 24px;
    width: 640px;
    max-width: 90vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    font-family: sans-serif;
    cursor: default;
}

.unranked-modal h2 {
    color: white;
    margin: 0 0 12px 0;
    font-size: 1.25rem;
}

.modal-intro {
    color: #ccc;
    margin: 0 0 14px 0;
    font-size: 0.95rem;
}

.unranked-sections {
    overflow-y: auto;
    margin: 0 0 14px 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.unranked-section h3 {
    color: white;
    margin: 0;
    font-size: 1rem;
}

.unranked-count {
    color: #999;
    font-weight: normal;
    margin-left: 4px;
}

.unranked-note,
.unranked-empty {
    color: #999;
    font-size: 0.85rem;
    margin: 2px 0 8px 0;
}

.unranked-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 8px;
}

.unranked-row {
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 6px;
    padding: 6px 10px;
    display: flex;
    align-items: center;
    gap: 10px;
}

.unranked-image {
    width: 48px;
    height: 48px;
    object-fit: contain;
    flex-shrink: 0;
}

.unranked-text {
    min-width: 0;
}

.unranked-name {
    color: #e0e0e0;
    font-weight: 600;
    font-size: 0.95rem;
}

.unranked-line {
    color: #999;
    font-size: 0.8rem;
    margin-top: 2px;
}

.unranked-reason {
    color: #f0c674;
    font-size: 0.8rem;
    margin-top: 2px;
}

.modal-actions {
    display: flex;
    justify-content: flex-end;
}

.close-btn {
    padding: 8px 16px;
    background: #444;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
}

.close-btn:hover {
    background: #555;
}
</style>
