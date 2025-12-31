export function debounced<T extends (...args: any[]) => any>(fn: T, delay: number = 100): T {
    let timeout: number | undefined;
    return function (this: any, ...args: any) {
        if (timeout !== undefined) clearTimeout(timeout);
        timeout = window.setTimeout(() => fn.apply(this, args), delay) as unknown as number;
    } as any;
}
