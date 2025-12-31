import { readonly, ref } from "vue";
import { defineStore } from "pinia";

export type ContextMenuOptionArg = {
    label: string | (() => string)
    action?: () => boolean | void | undefined
    hidden?: boolean | (() => boolean)
    shortcut?: string
};

export type ContextMenuOption = {
    get label(): string
    get hidden(): boolean
    action(): boolean | void | undefined
    shortcut: {
        key: string
        ctrl: boolean
        shift: boolean
        alt: boolean
    },
    shortcutString: string
};


export const useContextMenu = defineStore("contextmenu", () => {
    const visible = ref(false);
    const pos = ref({ x: 0, y: 0 });
    const options = ref<ContextMenuOption[]>([]);
    const shortcutsActive = ref(true);

    function show(x: number, y: number) {
        pos.value = { x, y };
        visible.value = options.value.length > 0;
    }

    function hide() {
        visible.value = false;
    }

    function setOptions(_options: ContextMenuOptionArg[]) {
        const NO_SHORTCUT = { key: "", ctrl: false, shift: false, alt: false };
        const newOptions = [];
        for (const option of _options) {
            const o: ContextMenuOption = {
                get label() {
                    return typeof option.label === "function" ? option.label() : option.label;
                },
                get hidden() {
                    if (option.hidden === undefined)
                        return false;
                    if (typeof option.hidden === "function")
                        return option.hidden();
                    return option.hidden;
                },
                action: option.action ?? (() => {}),
                shortcut: NO_SHORTCUT,
                shortcutString: "",
            };
            newOptions.push(o);

            if (!option.action || !option.shortcut) {
                continue;
            }

            const parts = option.shortcut.toLowerCase().split("+").map(p => p.trim());
            const ctrl = parts.includes("ctrl");
            const shift = parts.includes("shift");
            const alt = parts.includes("alt");
            const keys = parts.filter(k => !["ctrl", "shift", "alt"].includes(k));

            if (keys.length !== 1) {
                console.warn("Invalid shortcut:", option.shortcut);
                continue;
            }

            o.shortcut = { key: keys[0], ctrl, shift, alt };
            o.shortcutString = `${ctrl ? "Ctrl+" : ""}${shift ? "Shift+" : ""}${alt ? "Alt+" : ""}${keys[0].toUpperCase()}`;
        }
        options.value = newOptions;
    }

    function clearOptions() {
        options.value = [];
    }

    return {
        isVisible: readonly(visible),
        pos: readonly(pos),
        options: readonly(options),
        shortcutsActive,
        show,
        hide,
        setOptions,
        clearOptions,
    }
});
