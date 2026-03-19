import { ref, computed } from "vue";
import { defineStore } from "pinia";
import type { Metrics } from "./tierlist";

export type PendingInsertion = {
    pokemon: string;
    attempt: Partial<Metrics>;
};

export type PositionSnapshot = {
    tierIndex: number;
    indexInTier: number;
};

export const enum RerankPhase {
    IDLE = 0,
    FADE_OUT = 1,
    COLLAPSE_GAP = 2,
    OPEN_SPACE = 3,
    FADE_IN = 4,
    HIGHLIGHT = 5,
}

export const useReranking = defineStore("reranking", () => {
    // Buffer of pending insertions (accumulated while animate reranking is on)
    const pendingInsertions = ref<PendingInsertion[]>([]);

    // Snapshot of positions BEFORE the data change is applied
    // Maps pokemon name -> { tierIndex, indexInTier }
    const oldPositions = ref<Map<string, PositionSnapshot>>(new Map());

    // Current animation phase
    const phase = ref<RerankPhase>(RerankPhase.IDLE);

    // The pokemon currently being animated (the one that moved)
    const animatingPokemon = ref<string>("");

    // Old tier index and new tier index for the animating pokemon
    const oldTierIndex = ref<number>(-1);
    const newTierIndex = ref<number>(-1);

    // Whether we're currently in an animation sequence
    const isAnimating = computed(() => phase.value !== RerankPhase.IDLE);

    // Whether we're in the process of committing buffered insertions (bypass re-buffering)
    const committing = ref(false);

    // Whether there are pending insertions waiting to be committed
    const hasPending = computed(() => pendingInsertions.value.length > 0);

    function addPendingInsertion(pokemon: string, attempt: Partial<Metrics>) {
        pendingInsertions.value.push({ pokemon, attempt });
    }

    function clearPending() {
        pendingInsertions.value = [];
    }

    function snapshotPositions(groups: { pkmnName: string }[][]) {
        const map = new Map<string, PositionSnapshot>();
        for (let tierIndex = 0; tierIndex < groups.length; tierIndex++) {
            for (let idx = 0; idx < groups[tierIndex].length; idx++) {
                map.set(groups[tierIndex][idx].pkmnName, { tierIndex, indexInTier: idx });
            }
        }
        oldPositions.value = map;
    }

    function startAnimation(pokemon: string, oldTier: number, newTier: number) {
        animatingPokemon.value = pokemon;
        oldTierIndex.value = oldTier;
        newTierIndex.value = newTier;
        phase.value = RerankPhase.FADE_OUT;
    }

    function setPhase(newPhase: RerankPhase) {
        phase.value = newPhase;
    }

    function finishAnimation() {
        phase.value = RerankPhase.IDLE;
        animatingPokemon.value = "";
        oldTierIndex.value = -1;
        newTierIndex.value = -1;
        oldPositions.value = new Map();
    }

    return {
        pendingInsertions,
        oldPositions,
        phase,
        animatingPokemon,
        oldTierIndex,
        newTierIndex,
        isAnimating,
        committing,
        hasPending,
        addPendingInsertion,
        clearPending,
        snapshotPositions,
        startAnimation,
        setPhase,
        finishAnimation,
    };
});
