export {};

declare global {
    interface Array<T> {
        min(): T;
        at(index: number): T | undefined;

        union(array: T[]): T[];
        intersection(array: T[]): T[];
        difference(array: T[]): T[];
    }
}

Array.prototype.min = function() {
    return Math.min.apply(null, this);
}

if (Array.prototype.at === undefined) {
    Array.prototype.at = function(index: number) {
        if (index < 0) {
            index += this.length;
        }
        return this[index];
    }
}

Array.prototype.union = function(array) {
    return Array.from(new Set([...this, ...array]));
}

Array.prototype.intersection = function(array) {
    return this.filter(value => array.includes(value));
}

Array.prototype.difference = function(array) {
    return this.filter(value => !array.includes(value));
}
