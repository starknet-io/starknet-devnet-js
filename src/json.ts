// `JSON.rawJSON` and the reviver `context` argument (JSON.parse source text access) are supported
// since Node.js 21, but are not yet part of TypeScript's standard library declarations.
type Reviver = (key: string, value: unknown, context?: { source?: string }) => unknown;
const jsonWithSource = JSON as unknown as {
    parse(text: string, reviver: Reviver): unknown;
    rawJSON?: (text: string) => unknown;
};

/**
 * Parse JSON, keeping integers that cannot be represented exactly as a JS number. Such integers are
 * kept as raw JSON values, which `JSON.stringify` serializes back to their original digits.
 * Falls back to regular `JSON.parse` where the runtime does not support this.
 */
export function parseJsonPreservingIntegers(text: string): unknown {
    const rawJSON = jsonWithSource.rawJSON;
    if (rawJSON === undefined) {
        return JSON.parse(text);
    }

    return jsonWithSource.parse(text, (_key, value, context) => {
        if (
            typeof value === "number" &&
            !Number.isSafeInteger(value) &&
            context?.source !== undefined &&
            /^-?\d+$/.test(context.source)
        ) {
            return rawJSON(context.source);
        }
        return value;
    });
}
