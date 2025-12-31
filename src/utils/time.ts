
export function formatDate(date: number): string {
    if (date < 0) 
        return "1970-01-01";
    return new Date(date).toISOString().slice(0, 10);
}

export function parseDate(date?: string): number {
    if (!date) return -1;
    const dateNumber = new Date(date).getTime();
    if (isNaN(dateNumber))
        return -1;
    return dateNumber;
}

// returns the current date in the format 'YYYY-MM-DD'
export function currentDate(): string {
    const date = new Date();
    return formatDate(date.getTime() - date.getTimezoneOffset()*60*1000);
}

/**
 * This function can parse strings in the following formats:
 * - `h:mm:ss.xxx`
 * - `h:mm:ss.xx`
 * - `mm:ss.xxx`
 * - `mm:ss.xx`
 * - `ss.xxx`
 * - `ss.xx`
 * - `h:mm:ss` or `hh:mm:ss` (determined by first part length: 1 digit = H:MM:SS, 2 digits = HH:MM:SS)
 * - `mm:ss` (2 parts without decimal is always MM:SS, not H:MM)
 * @returns The time in milliseconds
 */
export function parseTime(time?: string): number {
    if (!time) return -1;
    if (time === "") return -1;
    if (time === "-1") return -1;

    const [l, r] = time.split('.');
    const parts = l.split(':');

    let h = 0, m = 0, s = 0, ms = 0;
    if (r) {
        if (r.length === 2) {
            ms = Number(r) * 10;
        } else if (r.length === 3) {
            ms = Number(r);
        } else {
            throw new Error('Invalid time format');
        }
        if (parts.length === 3) {
            h = Number(parts[0]);
            m = Number(parts[1]);
            s = Number(parts[2]);
        } else if (parts.length === 2) {
            m = Number(parts[0]);
            s = Number(parts[1]);
        } else if (parts.length === 1) {
            s = Number(parts[0]);
        } else {
            throw new Error('Invalid time format');
        }
    } else {
        if (parts.length === 3) {
            // For 3 parts: check first part length to determine format
            // X:XX:XX = H:MM:SS, XX:XX:XX = HH:MM:SS
            h = Number(parts[0]);
            m = Number(parts[1]);
            s = Number(parts[2]);
        } else if (parts.length === 2) {
            // For 2 parts without decimal: always treat as MM:SS (not H:MM)
            m = Number(parts[0]);
            s = Number(parts[1]);
        } else {
            throw new Error('Invalid time format');
        }
    }

    return ((h * 60 + m) * 60 + s) * 1000 + ms;
}

/**
 * This function parses game time strings, which use a different format than real time:
 * - `h:mm:ss.xxx`
 * - `h:mm:ss.xx`
 * - `h:mm` (2 parts without decimal is always H:MM, not MM:SS)
 * - `h:mm:ss` or `hh:mm:ss` (determined by first part length: 1 digit = H:MM:SS, 2 digits = HH:MM:SS)
 * @returns The time in milliseconds
 */
export function parseGameTime(time?: string): number {
    if (!time) return -1;
    if (time === "") return -1;
    if (time === "-1") return -1;

    const [l, r] = time.split('.');
    const parts = l.split(':');

    let h = 0, m = 0, s = 0, ms = 0;
    if (r) {
        if (r.length === 2) {
            ms = Number(r) * 10;
        } else if (r.length === 3) {
            ms = Number(r);
        } else {
            throw new Error('Invalid time format');
        }
        if (parts.length === 3) {
            h = Number(parts[0]);
            m = Number(parts[1]);
            s = Number(parts[2]);
        } else if (parts.length === 2) {
            m = Number(parts[0]);
            s = Number(parts[1]);
        } else if (parts.length === 1) {
            s = Number(parts[0]);
        } else {
            throw new Error('Invalid time format');
        }
    } else {
        if (parts.length === 3) {
            // For 3 parts: check first part length to determine format
            // X:XX:XX = H:MM:SS, XX:XX:XX = HH:MM:SS
            h = Number(parts[0]);
            m = Number(parts[1]);
            s = Number(parts[2]);
        } else if (parts.length === 2) {
            // For 2 parts without decimal: treat as HH:MM (not MM:SS)
            h = Number(parts[0]);
            m = Number(parts[1]);
        } else {
            throw new Error('Invalid time format');
        }
    }

    return ((h * 60 + m) * 60 + s) * 1000 + ms;
}

export function splitTime(ms: number): [h: number, m: number, s: number, cs: number, ms: number] {
    const h = Math.floor(ms / 3600000);
    ms %= 3600000;
    const m = Math.floor(ms / 60000);
    ms %= 60000;
    const s = Math.floor(ms / 1000);
    ms %= 1000;
    const cs = Math.floor(ms / 10);
    return [h, m, s, cs, ms];
}

export function formatTimeHM(ms: number): string {
    if (ms < 0) return '-1';
    const [h, m] = splitTime(ms);
    return `${h}:${m.toString().padStart(2, '0')}`;
}

export function formatTimeHMS(ms: number, trimZero = true): string {
    if (ms < 0) return '-1';
    const [h, m, s] = splitTime(ms);
    if (h != 0 || !trimZero) 
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    else
        return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatTimeFull(ms: number, trimZero = true): string {
    if (ms < 0) return '-1';
    const [h, m, s, cs] = splitTime(ms);
    if (h != 0 || !trimZero)
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
    else if (m != 0)
        return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
    else
        return `${s}.${cs.toString().padStart(2, '0')}`;
}
