import { AxiosError } from "axios";

export type BigNumberish = string | number | bigint;

export type BalanceUnit = "WEI" | "FRI";

export interface PredeployedAccount {
    balance: {
        [key: string]: { amount: string; unit: BalanceUnit };
    };
    initial_balance: string;
    private_key: string;
    public_key: string;
    address: string;
}

export class DevnetProviderError extends Error {
    constructor(msg: string) {
        super(msg);

        // Set the prototype explicitly.
        Object.setPrototypeOf(this, DevnetProviderError.prototype);
    }

    public static fromAxiosError(err: AxiosError) {
        if (err.code === AxiosError.ECONNABORTED) {
            return new this(
                `${err.message}. Try specifying a greater timeout in DevnetProvider({...})`,
            );
        }

        throw new Error(`Cannot create a DevnetProviderError from ${err}`);
    }
}

export class DevnetError extends Error {
    constructor(msg: string) {
        super(msg);

        // Set the prototype explicitly.
        Object.setPrototypeOf(this, DevnetError.prototype);
    }
}

export class GithubError extends Error {
    constructor(msg: string) {
        super(`Unexpected response from GitHub: ${msg}`);

        // Set the prototype explicitly.
        Object.setPrototypeOf(this, GithubError.prototype);
    }
}

export type BlockTag = "latest" | "pre_confirmed" | "l1_accepted";

/**
 * If string is one of {"latest", "pre_confirmed", "l1_accepted"}, interpreted as block tag.
 * If number, interpreted as block number.
 * If hex string, interpreted as block hash.
 */
export type BlockId = BlockTag | number | string;

export function toRpcBlockId(blockId: BlockId) {
    if (
        typeof blockId === "string" &&
        ["latest", "pre_confirmed", "l1_accepted"].includes(blockId)
    ) {
        return blockId;
    } else if (typeof blockId === "number" && blockId >= 0) {
        return { block_number: blockId };
    } else if (typeof blockId === "string" && /0[xX][a-fA-F0-9]+/.test(blockId)) {
        return { block_hash: blockId };
    }

    throw new DevnetProviderError(`Invalid block ID: ${blockId}`);
}
