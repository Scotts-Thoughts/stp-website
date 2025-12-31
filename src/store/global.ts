import { ref } from "vue";
import { defineStore } from "pinia";

export const enum CreditMode { NONE = 0, SMALL = 1, BIG = 2, MAX = 3 }

export const useGlobal = defineStore("global", () => {
    const hidden = ref(false);
    const popoutActive = ref(true);
    const creditMode = ref(CreditMode.NONE);
    const obsPresent = (globalThis as any).obsstudio !== undefined;

    const cycleCreditModes = () => {
        creditMode.value = (creditMode.value + 1) % CreditMode.MAX
    }

    return {
        hidden,
        popoutActive,
        obsPresent,
        creditMode,
        cycleCreditModes
    }
}, {
    persist: 'temp',
    exclude: ['obsPresent']
});
