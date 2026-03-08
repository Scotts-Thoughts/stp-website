<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useWorkspace, useContextMenu } from '../store';
import type { Tierlist } from '../store/tierlist';
import CartridgeIcon from '../components/CartridgeIcon.vue';
import { TIERLIST_GAMES, getGameOrder, getGameConfig } from '../constants/games';

const emit = defineEmits<{
    select: [index: number],
}>();

const workspace = useWorkspace();
const contextMenu = useContextMenu();

// Update availability (Electron only)
const availableUpdateVersion = ref<string | null>(null);
onMounted(async () => {
    if (window.electronUpdate) {
        availableUpdateVersion.value = await window.electronUpdate.getAvailableVersion();
    }
});
async function installUpdate() {
    if (window.electronUpdate) {
        await window.electronUpdate.install();
    }
}

// 4-way visibility: show all (including hidden), only tierlists with entries, hide hidden (custom), or Scott's Tierlists only
type VisibilityMode = 'show_all' | 'hide_without_entries' | 'hide_hidden' | 'scott_only';
const visibilityMode = ref<VisibilityMode>('hide_hidden');

// When true, show one card per game; clicking opens a popover to pick which tierlist
const groupByGame = ref(false);
const popoverGame = ref<string | null>(null);

// Persist toggle state in workspace settings and restore on load
onMounted(() => {
    const s = workspace.settings;
    if (s?.visibilityMode === 'show_all' || s?.visibilityMode === 'hide_without_entries' || s?.visibilityMode === 'hide_hidden' || s?.visibilityMode === 'scott_only') {
        visibilityMode.value = s.visibilityMode;
    } else if (s?.showHiddenTierlists !== undefined) {
        visibilityMode.value = s.showHiddenTierlists ? 'show_all' : 'hide_hidden';
    }
    if (s?.groupTierlistsByGame !== undefined) groupByGame.value = !!s.groupTierlistsByGame;
});

watch([visibilityMode, groupByGame], () => {
    const s = workspace.settings;
    if (!s || typeof s !== 'object') return;
    s.visibilityMode = visibilityMode.value;
    s.groupTierlistsByGame = groupByGame.value;
    workspace.saveWorkspace();
});

// Tierlists to display based on 4-way visibility
const visibleTierlists = computed(() => {
    const list = workspace.tierlists;
    if (visibilityMode.value === 'scott_only') {
        return list.filter(t => isScottTierlist(t));
    }
    switch (visibilityMode.value) {
        case 'show_all':
            return list;
        case 'hide_without_entries':
            return list.filter(t => t.visible !== false && Object.keys(t.entries ?? {}).length > 0);
        case 'hide_hidden':
        default:
            return list.filter(tierlist => tierlist.visible !== false);
    }
});

// Separate "scott-" tierlists from the rest
const isScottTierlist = (tierlist: { filename: string }) => tierlist.filename.startsWith('scott-');

// Main tierlists (non-Scott). Scott tierlists are only shown when mode is 'scott_only'.
const mainTierlists = computed(() => {
    return visibleTierlists.value.filter(tierlist => !isScottTierlist(tierlist));
});

// Scott tierlists: only non-empty when "Scott's Tierlists" mode is selected (only way to access them).
const scottTierlists = computed(() => {
    if (visibilityMode.value !== 'scott_only') return [];
    return workspace.tierlists.filter(tierlist => isScottTierlist(tierlist));
});

// Game Boy / Game Boy Color order: Green (Jpn), Red, Blue, Yellow, Gold, Silver, Crystal (by game order from TIERLIST_GAMES)
function sortByGameOrderThenName<T extends { game: string; name: string }>(a: T, b: T): number {
    const oa = getGameOrder(a.game);
    const ob = getGameOrder(b.game);
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name);
}

// Group tierlists by platform (order from TIERLIST_GAMES: Green→Crystal, Ruby→LeafGreen, Diamond→White2, X→Ultra Moon, Sword→Violet, Winds/Waves) with specific ordering (GB/GBC use game order: Green, Red, Blue, Yellow, Gold, Silver, Crystal)
const gameBoyTierlists = computed(() => {
    return mainTierlists.value
        .filter(tierlist => tierlist.platform === 'Game Boy')
        .sort(sortByGameOrderThenName);
});

const gameBoyColorTierlists = computed(() => {
    return mainTierlists.value
        .filter(tierlist => tierlist.platform === 'Game Boy Color')
        .sort(sortByGameOrderThenName);
});

// Combined Game Boy and Game Boy Color tierlists (sorted by game order: Green, Red, Blue, Yellow, Gold, Silver, Crystal)
const gameBoyCombinedTierlists = computed(() => {
    const combined = [...gameBoyTierlists.value, ...gameBoyColorTierlists.value];
    return combined.sort(sortByGameOrderThenName);
});

// When showing all (including hidden), put GB and GBC on the same line; otherwise combine if 8 or fewer
const shouldCombineGameBoyRows = computed(() => {
    return visibilityMode.value === 'show_all' || gameBoyCombinedTierlists.value.length <= 8;
});

const gameBoyAdvanceTierlists = computed(() => {
    return mainTierlists.value
        .filter(tierlist => tierlist.platform === 'Game Boy Advance')
        .sort(sortByGameOrderThenName);
});

const nintendoDSTierlists = computed(() => {
    return mainTierlists.value
        .filter(tierlist => tierlist.platform === 'Nintendo DS')
        .sort(sortByGameOrderThenName);
});

// Platform groups for rows (3DS, Switch, Switch2, and true "other" get separate rows)
const mainPlatforms = ['Game Boy', 'Game Boy Color', 'Game Boy Advance', 'Nintendo DS'];
const nintendo3DSTierlists = computed(() =>
    mainTierlists.value.filter(t => t.platform === 'Nintendo 3DS').sort(sortByGameOrderThenName)
);
const nintendoSwitchTierlists = computed(() =>
    mainTierlists.value.filter(t => t.platform === 'Nintendo Switch').sort(sortByGameOrderThenName)
);
const nintendoSwitch2Tierlists = computed(() =>
    mainTierlists.value.filter(t => t.platform === 'Switch2').sort(sortByGameOrderThenName)
);
const otherTierlists = computed(() => {
    return mainTierlists.value
        .filter(t => ![...mainPlatforms, 'Nintendo 3DS', 'Nintendo Switch', 'Switch2'].includes(t.platform ?? ''))
        .sort(sortByGameOrderThenName);
});

// When groupByGame is true: one entry per game, with all tierlists for that game.
// "Red and Blue" is never grouped (each tierlist stays its own card).
function groupKeyForTierlist(tierlist: Tierlist): string {
    const g = tierlist.game;
    if (g === 'Red and Blue' || /red\s+and\s+blue/i.test(g)) return `${g}::${tierlist.filename}`;
    return g;
}
type GameGroup = { game: string; tierlists: { tierlist: Tierlist; index: number }[]; firstTierlist: Tierlist };
const groupedByGame = computed((): GameGroup[] => {
    const list = mainTierlists.value;
    const withIndex = list.map(tierlist => ({ tierlist, index: workspace.tierlists.indexOf(tierlist) }));
    const byGame = new Map<string, { tierlist: Tierlist; index: number }[]>();
    for (const item of withIndex) {
        const g = groupKeyForTierlist(item.tierlist);
        if (!byGame.has(g)) byGame.set(g, []);
        byGame.get(g)!.push(item);
    }
    const groups: GameGroup[] = [];
    for (const [, items] of byGame.entries()) {
        groups.push({
            game: items[0].tierlist.game,
            tierlists: items,
            firstTierlist: items[0].tierlist,
        });
    }
    // Order groups by canonical game order (TIERLIST_GAMES) so "Hide hidden" + "Group by game" show correct order
    groups.sort((a, b) => getGameOrder(a.game) - getGameOrder(b.game));
    return groups;
});

// Split grouped games by platform so line breaks match the ungrouped view
const groupedGameBoy = computed(() =>
    groupedByGame.value.filter(g => g.firstTierlist.platform === 'Game Boy' || g.firstTierlist.platform === 'Game Boy Color')
);
const groupedGameBoyAdvance = computed(() =>
    groupedByGame.value.filter(g => g.firstTierlist.platform === 'Game Boy Advance')
);
const groupedNintendoDS = computed(() =>
    groupedByGame.value.filter(g => g.firstTierlist.platform === 'Nintendo DS')
);
const grouped3DS = computed(() =>
    groupedByGame.value.filter(g => g.firstTierlist.platform === 'Nintendo 3DS')
);
const groupedSwitch = computed(() =>
    groupedByGame.value.filter(g => g.firstTierlist.platform === 'Nintendo Switch')
);
const groupedSwitch2 = computed(() =>
    groupedByGame.value.filter(g => g.firstTierlist.platform === 'Switch2')
);
const groupedOther = computed(() =>
    groupedByGame.value.filter(g => {
        const p = g.firstTierlist.platform ?? '';
        return !['Game Boy', 'Game Boy Color', 'Game Boy Advance', 'Nintendo DS', 'Nintendo 3DS', 'Nintendo Switch', 'Switch2'].includes(p);
    })
);

function openGamePopover(game: string) {
    popoverGame.value = popoverGame.value === game ? null : game;
}

/** Use game config cover art when tierlist has no cartridgeImage (e.g. 3DS/Switch/Switch2). */
function effectiveCartridgeImage(tierlist: Tierlist): string | undefined {
    return getGameConfig(tierlist.game)?.cartridgeImage ?? tierlist.cartridgeImage;
}

function onGroupClick(group: GameGroup) {
    if (group.tierlists.length === 1) {
        emit('select', group.tierlists[0].index);
    } else {
        openGamePopover(group.game);
    }
}

function selectTierlistFromPopover(index: number) {
    emit('select', index);
    popoverGame.value = null;
}

/** True when "Show hidden" is on and this game group has at least one hidden tierlist (for dotted border styling). */
function groupHasHiddenTierlist(group: GameGroup): boolean {
    return visibilityMode.value === 'show_all' && group.tierlists.some(t => t.tierlist.visible === false);
}

/** Convert vertical mouse wheel to horizontal scroll on the row wrapper. */
function onRowWheel(e: WheelEvent) {
    const wrapper = e.currentTarget as HTMLElement;
    if (!wrapper) return;
    const hasHorizontalOverflow = wrapper.scrollWidth > wrapper.clientWidth;
    if (!hasHorizontalOverflow) return;
    // Prioritize horizontal scrolling on rows that have overflow
    e.preventDefault();
    wrapper.scrollLeft += e.deltaY;
}

// Function to get cartridge color based on game/tierlist name (fallback for backwards compatibility)
function getCartridgeColor(name: string): string {
    const lowerName = name.toLowerCase();

    // Standalone "Blue" (e.g. "Gen 1 - Blue Tierlist") must get blue, not red from "Red and Blue"
    if (/\bblue\b/.test(lowerName) && !/red\s+and\s+blue/.test(lowerName)) return 'blue';

    // Exact / combined game name matches (check first)
    if (lowerName === 'red and blue' || lowerName.includes('red and blue')) return 'red';
    if (lowerName === 'green (jpn)' || lowerName.includes('green (jpn)') || lowerName.includes('japanese green')) return 'green';
    if (lowerName === "let's go pikachu" || lowerName.includes("let's go pikachu")) return 'yellow';
    if (lowerName === "let's go eevee" || lowerName.includes("let's go eevee")) return 'red';

    // Gen 6+ multi-word games (check before single-word matches)
    if (lowerName.includes('omega ruby')) return 'omegaruby';
    if (lowerName.includes('alpha sapphire')) return 'alphasapphire';
    if (lowerName.includes('ultra sun')) return 'ultrasun';
    if (lowerName.includes('ultra moon')) return 'ultramoon';
    if (lowerName.includes('brilliant diamond')) return 'brilliantdiamond';
    if (lowerName.includes('shining pearl')) return 'shiningpearl';

    // Other specific game names
    if (lowerName.includes('firered')) return 'firered';
    if (lowerName.includes('leafgreen')) return 'leafgreen';
    if (lowerName.includes('heartgold')) return 'heartgold';
    if (lowerName.includes('soulsilver')) return 'soulsilver';
    if (lowerName.includes('black 2') || lowerName.includes('black2')) return 'black2';
    if (lowerName.includes('white 2') || lowerName.includes('white2')) return 'white2';

    // Gen 6+ single-word / distinct games
    if (lowerName.includes('sword')) return 'sword';
    if (lowerName.includes('shield')) return 'shield';
    if (lowerName.includes('scarlett')) return 'scarlett';
    if (lowerName.includes('violet')) return 'violet';
    if (lowerName.includes('winds')) return 'winds';
    if (lowerName.includes('waves')) return 'waves';
    // X and Y (avoid matching "ex" or random x/y)
    if (/\bx\b/.test(lowerName) || lowerName.endsWith(' x') || lowerName.includes('pokemon x')) return 'x';
    if (/\by\b/.test(lowerName) || lowerName.endsWith(' y') || lowerName.includes('pokemon y')) return 'y';
    if (lowerName.includes('sun')) return 'sun';
    if (lowerName.includes('moon')) return 'moon';

    // General color names
    if (lowerName.includes('crystal')) return 'crystal';
    if (lowerName.includes('emerald')) return 'emerald';
    if (lowerName.includes('platinum')) return 'platinum';
    if (lowerName.includes('black')) return 'black';
    if (lowerName.includes('white')) return 'white';
    if (lowerName.includes('gold')) return 'gold';
    if (lowerName.includes('silver')) return 'silver';
    if (lowerName.includes('ruby')) return 'ruby';
    if (lowerName.includes('sapphire')) return 'sapphire';
    if (lowerName.includes('diamond')) return 'diamond';
    if (lowerName.includes('pearl')) return 'pearl';
    if (lowerName.includes('blue')) return 'blue';
    if (lowerName.includes('red')) return 'red';
    if (lowerName.includes('green')) return 'green';
    if (lowerName.includes('yellow')) return 'yellow';

    return 'yellow'; // default
}

// ---- Trash panel ----
const showTrashPanel = ref(false);
const trashContents = ref<{ filename: string; name: string }[]>([]);

async function openTrashPanel() {
    trashContents.value = await workspace.getTrashContents();
    showTrashPanel.value = true;
}

async function restoreFromTrash(filename: string) {
    const result = await workspace.restoreFromTrash(filename);
    if (!result.success) {
        alert(result.message);
        return;
    }
    trashContents.value = await workspace.getTrashContents();
    await workspace.saveWorkspace();
}

async function emptyTrash() {
    if (!confirm('Permanently delete all tierlists in trash? This cannot be undone.')) return;
    const result = await workspace.emptyTrash();
    if (!result.success) alert(result.message);
    else {
        showTrashPanel.value = false;
        trashContents.value = [];
    }
}

// ---- Create new tierlist modal ----
const showCreateModal = ref(false);
const newTierlistGame = ref(TIERLIST_GAMES[0]?.name ?? 'Yellow');
const newTierlistName = ref('');

watch(groupByGame, (on) => {
    if (!on) popoverGame.value = null;
});

// Esc closes the Trash popup
watch(showTrashPanel, (isOpen) => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') showTrashPanel.value = false;
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
});

watch(showCreateModal, (isOpen) => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') showCreateModal.value = false;
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
});

watch(newTierlistGame, (game) => {
    newTierlistName.value = `${game} Tierlist`;
});

function openCreateModal() {
    newTierlistGame.value = TIERLIST_GAMES[0]?.name ?? 'Yellow';
    newTierlistName.value = `${newTierlistGame.value} Tierlist`;
    showCreateModal.value = true;
}

async function createNewTierlist() {
    const name = newTierlistName.value.trim();
    if (!name) return;
    const result = await workspace.createTierlist(name, newTierlistGame.value);
    if (result.success) {
        await workspace.saveWorkspace();
        showCreateModal.value = false;
        emit('select', result.data);
    } else {
        alert(result.message);
    }
}

// ---- Right-click hide/unhide/delete ----
function buildContextMenuOptions(tierlist: { visible?: boolean; name?: string }, index: number) {
    const isHidden = tierlist.visible === false;
    return [
        {
            label: isHidden ? 'Unhide tierlist' : 'Hide tierlist',
            action: () => {
                workspace.setTierlistVisible(index, isHidden);
                workspace.saveWorkspace();
            },
        },
        {
            label: 'Move to trash',
            action: async () => {
                const name = tierlist.name ?? 'this tierlist';
                if (!confirm(`Move "${name}" to trash?`)) return;
                const result = await workspace.moveTierlistToTrash(index);
                if (!result.success) alert(result.message);
                else await workspace.saveWorkspace();
            },
        },
    ];
}

function onCartridgeContextMenu(e: MouseEvent, tierlist: { visible?: boolean; name?: string }, index: number) {
    e.preventDefault();
    contextMenu.setOptions(buildContextMenuOptions(tierlist, index));
    contextMenu.show(e.clientX, e.clientY);
}

function onGroupContextMenu(e: MouseEvent, group: GameGroup) {
    e.preventDefault();
    if (group.tierlists.length === 1) {
        const item = group.tierlists[0];
        contextMenu.setOptions(buildContextMenuOptions(item.tierlist, item.index));
    } else {
        const options = group.tierlists.map(item => ({
            label: item.tierlist.name ?? item.tierlist.filename,
            action: () => {
                onCartridgeContextMenu(e, item.tierlist, item.index);
                return false as const;
            },
        }));
        contextMenu.setOptions(options);
    }
    contextMenu.show(e.clientX, e.clientY);
}

</script>


<template>
    <div class="choose-tierlist">
        <button type="button" class="trash-btn top-left" title="Trash" @click="openTrashPanel" aria-label="Trash">
            <svg class="trash-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
        </button>
        <button
            v-if="availableUpdateVersion"
            class="update-btn top-right-second"
            :title="'Update to v' + availableUpdateVersion"
            @click="installUpdate"
        >
            <svg class="update-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            v{{ availableUpdateVersion }}
        </button>
        <button class="create-btn top-right" title="Create new tierlist" @click="openCreateModal">+</button>
        <header class="choose-tierlist-header">
            <h1>Choose a Tierlist</h1>
            <div class="toggles-column">
                <div class="visibility-toggle pill-container">
                    <button type="button" class="visibility-option" :class="{ active: visibilityMode === 'show_all' }" @click="visibilityMode = 'show_all'">Show all</button>
                    <button type="button" class="visibility-option" :class="{ active: visibilityMode === 'hide_without_entries' }" @click="visibilityMode = 'hide_without_entries'">With Data</button>
                    <button type="button" class="visibility-option" :class="{ active: visibilityMode === 'hide_hidden' }" @click="visibilityMode = 'hide_hidden'">Custom</button>
                    <button type="button" class="visibility-option" :class="{ active: visibilityMode === 'scott_only' }" @click="visibilityMode = 'scott_only'">Scott's Tierlists</button>
                </div>
                <label class="toggle-label group-by-game-toggle">
                    <input type="checkbox" v-model="groupByGame" :disabled="visibilityMode === 'scott_only'" />
                    Group tierlists by game
                </label>
            </div>
        </header>
        <!-- Scott's Tierlists only: show when 4th option is selected -->
        <div v-if="visibilityMode === 'scott_only'" class="cartridge-grid scott-only-grid">
            <div class="scott-section">
                <h2 class="scott-header">Scott's Tierlists</h2>
            </div>
            <p v-if="scottTierlists.length === 0" class="scott-empty">No Scott tierlists in this workspace.</p>
            <div v-else class="cartridge-row-wrapper" @wheel="onRowWheel">
                <div class="cartridge-row scott-row">
                    <CartridgeIcon
                        v-for="(t, i) in scottTierlists"
                        :key="'scott-' + i"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="effectiveCartridgeImage(t)"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), t.visible === false ? 'hidden-tierlist' : '']"
                        @click="emit('select', workspace.tierlists.indexOf(t))"
                        @contextmenu.prevent="onCartridgeContextMenu($event, t, workspace.tierlists.indexOf(t))"
                    />
                </div>
            </div>
        </div>
        <div v-else-if="groupByGame" class="cartridge-grid grouped-grid">
            <!-- Game Boy + Game Boy Color -->
            <div v-if="groupedGameBoy.length > 0" class="cartridge-row-wrapper" @wheel="onRowWheel">
            <div class="cartridge-row">
                <div
                    v-for="group in groupedGameBoy"
                    :key="group.firstTierlist.filename"
                    class="game-group-card"
                    @contextmenu.prevent="onGroupContextMenu($event, group)"
                >
                    <div class="game-group-click" @click="onGroupClick(group)">
                        <CartridgeIcon
                            :name="group.tierlists.length > 1 ? group.game + ' tierlists...' : group.firstTierlist.name"
                            :imageSource="group.firstTierlist.imageSource"
                            :cartridgeImage="effectiveCartridgeImage(group.firstTierlist)"
                            :platform="group.firstTierlist.platform"
                            :game="group.game"
                            :class="[getCartridgeColor(group.tierlists.length > 1 ? group.game : group.firstTierlist.name), groupHasHiddenTierlist(group) ? 'hidden-tierlist' : '']"
                        />
                    </div>
                </div>
            </div>
            </div>
            <!-- Game Boy Advance -->
            <div v-if="groupedGameBoyAdvance.length > 0" class="cartridge-row-wrapper" @wheel="onRowWheel">
            <div class="cartridge-row">
                <div
                    v-for="group in groupedGameBoyAdvance"
                    :key="group.firstTierlist.filename"
                    class="game-group-card"
                    @contextmenu.prevent="onGroupContextMenu($event, group)"
                >
                    <div class="game-group-click" @click="onGroupClick(group)">
                        <CartridgeIcon
                            :name="group.tierlists.length > 1 ? group.game + ' tierlists...' : group.firstTierlist.name"
                            :imageSource="group.firstTierlist.imageSource"
                            :cartridgeImage="effectiveCartridgeImage(group.firstTierlist)"
                            :platform="group.firstTierlist.platform"
                            :game="group.game"
                            :class="[getCartridgeColor(group.tierlists.length > 1 ? group.game : group.firstTierlist.name), groupHasHiddenTierlist(group) ? 'hidden-tierlist' : '']"
                        />
                    </div>
                </div>
            </div>
            </div>
            <!-- Nintendo DS -->
            <div v-if="groupedNintendoDS.length > 0" class="cartridge-row-wrapper" @wheel="onRowWheel">
            <div class="cartridge-row">
                <div
                    v-for="group in groupedNintendoDS"
                    :key="group.firstTierlist.filename"
                    class="game-group-card"
                    @contextmenu.prevent="onGroupContextMenu($event, group)"
                >
                    <div class="game-group-click" @click="onGroupClick(group)">
                        <CartridgeIcon
                            :name="group.tierlists.length > 1 ? group.game + ' tierlists...' : group.firstTierlist.name"
                            :imageSource="group.firstTierlist.imageSource"
                            :cartridgeImage="effectiveCartridgeImage(group.firstTierlist)"
                            :platform="group.firstTierlist.platform"
                            :game="group.game"
                            :class="[getCartridgeColor(group.tierlists.length > 1 ? group.game : group.firstTierlist.name), groupHasHiddenTierlist(group) ? 'hidden-tierlist' : '']"
                        />
                    </div>
                </div>
            </div>
            </div>
            <!-- Nintendo 3DS -->
            <div v-if="grouped3DS.length > 0" class="cartridge-row-wrapper" @wheel="onRowWheel">
            <div class="cartridge-row">
                <div
                    v-for="group in grouped3DS"
                    :key="group.firstTierlist.filename"
                    class="game-group-card"
                    @contextmenu.prevent="onGroupContextMenu($event, group)"
                >
                    <div class="game-group-click" @click="onGroupClick(group)">
                        <CartridgeIcon
                            :name="group.tierlists.length > 1 ? group.game + ' tierlists...' : group.firstTierlist.name"
                            :imageSource="group.firstTierlist.imageSource"
                            :cartridgeImage="effectiveCartridgeImage(group.firstTierlist)"
                            :platform="group.firstTierlist.platform"
                            :game="group.game"
                            :class="[getCartridgeColor(group.tierlists.length > 1 ? group.game : group.firstTierlist.name), groupHasHiddenTierlist(group) ? 'hidden-tierlist' : '']"
                        />
                    </div>
                </div>
            </div>
            </div>
            <!-- Nintendo Switch -->
            <div v-if="groupedSwitch.length > 0" class="cartridge-row-wrapper" @wheel="onRowWheel">
            <div class="cartridge-row">
                <div
                    v-for="group in groupedSwitch"
                    :key="group.firstTierlist.filename"
                    class="game-group-card"
                    @contextmenu.prevent="onGroupContextMenu($event, group)"
                >
                    <div class="game-group-click" @click="onGroupClick(group)">
                        <CartridgeIcon
                            :name="group.tierlists.length > 1 ? group.game + ' tierlists...' : group.firstTierlist.name"
                            :imageSource="group.firstTierlist.imageSource"
                            :cartridgeImage="effectiveCartridgeImage(group.firstTierlist)"
                            :platform="group.firstTierlist.platform"
                            :game="group.game"
                            :class="[getCartridgeColor(group.tierlists.length > 1 ? group.game : group.firstTierlist.name), groupHasHiddenTierlist(group) ? 'hidden-tierlist' : '']"
                        />
                    </div>
                </div>
            </div>
            </div>
            <!-- Switch2 -->
            <div v-if="groupedSwitch2.length > 0" class="cartridge-row-wrapper" @wheel="onRowWheel">
            <div class="cartridge-row">
                <div
                    v-for="group in groupedSwitch2"
                    :key="group.firstTierlist.filename"
                    class="game-group-card"
                    @contextmenu.prevent="onGroupContextMenu($event, group)"
                >
                    <div class="game-group-click" @click="onGroupClick(group)">
                        <CartridgeIcon
                            :name="group.tierlists.length > 1 ? group.game + ' tierlists...' : group.firstTierlist.name"
                            :imageSource="group.firstTierlist.imageSource"
                            :cartridgeImage="effectiveCartridgeImage(group.firstTierlist)"
                            :platform="group.firstTierlist.platform"
                            :game="group.game"
                            :class="[getCartridgeColor(group.tierlists.length > 1 ? group.game : group.firstTierlist.name), groupHasHiddenTierlist(group) ? 'hidden-tierlist' : '']"
                        />
                    </div>
                </div>
            </div>
            </div>
            <!-- Other platforms (Winds, Waves, etc.) -->
            <div v-if="groupedOther.length > 0" class="cartridge-row-wrapper" @wheel="onRowWheel">
            <div class="cartridge-row">
                <div
                    v-for="group in groupedOther"
                    :key="group.firstTierlist.filename"
                    class="game-group-card"
                    @contextmenu.prevent="onGroupContextMenu($event, group)"
                >
                    <div class="game-group-click" @click="onGroupClick(group)">
                        <CartridgeIcon
                            :name="group.tierlists.length > 1 ? group.game + ' tierlists...' : group.firstTierlist.name"
                            :imageSource="group.firstTierlist.imageSource"
                            :cartridgeImage="effectiveCartridgeImage(group.firstTierlist)"
                            :platform="group.firstTierlist.platform"
                            :game="group.game"
                            :class="[getCartridgeColor(group.tierlists.length > 1 ? group.game : group.firstTierlist.name), groupHasHiddenTierlist(group) ? 'hidden-tierlist' : '']"
                        />
                    </div>
                </div>
            </div>
            </div>
            <!-- Popover for grouped game: pick which tierlist to open -->
            <Teleport to="body">
                <div v-if="popoverGame" class="game-popover-overlay" @click="popoverGame = null">
                    <div class="game-popover" @click.stop>
                        <template v-for="group in groupedByGame" :key="group.firstTierlist.filename">
                            <template v-if="group.game === popoverGame">
                                <div class="game-popover-title">{{ group.game }} tierlists</div>
                                <button
                                    v-for="item in group.tierlists"
                                    :key="item.index"
                                    class="game-popover-item"
                                    @click="selectTierlistFromPopover(item.index)"
                                >
                                    {{ item.tierlist.name }}
                                </button>
                            </template>
                        </template>
                    </div>
                </div>
            </Teleport>
        </div>
        <div v-else class="cartridge-grid">
            <!-- Conditional rendering: Combined or separate Game Boy rows -->
            <template v-if="shouldCombineGameBoyRows">
                <!-- Row 1: Combined Game Boy and Game Boy Color -->
                <div class="cartridge-row-wrapper" @wheel="onRowWheel">
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in gameBoyCombinedTierlists" 
                        :key="i"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="effectiveCartridgeImage(t)"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), t.visible === false ? 'hidden-tierlist' : '']"
                        @click="emit('select', workspace.tierlists.indexOf(t))"
                        @contextmenu.prevent="onCartridgeContextMenu($event, t, workspace.tierlists.indexOf(t))"
                    />
                </div>
                </div>
                
                <!-- Row 2: Game Boy Advance -->
                <div class="cartridge-row-wrapper" @wheel="onRowWheel">
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in gameBoyAdvanceTierlists" 
                        :key="i + 100"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="effectiveCartridgeImage(t)"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), t.visible === false ? 'hidden-tierlist' : '']"
                        @click="emit('select', workspace.tierlists.indexOf(t))"
                        @contextmenu.prevent="onCartridgeContextMenu($event, t, workspace.tierlists.indexOf(t))"
                    />
                </div>
                </div>
                
                <!-- Row 3: Nintendo DS -->
                <div class="cartridge-row-wrapper" @wheel="onRowWheel">
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in nintendoDSTierlists" 
                        :key="i + 200"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="effectiveCartridgeImage(t)"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), t.visible === false ? 'hidden-tierlist' : '']"
                        @click="emit('select', workspace.tierlists.indexOf(t))"
                        @contextmenu.prevent="onCartridgeContextMenu($event, t, workspace.tierlists.indexOf(t))"
                    />
                </div>
                </div>
                
                <!-- Row 4: Nintendo 3DS -->
                <div v-if="nintendo3DSTierlists.length > 0" class="cartridge-row-wrapper" @wheel="onRowWheel">
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in nintendo3DSTierlists" 
                        :key="'3ds-' + i"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="effectiveCartridgeImage(t)"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), t.visible === false ? 'hidden-tierlist' : '']"
                        @click="emit('select', workspace.tierlists.indexOf(t))"
                        @contextmenu.prevent="onCartridgeContextMenu($event, t, workspace.tierlists.indexOf(t))"
                    />
                </div>
                </div>
                
                <!-- Row 5: Nintendo Switch -->
                <div v-if="nintendoSwitchTierlists.length > 0" class="cartridge-row-wrapper" @wheel="onRowWheel">
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in nintendoSwitchTierlists" 
                        :key="'switch-' + i"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="effectiveCartridgeImage(t)"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), t.visible === false ? 'hidden-tierlist' : '']"
                        @click="emit('select', workspace.tierlists.indexOf(t))"
                        @contextmenu.prevent="onCartridgeContextMenu($event, t, workspace.tierlists.indexOf(t))"
                    />
                </div>
                </div>
                
                <!-- Row 6: Switch2 -->
                <div v-if="nintendoSwitch2Tierlists.length > 0" class="cartridge-row-wrapper" @wheel="onRowWheel">
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in nintendoSwitch2Tierlists" 
                        :key="'switch2-' + i"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="effectiveCartridgeImage(t)"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), t.visible === false ? 'hidden-tierlist' : '']"
                        @click="emit('select', workspace.tierlists.indexOf(t))"
                        @contextmenu.prevent="onCartridgeContextMenu($event, t, workspace.tierlists.indexOf(t))"
                    />
                </div>
                </div>
                
                <!-- Row 7: Other (Winds, Waves, etc.) -->
                <div v-if="otherTierlists.length > 0" class="cartridge-row-wrapper" @wheel="onRowWheel">
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in otherTierlists" 
                        :key="'other-' + i"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="effectiveCartridgeImage(t)"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), t.visible === false ? 'hidden-tierlist' : '']"
                        @click="emit('select', workspace.tierlists.indexOf(t))"
                        @contextmenu.prevent="onCartridgeContextMenu($event, t, workspace.tierlists.indexOf(t))"
                    />
                </div>
                </div>
            </template>
            
            <template v-else>
                <!-- Row 1: Game Boy -->
                <div class="cartridge-row-wrapper" @wheel="onRowWheel">
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in gameBoyTierlists" 
                        :key="i"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="effectiveCartridgeImage(t)"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), t.visible === false ? 'hidden-tierlist' : '']"
                        @click="emit('select', workspace.tierlists.indexOf(t))"
                        @contextmenu.prevent="onCartridgeContextMenu($event, t, workspace.tierlists.indexOf(t))"
                    />
                </div>
                </div>
                
                <!-- Row 2: Game Boy Color -->
                <div class="cartridge-row-wrapper" @wheel="onRowWheel">
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in gameBoyColorTierlists" 
                        :key="i + 50"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="effectiveCartridgeImage(t)"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), t.visible === false ? 'hidden-tierlist' : '']"
                        @click="emit('select', workspace.tierlists.indexOf(t))"
                        @contextmenu.prevent="onCartridgeContextMenu($event, t, workspace.tierlists.indexOf(t))"
                    />
                </div>
                </div>
                
                <!-- Row 3: Game Boy Advance -->
                <div class="cartridge-row-wrapper" @wheel="onRowWheel">
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in gameBoyAdvanceTierlists" 
                        :key="i + 100"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="effectiveCartridgeImage(t)"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), t.visible === false ? 'hidden-tierlist' : '']"
                        @click="emit('select', workspace.tierlists.indexOf(t))"
                        @contextmenu.prevent="onCartridgeContextMenu($event, t, workspace.tierlists.indexOf(t))"
                    />
                </div>
                </div>
                
                <!-- Row 4: Nintendo DS -->
                <div class="cartridge-row-wrapper" @wheel="onRowWheel">
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in nintendoDSTierlists" 
                        :key="i + 200"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="effectiveCartridgeImage(t)"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), t.visible === false ? 'hidden-tierlist' : '']"
                        @click="emit('select', workspace.tierlists.indexOf(t))"
                        @contextmenu.prevent="onCartridgeContextMenu($event, t, workspace.tierlists.indexOf(t))"
                    />
                </div>
                </div>
                
                <!-- Row 5: Nintendo 3DS -->
                <div v-if="nintendo3DSTierlists.length > 0" class="cartridge-row-wrapper" @wheel="onRowWheel">
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in nintendo3DSTierlists" 
                        :key="'3ds-' + i"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="effectiveCartridgeImage(t)"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), t.visible === false ? 'hidden-tierlist' : '']"
                        @click="emit('select', workspace.tierlists.indexOf(t))"
                        @contextmenu.prevent="onCartridgeContextMenu($event, t, workspace.tierlists.indexOf(t))"
                    />
                </div>
                </div>
                
                <!-- Row 6: Nintendo Switch -->
                <div v-if="nintendoSwitchTierlists.length > 0" class="cartridge-row-wrapper" @wheel="onRowWheel">
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in nintendoSwitchTierlists" 
                        :key="'switch-' + i"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="effectiveCartridgeImage(t)"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), t.visible === false ? 'hidden-tierlist' : '']"
                        @click="emit('select', workspace.tierlists.indexOf(t))"
                        @contextmenu.prevent="onCartridgeContextMenu($event, t, workspace.tierlists.indexOf(t))"
                    />
                </div>
                </div>
                
                <!-- Row 7: Switch2 -->
                <div v-if="nintendoSwitch2Tierlists.length > 0" class="cartridge-row-wrapper" @wheel="onRowWheel">
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in nintendoSwitch2Tierlists" 
                        :key="'switch2-' + i"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="effectiveCartridgeImage(t)"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), t.visible === false ? 'hidden-tierlist' : '']"
                        @click="emit('select', workspace.tierlists.indexOf(t))"
                        @contextmenu.prevent="onCartridgeContextMenu($event, t, workspace.tierlists.indexOf(t))"
                    />
                </div>
                </div>
                
                <!-- Row 8: Other (Winds, Waves, etc.) -->
                <div v-if="otherTierlists.length > 0" class="cartridge-row-wrapper" @wheel="onRowWheel">
                <div class="cartridge-row">
                    <CartridgeIcon 
                        v-for="(t, i) in otherTierlists" 
                        :key="'other-' + i"
                        :name="t.name"
                        :imageSource="t.imageSource"
                        :cartridgeImage="effectiveCartridgeImage(t)"
                        :platform="t.platform"
                        :game="t.game"
                        :class="[getCartridgeColor(t.name), t.visible === false ? 'hidden-tierlist' : '']"
                        @click="emit('select', workspace.tierlists.indexOf(t))"
                        @contextmenu.prevent="onCartridgeContextMenu($event, t, workspace.tierlists.indexOf(t))"
                    />
                </div>
                </div>
            </template>
        </div>
        
        <!-- Trash panel -->
        <div v-if="showTrashPanel" class="modal-overlay" @click.self="showTrashPanel = false">
            <div class="modal trash-modal">
                <h2>Trash</h2>
                <p v-if="trashContents.length === 0" class="trash-empty">No tierlists in trash.</p>
                <ul v-else class="trash-list">
                    <li v-for="item in trashContents" :key="item.filename" class="trash-item">
                        <span class="trash-item-name">{{ item.name }}</span>
                        <button class="restore-btn" @click="restoreFromTrash(item.filename)">Restore</button>
                    </li>
                </ul>
                <div class="modal-actions trash-actions">
                    <button v-if="trashContents.length > 0" class="empty-trash-btn" @click="emptyTrash">Empty trash</button>
                    <button class="cancel-btn" @click="showTrashPanel = false">Close</button>
                </div>
            </div>
        </div>

        <!-- Create new tierlist modal -->
        <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
            <div class="modal create-tierlist-modal">
                <h2>Create new tierlist</h2>
                <div class="modal-field">
                    <label for="new-tierlist-game">Game</label>
                    <select id="new-tierlist-game" v-model="newTierlistGame">
                        <option v-for="g in TIERLIST_GAMES" :key="g.name" :value="g.name">{{ g.name }}</option>
                    </select>
                </div>
                <div class="modal-field">
                    <label for="new-tierlist-name">Name</label>
                    <input id="new-tierlist-name" v-model="newTierlistName" type="text" placeholder="e.g. Yellow Tierlist" />
                </div>
                <div class="modal-actions">
                    <button class="cancel-btn" @click="showCreateModal = false">Cancel</button>
                    <button class="create-btn" @click="createNewTierlist">Create</button>
                </div>
            </div>
        </div>
    </div>
</template>


<style scoped>
.choose-tierlist {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 12px;
    padding: 30px 40px;
    overflow: auto;
    width: 95vw;
    max-width: 1400px;
    max-height: 95vh;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

.choose-tierlist-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding-bottom: 4px;
}

.choose-tierlist-header h1 {
    margin: 0;
}

.toggles-column {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
}

.cartridge-grid {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    max-width: 1300px;
    padding: 15px;
}

.cartridge-row-wrapper {
    display: flex;
    justify-content: flex-start;
    overflow-x: auto;
    overflow-y: hidden;
    padding-top: 10px;
    padding-bottom: 8px;
    margin-top: -10px;
    margin-bottom: -8px;
    -webkit-mask-image: linear-gradient(to right, transparent 0%, black 16px, black calc(100% - 16px), transparent 100%);
    mask-image: linear-gradient(to right, transparent 0%, black 16px, black calc(100% - 16px), transparent 100%);
}

.cartridge-row {
    display: flex;
    justify-content: center;
    gap: 15px;
    flex-wrap: nowrap;
    min-width: min-content;
    padding-left: 16px;
    padding-right: 16px;
    margin-left: auto;
    margin-right: auto;
    box-sizing: border-box;
}

.cartridge-row-wrapper .cartridge-row {
    flex-shrink: 0;
}

.cartridge-row > * {
    flex-shrink: 0;
}

.scott-section {
    width: 100%;
    margin-top: 10px;
    padding-top: 15px;
    border-top: 2px solid #444;
    text-align: center;
}

.scott-header {
    color: #ffffff;
    font-family: 'TitanOne', 'Arial Black', sans-serif;
    font-size: 1.5rem;
    margin: 0;
    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
}

.scott-empty {
    color: #aaa;
    margin: 0;
    padding: 20px;
}

.scott-row {
    margin-top: 0;
}

.trash-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 38px;
    padding: 0;
    box-sizing: border-box;
    background: #444;
    color: #eee;
    border: none;
    border-radius: 6px;
    cursor: pointer;
}

.trash-btn:hover {
    filter: brightness(1.15);
    background: #555;
}

.trash-icon {
    width: 20px;
    height: 20px;
}

.trash-btn.top-left {
    position: absolute;
    top: 30px;
    left: 40px;
    z-index: 100;
}

.create-btn.top-right {
    position: absolute;
    top: 30px;
    right: 40px;
    z-index: 100;
}

.update-btn.top-right-second {
    position: absolute;
    top: 30px;
    right: 92px;
    z-index: 100;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    height: 38px;
    box-sizing: border-box;
    background: linear-gradient(135deg, #2a8a4a 0%, #1e6e38 100%);
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
}

.update-btn.top-right-second:hover {
    filter: brightness(1.15);
}

.update-icon {
    width: 18px;
    height: 18px;
}

/* Pill-style 3-way selector: rounded container with contrasting selected segment */
.visibility-toggle.pill-container {
    display: flex;
    align-items: stretch;
    background: #1e1e1e;
    border-radius: 9999px;
    padding: 4px;
    border: 1px solid #444;
}

.visibility-toggle .visibility-option {
    padding: 8px 16px;
    font-size: 0.9rem;
    color: #aaa;
    background: transparent;
    border: none;
    border-radius: 9999px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
}

.visibility-toggle .visibility-option:hover {
    color: #e0e0e0;
}

.visibility-toggle .visibility-option.active {
    background: #4a6fa5;
    color: #fff;
}

.toggle-label.group-by-game-toggle {
    margin: 0;
}

.game-group-card {
    position: relative;
}

.game-group-click {
    cursor: pointer;
}

.game-group-click:hover .cartridge {
    filter: brightness(1.1);
}

/* Popover overlay and content (Teleport to body) */
.game-popover-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.game-popover {
    background: #2a2a2a;
    border-radius: 10px;
    padding: 20px 24px;
    min-width: 280px;
    max-width: 90vw;
    max-height: 70vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.game-popover-title {
    color: #fff;
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid #444;
}

.game-popover-item {
    display: block;
    width: 100%;
    padding: 10px 14px;
    margin-bottom: 4px;
    text-align: left;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 6px;
    color: #e0e0e0;
    font-size: 0.95rem;
    cursor: pointer;
}

.game-popover-item:hover {
    background: #333;
    border-color: #555;
}

/* Trash modal */
.trash-modal {
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 10px;
    padding: 24px;
    min-width: 320px;
    max-width: 90vw;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.trash-modal h2 {
    color: white;
    margin: 0 0 16px 0;
    font-size: 1.25rem;
}
.trash-empty {
    color: #999;
    margin: 0 0 1rem 0;
}
.trash-list {
    list-style: none;
    padding: 0;
    margin: 0 0 1rem 0;
    max-height: 50vh;
    overflow-y: auto;
}
.trash-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    margin-bottom: 6px;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 6px;
}
.trash-item-name {
    color: #e0e0e0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.restore-btn {
    flex-shrink: 0;
    padding: 6px 12px;
    background: #2a5a2a;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
}
.restore-btn:hover {
    background: #357a35;
}
.trash-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
}
.empty-trash-btn {
    padding: 8px 14px;
    background: #5a2a2a;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
}
.empty-trash-btn:hover {
    background: #7a3535;
}

.toggle-label {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #ccc;
    font-size: 0.95rem;
    cursor: pointer;
}

.toggle-label input {
    cursor: pointer;
}

.create-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 8px 16px;
    background: linear-gradient(135deg, #4a90e2 0%, #357abd 100%);
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
}

.create-btn.top-right {
    width: 42px;
    height: 38px;
    padding: 0;
    box-sizing: border-box;
}

.create-btn:hover {
    filter: brightness(1.1);
}

.hidden-tierlist {
    opacity: 0.6;
    outline: 2px dashed rgba(255, 255, 255, 0.5);
}

.modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.create-tierlist-modal {
    background: #2a2a2a;
    border-radius: 10px;
    padding: 24px;
    min-width: 320px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.create-tierlist-modal h2 {
    color: white;
    margin: 0 0 20px 0;
    font-size: 1.25rem;
}

.modal-field {
    margin-bottom: 16px;
}

.modal-field label {
    display: block;
    color: #ccc;
    font-size: 0.9rem;
    margin-bottom: 6px;
}

.modal-field select,
.modal-field input {
    width: 100%;
    padding: 8px 12px;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 6px;
    color: white;
    font-size: 1rem;
}

.modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
}

.modal-actions .cancel-btn,
.modal-actions .create-btn {
    flex: 1 1 0;
    min-width: 0;
}

.cancel-btn {
    padding: 8px 16px;
    background: #444;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
}

.cancel-btn:hover {
    background: #555;
}

h1 {
    color: white;
    font-family: 'TitanOne', 'Arial Black', sans-serif;
    font-size: 2.5rem;
    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
}
</style>
