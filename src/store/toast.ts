import { readonly, ref } from 'vue';

import { defineStore } from 'pinia';

type Toast = {
    id: number
    message: string
    type: "info" | "success" | "warning" | "error"
    pending: boolean
    timeoutId: number
}

export const useToast = defineStore("toast", () => {
    const toasts = ref<Toast[]>([]);
    const nextToastId = ref<number>(0);

    function addToast(
        message: string, 
        type: "info" | "success" | "warning" | "error", 
        options: {
            timeout?: number
            pending?: boolean
        } = {})
    {
        const timeout = options.timeout ?? 5000;
        const pending = options.pending ?? false;

        const id = nextToastId.value++;
        let timeoutId: ReturnType<typeof setTimeout> | number = -1;
        if (timeout > 0) {
            timeoutId = window.setTimeout(() => {
                toasts.value = toasts.value.filter(t => t.id !== id);
            }, timeout);
        }
        toasts.value.push({ id, message, type, timeoutId, pending });

        return id;
    }

    function removeToast(id: number) {
        const toast = toasts.value.find(t => t.id === id);
        if (!toast) return;
        if (toast.timeoutId !== -1)
            clearTimeout(toast.timeoutId);
        toasts.value = toasts.value.filter(t => t.id !== id);
    }

    return {
        toasts: readonly(toasts),
        addToast,
        removeToast,
    }
})
