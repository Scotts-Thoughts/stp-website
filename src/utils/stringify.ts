// Note: This regex matches even invalid JSON strings, but since we’re
// working on the output of `JSON.stringify` we know that only valid strings
// are present (unless the user supplied a weird `options.indent` but in
// that case we don’t care since the output would be invalid anyway).

const stringOrChar = /("(?:[^\\"]|\\.)*")|[:,]/g;

export default function stringify(passedObj: any, options: {
    indent?: number | string;
    maxLength?: number;
} = {}) {
    const indent = typeof options.indent === "string" ? options.indent :
        ' '.repeat(options.indent === undefined ? 2 : options.indent);

    const maxLength = 
        indent === ""
            ? Infinity
            : options.maxLength === undefined
            ? 80
            : options.maxLength;

    return (function _stringify(obj: any, currentIndent: string, reserved: number): string {
        if (obj && typeof obj.toJSON === "function") {
            obj = obj.toJSON();
        }

        const string = JSON.stringify(obj);

        if (string === undefined) {
            return string;
        }

        const length = maxLength - currentIndent.length - reserved;

        if (string.length <= length) {
            const prettified = string.replace(
                stringOrChar,
                (match, stringLiteral) => {
                    return stringLiteral || `${match} `;
                }
            );
            if (prettified.length <= length) {
                return prettified;
            }
        }

        if (typeof obj === "object" && obj !== null) {
            const nextIndent = currentIndent + indent;
            const items = [];
            let index = 0;
            let start;
            let end;

            if (Array.isArray(obj)) {
                start = "[";
                end = "]";
                const { length } = obj;
                for (; index < length; index++) {
                    items.push(
                        _stringify(obj[index], nextIndent, index === length - 1 ? 0 : 1) ||
                            "null"
                    );
                }
            } else {
                start = "{";
                end = "}";
                const keys = Object.keys(obj);
                const { length } = keys;
                for (; index < length; index++) {
                    const key = keys[index];
                    const keyPart = `${JSON.stringify(key)}: `;
                    const value = _stringify(
                        obj[key],
                        nextIndent,
                        keyPart.length + (index === length - 1 ? 0 : 1)
                    );
                    if (value !== undefined) {
                        items.push(keyPart + value);
                    }
                }
            }

            if (items.length > 0) {
                return [start, indent + items.join(`,\r\n${nextIndent}`), end].join(
                    `\r\n${currentIndent}`
                );
            }
        }

        return string;
    })(passedObj, "", 0);
}
