/**
 * Types of `devnet_applyStateDiff`. The state diff categories follow the Starknet JSON-RPC
 * `STATE_DIFF` specification.
 * https://starknet-io.github.io/starknet-devnet/docs/state-mutation
 */

export interface StorageEntry {
    key: string;
    value: string;
}

export interface StorageDiff {
    address: string;
    storage_entries: Array<StorageEntry>;
}

export interface ContractNonce {
    contract_address: string;
    /** Absolute value; can also decrease or reset the nonce. */
    nonce: string;
}

export interface DeployedContract {
    address: string;
    class_hash: string;
}

export interface ReplacedClass {
    contract_address: string;
    class_hash: string;
}

export interface ClassHashPair {
    class_hash: string;
    compiled_class_hash: string;
}

/** All categories are optional and default to empty. */
export interface StateDiffInput {
    storage_diffs?: Array<StorageDiff>;
    nonces?: Array<ContractNonce>;
    /** Deploys at unused addresses without running the constructor. */
    deployed_contracts?: Array<DeployedContract>;
    replaced_classes?: Array<ReplacedClass>;
    declared_classes?: Array<ClassHashPair>;
    deprecated_declared_classes?: Array<string>;
    migrated_compiled_classes?: Array<ClassHashPair>;
}

interface EntryPointsByType<EntryPoint> {
    CONSTRUCTOR: Array<EntryPoint>;
    EXTERNAL: Array<EntryPoint>;
    L1_HANDLER: Array<EntryPoint>;
}

/**
 * Flattened Sierra class, as in the Starknet JSON-RPC specification. A compiled artifact can be
 * converted by omitting `sierra_program_debug_info` and stringifying `abi`.
 */
export interface SierraContractClass {
    sierra_program: Array<string>;
    contract_class_version: string;
    entry_points_by_type: EntryPointsByType<{ selector: string; function_idx: number }>;
    abi: string;
}

/** Compressed Cairo 0 class, as in the Starknet JSON-RPC specification. */
export interface DeprecatedContractClass {
    /** Base64 encoding of the gzip-compressed program. */
    program: string;
    entry_points_by_type: EntryPointsByType<{ selector: string; offset: string }>;
    abi?: Array<unknown>;
}

/**
 * A class definition to be declared, if not yet known. Devnet computes the hashes; if provided,
 * they must match.
 */
export interface SuppliedClass {
    contract_class: SierraContractClass | DeprecatedContractClass;
    class_hash?: string;
    /** Only for Sierra classes. */
    compiled_class_hash?: string;
}

export interface AppliedClass {
    class_hash: string;
    /** Only present for Sierra classes. */
    compiled_class_hash?: string;
}

export interface ApplyStateDiffResponse {
    /** Hashes of the supplied classes, in request order. */
    classes: Array<AppliedClass>;
}
