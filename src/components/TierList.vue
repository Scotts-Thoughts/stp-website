<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, nextTick, watch } from 'vue'
import PkmnImage from './PkmnImage.vue';
import MetricPopout from './MetricPopout.vue';
import { useGlobal, useTierlist, useFileExporter, CreditMode, useToast, useWorkspace } from '../store';
import { getBaseSpeciesName, hasAlternativeMoveType } from '../utils/pokemon';
import { parseTime, formatTimeHMS } from '../utils/time';

const enum TierlistTierIndex {
    S = 0,
    A = 1,
    B = 2,
    C = 3,
    D = 4,
    E = 5,
    F = 6,
    Surge = 7,
    Bruno = 8,
    Impossible = 9,
}

const global = useGlobal();
const tierlist = useTierlist();
const fileexporter = useFileExporter();
const toast = useToast();
const workspace = useWorkspace();

// Track scroll state for each tier row
const tierScrollState = reactive<Record<number, { 
    left: number; 
    right: number; 
    canScroll: boolean;
    thumbLeft: number;
    thumbWidth: number;
}>>({}); 

// Store refs to tier row elements
const tierRowRefs = ref<Map<number, HTMLElement>>(new Map());

// Store observers for cleanup
const resizeObservers = new Map<number, ResizeObserver>();
const mutationObservers = new Map<number, MutationObserver>();

function handleScroll(event: Event, tierIndex: number) {
    const target = event.target as HTMLElement;
    updateScrollState(target, tierIndex);
}

function handleWheel(event: WheelEvent, tierIndex: number) {
    const element = tierRowRefs.value.get(tierIndex);
    if (!element) return;
    
    // Only handle if this tier can scroll
    if (!tierScrollState[tierIndex]?.canScroll) return;
    
    // Convert vertical wheel to horizontal scroll
    if (event.deltaY !== 0) {
        event.preventDefault();
        element.scrollLeft += event.deltaY * 4;
    }
}

function updateScrollState(element: HTMLElement | null, tierIndex: number) {
    if (!element) return;
    
    const scrollLeft = element.scrollLeft;
    const scrollWidth = element.scrollWidth;
    const clientWidth = element.clientWidth;
    const maxScroll = scrollWidth - clientWidth;
    
    // Calculate thumb position and size as percentages
    const thumbWidth = (clientWidth / scrollWidth) * 100;
    const thumbLeft = maxScroll > 0 ? (scrollLeft / maxScroll) * (100 - thumbWidth) : 0;
    
    tierScrollState[tierIndex] = {
        left: Math.min(scrollLeft / 60, 1), // Fade in over 60px of scroll
        right: Math.min((maxScroll - scrollLeft) / 60, 1), // Fade in over 60px from end
        canScroll: scrollWidth > clientWidth,
        thumbLeft,
        thumbWidth
    };
}

function observeImagesInElement(el: HTMLElement, tierIndex: number, resizeObserver: ResizeObserver) {
    const images = el.querySelectorAll('img');
    images.forEach(img => {
        resizeObserver.observe(img);
        // Also listen for load events on images
        if (!img.complete) {
            img.addEventListener('load', () => updateScrollState(el, tierIndex), { once: true });
        }
    });
}

function setTierRowRef(el: HTMLElement | null, tierIndex: number) {
    if (el) {
        // Only set up observer if this is a new element
        if (tierRowRefs.value.get(tierIndex) !== el) {
            // Clean up old observers if exists
            const oldResizeObserver = resizeObservers.get(tierIndex);
            if (oldResizeObserver) {
                oldResizeObserver.disconnect();
            }
            const oldMutationObserver = mutationObservers.get(tierIndex);
            if (oldMutationObserver) {
                oldMutationObserver.disconnect();
            }
            
            tierRowRefs.value.set(tierIndex, el);
            updateScrollState(el, tierIndex);
            
            // Create ResizeObserver that watches for size changes
            const resizeObserver = new ResizeObserver(() => {
                updateScrollState(el, tierIndex);
            });
            resizeObserver.observe(el);
            
            // Observe existing images
            observeImagesInElement(el, tierIndex, resizeObserver);
            
            // Create MutationObserver to detect when new children are added
            const mutationObserver = new MutationObserver((mutations) => {
                mutations.forEach(mutation => {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        // New nodes added, observe any new images
                        observeImagesInElement(el, tierIndex, resizeObserver);
                        updateScrollState(el, tierIndex);
                    }
                });
            });
            mutationObserver.observe(el, { childList: true, subtree: true });
            
            resizeObservers.set(tierIndex, resizeObserver);
            mutationObservers.set(tierIndex, mutationObserver);
        }
    }
}

// Scrollbar drag handling
let dragState: { tierIndex: number; startX: number; startScrollLeft: number } | null = null;

function startThumbDrag(event: MouseEvent, tierIndex: number) {
    const element = tierRowRefs.value.get(tierIndex);
    if (!element) return;
    
    // Disable smooth scrolling during drag for responsive feel
    element.style.scrollBehavior = 'auto';
    
    dragState = {
        tierIndex,
        startX: event.clientX,
        startScrollLeft: element.scrollLeft
    };
    
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
}

function startScrollDrag(event: MouseEvent, tierIndex: number) {
    const element = tierRowRefs.value.get(tierIndex);
    if (!element) return;
    
    // Disable smooth scrolling during drag for responsive feel
    element.style.scrollBehavior = 'auto';
    
    const track = event.currentTarget as HTMLElement;
    const trackRect = track.getBoundingClientRect();
    const clickPosition = (event.clientX - trackRect.left) / trackRect.width;
    
    const scrollWidth = element.scrollWidth;
    const clientWidth = element.clientWidth;
    const maxScroll = scrollWidth - clientWidth;
    
    // Scroll to clicked position (centered on thumb)
    element.scrollLeft = clickPosition * maxScroll;
    
    // Also initiate drag mode so user can continue dragging after click
    dragState = {
        tierIndex,
        startX: event.clientX,
        startScrollLeft: element.scrollLeft
    };
    
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
}

function onDragMove(event: MouseEvent) {
    if (!dragState) return;
    
    const element = tierRowRefs.value.get(dragState.tierIndex);
    if (!element) return;
    
    const deltaX = event.clientX - dragState.startX;
    const trackWidth = element.clientWidth - 20; // Account for track margins
    const scrollWidth = element.scrollWidth;
    const clientWidth = element.clientWidth;
    
    // Calculate thumb drag range (track width minus thumb width)
    // Thumb width ratio = clientWidth / scrollWidth
    const thumbDragRange = trackWidth * (1 - clientWidth / scrollWidth);
    const maxScroll = scrollWidth - clientWidth;
    
    // Convert pixel delta to scroll delta (1:1 mouse tracking with thumb)
    const scrollDelta = (deltaX / thumbDragRange) * maxScroll;
    element.scrollLeft = dragState.startScrollLeft + scrollDelta;
}

function onDragEnd() {
    // Restore smooth scrolling
    if (dragState) {
        const element = tierRowRefs.value.get(dragState.tierIndex);
        if (element) {
            element.style.scrollBehavior = 'smooth';
        }
    }
    
    dragState = null;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
}

// Force update all scroll states
function updateAllScrollStates() {
    tierRowRefs.value.forEach((el, index) => {
        updateScrollState(el, index);
    });
}

// Update scroll states when grouped entries change
watch(() => tierlist.groupedEntries, () => {
    nextTick(() => {
        updateAllScrollStates();
        // Also update after a short delay to catch image loads
        setTimeout(updateAllScrollStates, 100);
        setTimeout(updateAllScrollStates, 500);
    });
}, { deep: true });

// Also watch for active tierlist changes
watch(() => tierlist.activeTierlist, () => {
    nextTick(() => {
        updateAllScrollStates();
        setTimeout(updateAllScrollStates, 100);
        setTimeout(updateAllScrollStates, 500);
        setTimeout(updateAllScrollStates, 1000);
    });
}, { deep: true });

// Cleanup observers on unmount
onUnmounted(() => {
    resizeObservers.forEach(observer => observer.disconnect());
    resizeObservers.clear();
    mutationObservers.forEach(observer => observer.disconnect());
    mutationObservers.clear();
});

const tierData = computed(() => [
    { name: tierlist.activeTierlist.sTierLabel || "S" },
    { name: tierlist.activeTierlist.aTierLabel || "A" },
    { name: tierlist.activeTierlist.bTierLabel || "B" },
    { name: tierlist.activeTierlist.cTierLabel || "C" },
    { name: tierlist.activeTierlist.dTierLabel || "D" },
    { name: tierlist.activeTierlist.eTierLabel || "E" },
    { name: tierlist.activeTierlist.fTierLabel || "F" },
    { 
        name: tierlist.activeTierlist.surgeTierLabel || "Surge", 
        image: tierlist.activeTierlist.surgeTierImage || "./images/surge.png" 
    },
    { 
        name: tierlist.activeTierlist.brunoTierLabel || "Bruno", 
        image: tierlist.activeTierlist.brunoTierImage || "./images/bruno.png" 
    },
    { name: tierlist.activeTierlist.finalTierLabel || "Impossible",  }
]);

const data = computed(() => { 
    const rankedEntries = tierlist.activeFilteredAttempts.filter(entry => {
        // Exclude untracked entries
        if (entry.tags.includes("untracked")) return false;
        // Exclude entries with alternative move types (detected from Pokemon name)
        if (hasAlternativeMoveType(entry.pkmnName)) return false;
        return true;
    });
    // Count unique species (not forms) by extracting base species names
    const uniqueSpecies = new Set(rankedEntries.map(entry => getBaseSpeciesName(entry.pkmnName)));
    
    return {
        groups:      tierlist.groupedEntries, 
        total:       tierlist.activeTierlist.total[tierlist.activeTotalIndex], 
        totalRanked: uniqueSpecies.size,
        labels:      tierlist.labels,
        rankedLabel: tierlist.activeCategory === "first" ? "Ranked" : "Ranked", // TODO: change labels
    };
});

function unselectAll() {
    tierlist.activePkmn = '';
    tierlist.activePrev = '';
    tierlist.selectedPkmn.clear();
}

onUnmounted(unselectAll)

// Threshold editing state
const editingThresholdIndex = ref<number | null>(null);
const editingThresholdOriginalValue = ref<number | null>(null);
const editingThresholdInputValue = ref<string>('');

// Check if current metric supports H:MM:SS editing
const isTimeMetricEditable = computed(() => {
    const metric = tierlist.activeMetric;
    return metric === 'realtime' || metric === 'realtime_0';
});

// Start editing a threshold
function startEditingThreshold(tierIndex: number) {
    if (!isTimeMetricEditable.value) return;
    if (tierIndex === TierlistTierIndex.Impossible) return; // Can't edit "Can't Finish"
    
    const threshold = tierlist.activeThresholdList?.[tierlist.activeThresholdIndex]?.data;
    if (!threshold) return;
    
    let thresholdValue: number;
    if (tierIndex === TierlistTierIndex.Bruno) {
        // Bruno uses the Surge threshold value
        thresholdValue = threshold[TierlistTierIndex.Surge];
    } else {
        thresholdValue = threshold[tierIndex];
    }
    
    editingThresholdIndex.value = tierIndex;
    editingThresholdOriginalValue.value = thresholdValue;
    editingThresholdInputValue.value = formatTimeHMS(thresholdValue, false);
    
    // Auto-focus and select text on next tick
    nextTick(() => {
        const input = document.querySelector('.threshold-input') as HTMLInputElement;
        if (input) {
            input.focus();
            input.select();
        }
    });
}

// Cancel editing and revert to original value
function cancelEditingThreshold() {
    editingThresholdIndex.value = null;
    editingThresholdOriginalValue.value = null;
    editingThresholdInputValue.value = '';
}

// Validate and save threshold value
function saveThresholdValue() {
    if (editingThresholdIndex.value === null) return;
    
    const tierIndex = editingThresholdIndex.value;
    const inputValue = editingThresholdInputValue.value.trim();
    
    // Validate H:MM:SS format
    const hmmssPattern = /^\d+:\d{2}:\d{2}$/;
    if (!hmmssPattern.test(inputValue)) {
        toast.addToast('Invalid time format. Please use H:MM:SS format.', 'error');
        cancelEditingThreshold();
        return;
    }
    
    // Parse the time
    let newValue: number;
    try {
        newValue = parseTime(inputValue);
        if (newValue < 0) {
            throw new Error('Invalid time value');
        }
    } catch (error) {
        toast.addToast('Invalid time format. Please use H:MM:SS format.', 'error');
        cancelEditingThreshold();
        return;
    }
    
    // Update the threshold value
    const thresholdList = tierlist.activeThresholdList;
    if (!thresholdList) {
        cancelEditingThreshold();
        return;
    }
    
    const threshold = thresholdList[tierlist.activeThresholdIndex];
    if (!threshold) {
        cancelEditingThreshold();
        return;
    }
    
    if (tierIndex === TierlistTierIndex.Bruno) {
        // Bruno uses the Surge threshold value
        threshold.data[TierlistTierIndex.Surge] = newValue;
    } else {
        threshold.data[tierIndex] = newValue;
    }
    
    cancelEditingThreshold();
}

// Handle input keydown events
function handleThresholdInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
        event.preventDefault();
        saveThresholdValue();
    } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelEditingThreshold();
    }
}

// Tier label editing state
const editingTierLabelIndex = ref<number | null>(null);
const editingTierLabelInputValue = ref<string>('');

// Property names for tier labels (S-F only, indices 0-6)
const tierLabelProperties = ['sTierLabel', 'aTierLabel', 'bTierLabel', 'cTierLabel', 'dTierLabel', 'eTierLabel', 'fTierLabel'] as const;
const defaultTierLabels = ['S', 'A', 'B', 'C', 'D', 'E', 'F'] as const;

// Start editing a tier label (only for S-F, indices 0-6)
function startEditingTierLabel(tierIndex: number) {
    if (tierIndex < 0 || tierIndex > 6) return; // Only allow S-F tiers
    
    editingTierLabelIndex.value = tierIndex;
    const propertyName = tierLabelProperties[tierIndex];
    const currentValue = tierlist.activeTierlist[propertyName];
    editingTierLabelInputValue.value = currentValue || defaultTierLabels[tierIndex];
    
    // Auto-focus and select text on next tick
    nextTick(() => {
        const input = document.querySelector(`.category.tier-${tierIndex} .label-input`) as HTMLInputElement;
        if (input) {
            input.focus();
            input.select();
        }
    });
}

// Cancel editing and revert to original value
function cancelEditingTierLabel() {
    editingTierLabelIndex.value = null;
    editingTierLabelInputValue.value = '';
}

// Validate and save tier label value
function saveTierLabelValue() {
    if (editingTierLabelIndex.value === null) return;
    
    const tierIndex = editingTierLabelIndex.value;
    const inputValue = editingTierLabelInputValue.value.trim();
    
    // Validate 1-2 characters
    if (inputValue.length < 1 || inputValue.length > 2) {
        toast.addToast('Tier label must be 1-2 characters.', 'error');
        cancelEditingTierLabel();
        return;
    }
    
    // Update the tier label
    const propertyName = tierLabelProperties[tierIndex];
    if (inputValue === defaultTierLabels[tierIndex]) {
        // If it's the default value, delete the property to use fallback
        delete tierlist.activeTierlist[propertyName];
    } else {
        (tierlist.activeTierlist as any)[propertyName] = inputValue;
    }
    
    // Save workspace to persist changes
    workspace.saveWorkspace();
    
    cancelEditingTierLabel();
}

// Handle input keydown events for tier label
function handleTierLabelInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
        event.preventDefault();
        saveTierLabelValue();
    } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelEditingTierLabel();
    }
}

</script>


<template>
    <svg style="display: none;">
        <filter id="outline10">
            <!-- <feMorphology in="SourceAlpha" result="ERODE_1"  operator="erode"  radius="0"></feMorphology> -->
            <!-- <feMorphology in="ERODE_1"     result="DILATE_1" operator="dilate" radius="0"></feMorphology> -->
            <!-- <feMorphology in="DILATE_1"    result="DILATE_2" operator="dilate" radius="2"></feMorphology> -->
            <feMorphology in="SourceAlpha"  result="DILATE_2" operator="dilate" radius="1"></feMorphology>
            <feFlood      flood-color="black" result="COLOR"></feFlood>
            <feComposite  in="COLOR" in2="DILATE_2" operator="in" result="OUTLINE"></feComposite>
            <feMerge>
                <feMergeNode in="OUTLINE" />
                <feMergeNode in="SourceGraphic" />
            </feMerge>
        </filter>
        
        <filter id="outline15">
            <feMorphology in="SourceAlpha"  result="DILATE_2" operator="dilate" radius="1.5"></feMorphology>
            <feFlood      flood-color="black" result="COLOR"></feFlood>
            <feComposite  in="COLOR" in2="DILATE_2" operator="in" result="OUTLINE"></feComposite>
            <feMerge>
                <feMergeNode in="OUTLINE" />
                <feMergeNode in="SourceGraphic" />
            </feMerge>
        </filter>
        
        <filter id="outline20">
            <feMorphology in="SourceAlpha"  result="DILATE_2" operator="dilate" radius="2"></feMorphology>
            <feFlood      flood-color="black" result="COLOR"></feFlood>
            <feComposite  in="COLOR" in2="DILATE_2" operator="in" result="OUTLINE"></feComposite>
            <feMerge>
                <feMergeNode in="OUTLINE" />
                <feMergeNode in="SourceGraphic" />
            </feMerge>
        </filter>
    </svg>

    <div :class="{
            'tier-list rounded': true,
            'no-credits': global.creditMode == CreditMode.NONE,
            'small-credits': global.creditMode == CreditMode.SMALL,
            'big-credits': global.creditMode == CreditMode.BIG,
        }" @click="unselectAll()"
    >
        <template v-for="(group, i) in data.groups" >
            <div :class="'category rounded tier-' + i + (global.hidden ? ' pending' : '')">
                <div 
                    v-if="editingTierLabelIndex !== i"
                    class="label"
                    :class="{ 'label-editable': i <= 6 }"
                    @click.stop="startEditingTierLabel(i)"
                >{{ tierData[i].name }}</div>
                <input
                    v-else
                    v-model="editingTierLabelInputValue"
                    class="label-input"
                    @blur="saveTierLabelValue"
                    @keydown="handleTierLabelInputKeydown"
                    @click.stop
                    autofocus
                    maxlength="2"
                />
                <img v-if="tierData[i].image"
                    class="image" :src="tierData[i].image" />
            </div>
            <div 
                :class="{
                    'entry-row-wrapper': true,
                    ['tier-' + i]: true,
                    'exporting': fileexporter.exportInProgress
                }"
                @wheel="handleWheel($event, i)"
            >
                <div 
                    :class="'entry-row gray-grad rounded tier-' + i" 
                    :ref="(el) => setTierRowRef(el as HTMLElement, i)"
                    @scroll="handleScroll($event, i)"
                >
                    <PkmnImage v-for="entry in group"
                        :key="entry.pkmnName"
                        :pokemon="entry.pkmnName"
                        :neighbor="entry.prev"
                        :active="true"
                        :no-hover="fileexporter.exportInProgress"
                        @click.stop="
                            if (!$event.ctrlKey) {
                                tierlist.activePkmn = entry.pkmnName;
                                tierlist.activePrev = entry.prev;
                                tierlist.selectedPkmn.clear();
                                tierlist.selectedPkmn.add(entry.pkmnName);
                            } else {
                                if (tierlist.selectedPkmn.has(entry.pkmnName)) {
                                    tierlist.selectedPkmn.delete(entry.pkmnName);
                                } else {
                                    tierlist.selectedPkmn.add(entry.pkmnName);
                                }
                            }
                        "
                    >
                        <MetricPopout 
                            v-if="global.popoutActive && tierlist.selectedPkmn.has(entry.pkmnName)"
                            :pokemon="entry.pkmnName"
                            :open-to-top="i >= 7"
                        />
                    </PkmnImage>
                </div>
                <!-- Threshold label -->
                <div 
                    v-if="editingThresholdIndex !== i"
                    class="threshold-label"
                    :class="{ 'threshold-label-editable': isTimeMetricEditable && i !== 9 }"
                    @click.stop="startEditingThreshold(i)"
                >{{ data.labels[i] }}</div>
                <input
                    v-else
                    v-model="editingThresholdInputValue"
                    class="threshold-input"
                    @blur="saveThresholdValue"
                    @keydown="handleThresholdInputKeydown"
                    @click.stop
                    autofocus
                />
                <!-- Left fade overlay -->
                <div 
                    v-if="tierScrollState[i]?.canScroll && tierScrollState[i]?.left > 0"
                    class="fade-left"
                    :style="{ opacity: tierScrollState[i]?.left ?? 0 }"
                ></div>
                <!-- Right fade overlay - visible when tier has overflow -->
                <div 
                    v-if="tierScrollState[i]?.canScroll"
                    class="fade-right"
                ></div>
                <!-- Custom overlay scrollbar -->
                <div 
                    v-if="tierScrollState[i]?.canScroll"
                    class="scroll-track"
                    @mousedown.prevent="startScrollDrag($event, i)"
                >
                    <div 
                        class="scroll-thumb"
                        :style="{
                            left: (tierScrollState[i]?.thumbLeft ?? 0) + '%',
                            width: (tierScrollState[i]?.thumbWidth ?? 10) + '%'
                        }"
                        @mousedown.prevent.stop="startThumbDrag($event, i)"
                    ></div>
                </div>
            </div>
        </template>
        <div :class="'ranked gray-grad rounded'">
            <span>{{ data.rankedLabel }}:</span>
            <span>{{ data.totalRanked }}/{{ data.total }}</span>
        </div>
        <div class="credits-box"></div>
    </div>
</template>


<style scoped>
.rounded {
    border-radius: 11px;
}

.gray-grad {
    background: linear-gradient(#2a2a2a, #1c1c1c);
}

.tier-list {
    width: 100%;
    height: 100%;

    background-color: #010101;
    padding: 10px;

    display: grid;
    grid-template-columns: auto 1fr 217px 715px;
    grid-template-rows: auto;
    gap: 10px;
}

.small-credits.tier-list {
    grid-template-columns: auto 1fr 217px 531px;
}

.no-credits.tier-list {
    grid-template-columns: auto 1fr 0px 217px;
}

.category {
    position: relative;
    width: 106px;
    height: 93px;

    font-size: 106px;
    line-height: 1.05em;
    color: #000000;
    font-weight: 700;
    font-family: 'Teko', sans-serif;

    color: black;
    overflow: hidden;

    display: flex;
    align-items: center;
    justify-content: center;

    box-shadow:
        inset  2px  2px 4px 0px #ffffff20,
        inset -3px -3px 3px 0px #00000040;
}

.category .label {
    position: absolute;
    inset: 0;
    text-align: center;
    font-family: 'Teko', sans-serif;
    font-weight: 700;
}

.category .label.label-editable {
    cursor: pointer;
    transition: opacity 0.2s;
}

.category .label.label-editable:hover {
    opacity: 0.7;
}

.category .label-input {
    position: absolute;
    inset: 0;
    text-align: center;
    background: rgba(0, 0, 0, 0.5);
    border: 2px solid rgba(255, 255, 255, 0.5);
    border-radius: 11px;
    font-size: 106px;
    line-height: 1.05em;
    color: #000000;
    font-weight: 700;
    font-family: 'Teko', sans-serif;
    outline: none;
    padding: 0;
    margin: 0;
    width: 100%;
    height: 100%;
    z-index: 10;
}

.category .label-input:focus {
    border-color: rgba(255, 255, 255, 0.8);
    background: rgba(0, 0, 0, 0.7);
}

.category.tier-9 .label-input {
    font-size: 26px;
    transform: rotate(-40deg) translate(-4px, -7px);
    font-family: 'Teko', sans-serif;
    font-weight: 700;
}

/* Wrapper for entry row with fade effects */
.entry-row-wrapper {
    position: relative;
    grid-column: span 3;
    overflow: hidden;
    border-radius: 11px;
    min-height: 93px;
}

.entry-row {
    position: relative;
    padding: 3px 6px;
    padding-right: 135px; /* Extra space on right to avoid threshold label overlap */
    height: 100%;
    min-height: 93px;

    display: flex;
    gap: 2px;
    flex-direction: row;
    flex-wrap: nowrap;
    image-rendering: optimizeQuality;
    align-items: flex-end;
    
    /* Scrolling behavior */
    overflow-x: auto;
    overflow-y: hidden;
    scroll-behavior: smooth;
    
    /* Hide scrollbar by default */
    scrollbar-width: none;
    -ms-overflow-style: none;
}

.entry-row::-webkit-scrollbar {
    height: 0;
    background: transparent;
}

/* Custom overlay scrollbar (only when not exporting) */
.entry-row-wrapper:not(.exporting) .scroll-track {
    display: none;
    position: absolute;
    bottom: 4px;
    left: 10px;
    right: 10px;
    height: 10px;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 5px;
    z-index: 200;
    cursor: pointer;
}

.entry-row-wrapper:not(.exporting):hover .scroll-track {
    display: block;
}

/* Hide scrollbar during export */
.entry-row-wrapper.exporting .scroll-track {
    display: none !important;
}

.entry-row-wrapper:not(.exporting) .scroll-thumb {
    position: absolute;
    top: 0;
    height: 100%;
    background: rgba(255, 255, 255, 0.5);
    border-radius: 5px;
    pointer-events: auto;
    cursor: grab;
    transition: background 0.15s;
    z-index: 201;
}

.entry-row-wrapper:not(.exporting) .scroll-thumb:hover {
    background: rgba(255, 255, 255, 0.7);
}

.entry-row-wrapper:not(.exporting) .scroll-thumb:active {
    cursor: grabbing;
    background: rgba(255, 255, 255, 0.8);
}

/* Fade overlays */
.fade-left,
.fade-right {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 60px;
    pointer-events: none;
    z-index: 5;
    transition: opacity 0.15s ease-out;
}

.fade-left {
    left: 0;
    background: linear-gradient(to right, rgba(28, 28, 28, 1) 0%, rgba(28, 28, 28, 0) 100%);
    border-radius: 11px 0 0 11px;
}

.fade-right {
    right: 0;
    width: 170px;
    background: linear-gradient(to left, 
        rgba(28, 28, 28, 1) 0%, 
        rgba(28, 28, 28, 0.95) 30%, 
        rgba(28, 28, 28, 0.85) 50%, 
        rgba(28, 28, 28, 0.6) 70%,
        rgba(28, 28, 28, 0.3) 85%,
        rgba(28, 28, 28, 0) 100%
    );
    border-radius: 0 11px 11px 0;
}

/* Hide fade overlays during export */
.entry-row-wrapper.exporting .fade-left,
.entry-row-wrapper.exporting .fade-right {
    display: none;
}

/* Threshold label - positioned via wrapper */
.entry-row-wrapper .threshold-label {
    position: absolute;
    top: 50%;
    right: 7px;
    transform: translateY(-50%);
    z-index: 6;
    pointer-events: none;
}

.entry-row-wrapper .threshold-label.threshold-label-editable {
    pointer-events: auto;
    cursor: pointer;
    transition: opacity 0.2s;
}

.entry-row-wrapper .threshold-label.threshold-label-editable:hover {
    opacity: 0.6;
}

.entry-row-wrapper .threshold-input {
    position: absolute;
    top: 50%;
    right: 7px;
    transform: translateY(-50%);
    z-index: 7;
    pointer-events: auto;
    
    font-size: 30px;
    color: #ffffff;
    font-weight: 700;
    font-family: 'Play', sans-serif;
    background: rgba(0, 0, 0, 0.5);
    border: 2px solid rgba(255, 255, 255, 0.5);
    border-radius: 5px;
    padding: 4px 8px;
    outline: none;
    min-width: 100px;
    text-align: center;
}

.entry-row-wrapper .threshold-input:focus {
    border-color: rgba(255, 255, 255, 0.8);
    background: rgba(0, 0, 0, 0.7);
}

.entry-row-wrapper .threshold-label {
    position: absolute;
    top: 50%;
    right: 7px;
    transform: translateY(-50%);
    z-index: 6;
    pointer-events: none;

    font-size: 30px;
    color: #ffffff;
    font-weight: 700;
    font-family: "play";
    opacity: 0.388;
    filter: drop-shadow(0 0 9px rgba(0,0,0,0.69));
}

.ranked {
    display: flex;
    flex-direction: column;
    justify-content: center;
    color: #919191;
    line-height: 1;
    font-family: "play";
}
.ranked span:nth-child(1) {
    margin-top: 5px;
    font-size: 30px;
}
.ranked span:nth-child(2) {
    margin-top: -4px;
    font-size: 44px;
}

.credits-box {
    grid-row: 7 / span 4;
    grid-column: 4;
    background-color: red;
    opacity: 0.380;
    opacity: 0;
}


.small-credits .credits-box {
    grid-row: 8 / span 3;
}

.no-credits .credits-box {
    display: none;
}


.entry-row-wrapper.tier-6 { grid-column: span 2; }
.entry-row-wrapper.tier-7 { grid-column: span 2; }
.entry-row-wrapper.tier-8 { grid-column: span 2; }
.entry-row-wrapper.tier-9 { grid-column: span 1; }

.small-credits .entry-row-wrapper.tier-6 { grid-column: span 3; }

.no-credits .entry-row-wrapper.tier-6 { grid-column: span 3; }
.no-credits .entry-row-wrapper.tier-7 { grid-column: span 3; }
.no-credits .entry-row-wrapper.tier-8 { grid-column: span 3; }
.no-credits .entry-row-wrapper.tier-9 { grid-column: span 2; }

.category.tier-0 { background: linear-gradient(#fe0000, #d10000); }
.category.tier-1 { background: linear-gradient(#fb9a3b, #d8802a); }
.category.tier-2 { background: linear-gradient(#fce10e, #c8b206); }
.category.tier-3 { background: linear-gradient(#91e261, #5bab2c); }
.category.tier-4 { background: linear-gradient(#7eacfa, #4776c5); }
.category.tier-5 { background: linear-gradient(#703edd, #5728bf); }
.category.tier-6 { background: linear-gradient(#7f337e, #6b276a); }
.category.tier-7 { background: linear-gradient(#6c003d, #4a002a); }
.category.tier-8 { background: linear-gradient(#920019, #630213); }
.category.tier-9 { background: linear-gradient(#634809, #503a06); }

.category .image {
    max-width: 56px;
    max-height: 56px;
    width: auto;
    height: auto;
    object-fit: contain;
}

.category.tier-7 .label,
.category.tier-8 .label {
    font-size: 30px;
    line-height: 140%;
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    top: auto;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 2px;
    z-index: 10;
    opacity: 0;
    font-family: 'Teko', sans-serif;
    font-weight: 700;
}

.category.tier-7 .image,
.category.tier-8 .image {
    width: calc(100% - 8px);
    height: calc(100% - 8px);
    max-width: none;
    max-height: none;
    object-fit: contain;
    margin: 4px;
    opacity: 0.871;
    filter: drop-shadow(0 0 3px rgba(0,0,0,0.56));
    image-rendering: pixelated;
    position: absolute;
    top: 0;
    left: 0;
}
.category.tier-9 .label {
    transform: rotate(-40deg) translate(-4px, -7px);
    font-size: 26px;
    font-family: 'Teko', sans-serif;
    font-weight: 700;
}

.category.pending  {
    background: linear-gradient(#2a2a2a, #1c1c1c);
    color: #ffffff08;
}
.category.pending .label {
    transform: unset;

    font-size: 106px;
    line-height: 1.05em;
    font-family: 'Teko', sans-serif;
    font-weight: 700;
}
.category.pending .image {
    display: none;
}
</style>
