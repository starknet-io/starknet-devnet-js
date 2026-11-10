import axios, { AxiosInstance } from "axios";
import { readFile, writeFile } from "fs/promises";
import { Postman } from "./postman";
import { Cheats } from "./cheats";
import { Proofs } from "./proofs";
import { RpcProvider } from "./rpc-provider";
import {
    BalanceUnit,
    BlockId,
    DevnetProviderError,
    PredeployedAccount,
    toRpcBlockId,
} from "./types";
import { ApplyStateDiffResponse, StateDiffInput, SuppliedClass } from "./state-mutation";
import { DEFAULT_DEVNET_URL, DEFAULT_HTTP_TIMEOUT } from "./constants";

export type DevnetProviderConfig = {
    url?: string;
    /** milliseconds */
    timeout?: number;
};

export type MintResponse = {
    new_balance: bigint;
    unit: BalanceUnit;
    tx_hash: string;
};

export interface NewBlockResponse {
    block_hash: string;
}

export interface AbortedBlocksResponse {
    aborted: Array<string>;
}

export interface AcceptedOnL1BlocksResponse {
    accepted: Array<string>;
}

export interface SetTimeResponse {
    time: number;
    block_hash?: string;
}

export interface IncreaseTimeResponse {
    time: number;
    block_hash: string;
}

/**
 * A serialized Devnet instance, as returned by `dump` and accepted by `load`. It is plain JSON, so
 * it can be stored with `JSON.stringify` and restored with `JSON.parse`. Apart from the header
 * fields, treat it as opaque: its format is defined by Devnet.
 */
export interface DevnetDump {
    format: string;
    version: number;
    /** Dumps can only be loaded by the same Devnet release. */
    devnet_version: string;
    [field: string]: unknown;
}

/**
 * @deprecated A state-changing request recorded by Devnet before v0.11.0, part of a {@link LegacyDevnetDump}.
 */
export interface DumpedEvent {
    jsonrpc: string;
    method: string;
    params?: unknown;
    id: string | number | null;
}

/**
 * @deprecated A dump produced by Devnet before v0.11.0. Devnet still loads it, by re-executing its
 * requests, during a transition period.
 */
export type LegacyDevnetDump = Array<DumpedEvent>;

export interface ForkStatus {
    url?: string;
    block?: number;
}

export interface DevnetStatus {
    block_count: number;
    /** Includes pre-confirmed transactions. */
    transaction_count: number;
    pre_confirmed_tx_count: number;
    chain_id: string;
    /** The JSON-RPC specification version. */
    protocol_version: string;
    /** The version of the running Devnet. */
    devnet_version: string;
    is_forked: boolean;
    /** Present only if forking. */
    fork_config?: ForkStatus;
    impersonated_accounts: Array<string>;
    auto_impersonate: boolean;
}

export interface GasModificationResponse {
    l1_gas_price?: bigint;
    l1_data_gas_price?: bigint;
    l2_gas_price?: bigint;
}

export class DevnetProvider {
    public readonly url: string;
    private httpProvider: AxiosInstance;
    private rpcProvider: RpcProvider;

    /** Contains methods for L1-L2 communication. */
    public readonly postman: Postman;

    /** Contains methods for cheating, e.g. account impersonation. */
    public readonly cheats: Cheats;

    /** Contains methods for transaction proofs. */
    public readonly proofs: Proofs;

    public constructor(config?: DevnetProviderConfig) {
        this.url = config?.url || DEFAULT_DEVNET_URL;
        this.httpProvider = axios.create({
            baseURL: this.url,
            timeout: config?.timeout ?? DEFAULT_HTTP_TIMEOUT,
        });
        this.rpcProvider = new RpcProvider(this.httpProvider, this.url);
        this.postman = new Postman(this.rpcProvider);
        this.cheats = new Cheats(this.rpcProvider);
        this.proofs = new Proofs(this.rpcProvider);
    }

    /**
     * @returns `true` if the underlying Devnet instance is responsive; `false` otherwise
     */
    public async isAlive(): Promise<boolean> {
        return this.httpProvider
            .get("/is_alive")
            .then((resp) => resp.status === axios.HttpStatusCode.Ok)
            .catch(() => false);
    }

    /**
     * Restart the state of the underlying Devnet instance. You may opt to restart L1-L2 messaging.
     * https://starknet-io.github.io/starknet-devnet/docs/dump-load-restart#restarting
     */
    public async restart(params: { restartL1ToL2Messaging?: boolean } = {}): Promise<void> {
        await this.rpcProvider.sendRequest("devnet_restart", {
            restart_l1_to_l2_messaging: params.restartL1ToL2Messaging,
        });
    }

    /**
     * Generate funds at the provided address. For return spec and more info, see
     * https://starknet-io.github.io/starknet-devnet/docs/balance#mint-token---local-faucet
     * @param address the account address to receive funds
     * @param amount how much to mint
     * @param unit specifier of the currency unit; defaults to FRI
     */
    public async mint(
        address: string,
        amount: bigint,
        unit: BalanceUnit = "FRI",
    ): Promise<MintResponse> {
        const paramsSerialized = `{
            "address": "${address}",
            "amount": ${amount},
            "unit": "${unit}"
        }`;
        const respData = await this.rpcProvider.sendRequest("devnet_mint", paramsSerialized);

        return {
            new_balance: BigInt(respData.new_balance),
            unit: respData.unit,
            tx_hash: respData.tx_hash,
        };
    }

    /**
     * https://starknet-io.github.io/starknet-devnet/docs/predeployed#how-to-get-predeployment-info
     * @returns a list of containing information on predeployed accounts. Load an account using e.g. starknet.js.
     */
    public async getPredeployedAccounts(
        additionalArgs = { withBalance: false },
    ): Promise<Array<PredeployedAccount>> {
        return await this.rpcProvider.sendRequest("devnet_getPredeployedAccounts", {
            with_balance: additionalArgs.withBalance,
        });
    }

    /**
     * https://starknet-io.github.io/starknet-devnet/docs/blocks
     * @returns the block hash of the newly created block
     */
    public async createBlock(): Promise<NewBlockResponse> {
        return await this.rpcProvider.sendRequest("devnet_createBlock");
    }

    /**
     * https://starknet-io.github.io/starknet-devnet/docs/blocks
     * @param staringBlockId the block ID of the block after which (inclusive) all blocks
     *      should be aborted. See docs {@link BlockId} for more info.
     * @returns hash values of aborted blocks
     */
    public async abortBlocks(startingBlockId: BlockId): Promise<AbortedBlocksResponse> {
        return await this.rpcProvider.sendRequest("devnet_abortBlocks", {
            starting_block_id: toRpcBlockId(startingBlockId),
        });
    }

    /**
     * Simulate L1 acceptance: mark the specified block, all of its `ACCEPTED_ON_L2` predecessors and
     * their transactions as `ACCEPTED_ON_L1`. Nothing is actually sent to L1.
     * https://starknet-io.github.io/starknet-devnet/docs/blocks#accepting-blocks-on-l1
     * @param startingBlockId the block ID of the newest block to be accepted on L1. See docs
     *      {@link BlockId} for more info.
     * @returns hash values of blocks accepted on L1
     */
    public async acceptOnL1(startingBlockId: BlockId): Promise<AcceptedOnL1BlocksResponse> {
        return await this.rpcProvider.sendRequest("devnet_acceptOnL1", {
            starting_block_id: toRpcBlockId(startingBlockId),
        });
    }

    /**
     * https://starknet-io.github.io/starknet-devnet/docs/next/starknet-time#set-time
     * @returns the new time in unix seconds and, if block creation requested, the hash of the created block
     */
    public async setTime(
        time: number,
        additionalArgs = { generateBlock: false },
    ): Promise<SetTimeResponse> {
        return await this.rpcProvider.sendRequest("devnet_setTime", {
            time,
            generate_block: additionalArgs.generateBlock,
        });
    }

    /**
     * Increase the time by the provided `increment` seconds.
     * https://starknet-io.github.io/starknet-devnet/docs/next/starknet-time#increase-time
     * @returns the new time in unix seconds
     */
    public async increaseTime(increment: number): Promise<IncreaseTimeResponse> {
        return await this.rpcProvider.sendRequest("devnet_increaseTime", {
            time: increment,
        });
    }

    /**
     * Serialize the whole Devnet instance. Writes no files; to store the dump, write it yourself.
     * https://starknet-io.github.io/starknet-devnet/docs/dump-load-restart#dumping
     * @returns the dump, which can be passed to `load`
     */
    public async dump(): Promise<DevnetDump> {
        return await this.rpcProvider.sendRequest("devnet_dump");
    }

    /**
     * Replace the current state with a dump, restoring it exactly, without re-executing transactions.
     * Files are only loaded on startup, via `--load-path`. A dump whose block generation mode or
     * forking origin differs from the running instance can only be loaded on startup as well.
     * https://starknet-io.github.io/starknet-devnet/docs/dump-load-restart#loading
     * @param dump a dump returned by `dump`, or a legacy dump produced by Devnet before v0.11.0
     */
    public async load(dump: DevnetDump | LegacyDevnetDump): Promise<void> {
        if (typeof dump === "string") {
            throw new DevnetProviderError(
                "Loading a dump from a path is not supported since Devnet v0.11.0. Pass the dump " +
                    "itself, use loadFromFile, or start Devnet with --load-path.",
            );
        }
        return await this.rpcProvider.sendRequest("devnet_load", { dump });
    }

    /**
     * Dump the whole Devnet instance and write it as JSON to `path` on the machine running this
     * library, which is not necessarily the one running Devnet (e.g. if Devnet runs in Docker).
     * https://starknet-io.github.io/starknet-devnet/docs/dump-load-restart#dumping
     * @param path the file to write the dump to; overwritten if it exists
     * @returns the written dump
     */
    public async dumpToFile(path: string): Promise<DevnetDump> {
        const dump = await this.dump();
        await writeFile(path, JSON.stringify(dump));
        return dump;
    }

    /**
     * Read a dump from `path` on the machine running this library and load it, as with `load`.
     * To load a file present on the machine running Devnet, start Devnet with `--load-path`.
     * https://starknet-io.github.io/starknet-devnet/docs/dump-load-restart#loading
     * @param path a file written by `dumpToFile`, or a legacy dump file produced by Devnet before v0.11.0
     */
    public async loadFromFile(path: string): Promise<void> {
        const dump = JSON.parse(await readFile(path, "utf8"));
        return await this.load(dump);
    }

    /**
     * Create an in-memory checkpoint of the whole Devnet state, to be restored with `revert`.
     * Snapshots are invalidated by `restart` and `load`.
     * https://starknet-io.github.io/starknet-devnet/docs/dump-load-restart#in-memory-snapshots
     * @returns the snapshot ID
     */
    public async snapshot(): Promise<string> {
        return await this.rpcProvider.sendRequest("devnet_snapshot");
    }

    /**
     * Restore the state captured by `snapshot`. Reverting consumes the target snapshot and all
     * newer ones, so to revert to the same state again, create a new snapshot after reverting.
     * https://starknet-io.github.io/starknet-devnet/docs/dump-load-restart#in-memory-snapshots
     * @param snapshotId the ID returned by `snapshot`
     * @returns `true` if the state was restored; `false` if the snapshot is unknown, consumed or invalidated
     */
    public async revert(snapshotId: string): Promise<boolean> {
        return await this.rpcProvider.sendRequest("devnet_revert", { snapshot_id: snapshotId });
    }

    /**
     * Atomically change the pre-confirmed state without executing a transaction: write storage,
     * set nonces, declare classes, deploy contracts at chosen addresses or replace their classes.
     * The changes become visible at "latest" once the pre-confirmed block is accepted.
     * https://starknet-io.github.io/starknet-devnet/docs/state-mutation
     * @param stateDiff the changes to apply; all categories are optional
     * @param classes class definitions to declare if not yet known, e.g. for `deployed_contracts`
     * @returns the hashes of the supplied classes, in request order
     */
    public async applyStateDiff(
        stateDiff: StateDiffInput,
        classes: Array<SuppliedClass> = [],
    ): Promise<ApplyStateDiffResponse> {
        return await this.rpcProvider.sendRequest("devnet_applyStateDiff", {
            state_diff: stateDiff,
            classes,
        });
    }

    /**
     * Modify gas prices, according to https://starknet-io.github.io/starknet-devnet/docs/gas
     * @param price new gas prices; any gas price can be ommitted
     * @param generateBlock if `true`, a new block is generated immediately, having new gas prices;
     *      otherwise (by default) the price change takes effect with the usual next block generation
     * @returns gas prices after modification, including the unchanged ones
     */
    public async setGasPrice(
        price: {
            l1GasPrice?: bigint;
            l1DataGasPrice?: bigint;
            l2GasPrice?: bigint;
        },
        generateBlock?: boolean,
    ): Promise<GasModificationResponse> {
        const newGasPrices = await this.rpcProvider.sendRequest(
            "devnet_setGasPrice",
            `{
                "gas_price_fri": ${price.l1GasPrice ?? null},
                "data_gas_price_fri": ${price.l1DataGasPrice ?? null},
                "l2_gas_price_fri": ${price.l2GasPrice ?? null},
                "generate_block": ${generateBlock ?? null}
            }`,
        );

        return {
            l1_gas_price: BigInt(newGasPrices.gas_price_fri),
            l1_data_gas_price: BigInt(newGasPrices.data_gas_price_fri),
            l2_gas_price: BigInt(newGasPrices.l2_gas_price_fri),
        };
    }

    /**
     * More info at: https://starknet-io.github.io/starknet-devnet/docs/api#config-api
     * @returns the configuration of the underlying Devnet instance. The returned object is marked
     *      as `any` because it may change too often.
     */
    // oxlint-disable-next-line typescript/no-explicit-any
    public async getConfig(): Promise<any> {
        return await this.rpcProvider.sendRequest("devnet_getConfig");
    }

    /**
     * More info at: https://starknet-io.github.io/starknet-devnet/docs/api#status-api
     * @returns a summary of the current state of the underlying Devnet instance, e.g. block and
     *      transaction counts, forking info and impersonation settings
     */
    public async getStatus(): Promise<DevnetStatus> {
        return await this.rpcProvider.sendRequest("devnet_getStatus");
    }
}
