import { readonly, ref } from "vue";
import { defineStore } from "pinia";

export type ContextMenuOptionArg = {
    label: string | (() => string)
    action?: () => boolean | void | undefined
    hidden?: boolean | (() => boolean)
    /** The action's id in SHORTCUT_ACTIONS, which makes it reachable from the keyboard. */
    id?: string
    /** Reachable from the keyboard only, not listed in the menu. */
    keyOnly?: boolean
};

export type ContextMenuOption = {
    get label(): string
    get hidden(): boolean
    action(): boolean | void | undefined
    id: string
    keyOnly: boolean
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
                id: option.id ?? "",
                keyOnly: option.keyOnly ?? false,
            };
            newOptions.push(o);
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
