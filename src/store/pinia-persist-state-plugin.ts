import { type PiniaPlugin } from 'pinia'


declare module 'pinia' {
    export interface DefineStoreOptionsBase<S extends StateTree, Store> {
        persist?: 'temp' | 'file' | false
        exclude?: string[]
    }
}

const STORAGES: Record<'temp' | 'file', {
    get: <T>(key: string) => T
    set: (key: string, value: any) => void
    clear: () => void
}> = {
    temp: {
        get: (key) => JSON.parse(localStorage.getItem(key) ?? "{}"),
        set: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
        clear: () => localStorage.clear(),
    },
    file: {
        get: () => { throw new Error('Not implemented') },
        set: () => { throw new Error('Not implemented') },
        clear: () => { throw new Error('Not implemented') },
    }
}

export const PiniaPersistStatePlugin: PiniaPlugin = (context) => {
    const {
        options: {
            persist = undefined,
            exclude = undefined
        },
        store,
        pinia,
    } = context

    if (!persist)
        return

    if(!['temp', 'file'].includes(persist)) {
        console.warn(`[PersistedStatePlugin] Invalid value: ${persist}, Expected one of ['temp', 'file']`)
        return
    }

    const key = store.$id
    const storage = STORAGES[persist];

    // HMR handling, ignores stores created as "hot" stores
    if (!(store.$id in pinia.state.value)) {
        debugger;
        const key = store.$id.replace('__hot:', '')
        // @ts-expect-error `_s is a stripped @internal`
        const original_store = pinia._s.get(key)
        if (original_store) {
            Promise.resolve().then(() => {
                const value = { ...original_store.$state };
                exclude?.forEach(key => delete value[key])
                storage.set(key, value)
            })
        }
        return
    }

    // load state from storage
    store.$patch(storage.get(key))

    // save state to storage on mutation
    store.$subscribe((_, state) => {
        const value = { ...state };
        exclude?.forEach(key => delete value[key])
        storage.set(key, value)
    }, { detached: true })
}
