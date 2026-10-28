[![npm package](https://img.shields.io/npm/v/starknet-devnet?color=blue)](https://www.npmjs.com/package/starknet-devnet)

# Introduction

Using this JavaScript/TypeScript library, you can spawn [Starknet Devnet](https://github.com/starknet-io/starknet-devnet/) without installing and running it in a separate terminal. You can interact with it via its specific [Devnet API](https://starknet-io.github.io/starknet-devnet/docs/api#devnet-api). To interact with any Starknet node or network (including Starknet Devnet) via the [Starknet JSON-RPC API](https://starknet-io.github.io/starknet-devnet/docs/api#starknet-api), see [starknet.js](https://www.starknetjs.com/).

# Installation

```
npm i starknet-devnet
```

# Compatibility

## Devnet compatibility

This library version is compatible with Devnet `v0.10.1`.

[Devnet's balance checking functionality](https://starknet-io.github.io/starknet-devnet/docs/balance#check-balance) is not provided in this library because it is simply replaceable using starknet.js, as witnessed by the [getAccountBalance](./test/util.ts#L61) function.

## Environment compatibility

This library is intended for use with Node.js, not in a browser environment. In browsers, you can only use [`DevnetProvider`](#connect-to-a-running-instance) for connecting to an already running Devnet instance, but you cannot [spawn a new Devnet](#spawn-a-new-devnet), because that relies on modules not present in the browser engine.

To enable the use of `DevnetProvider` in browser, you need to configure sources for modules otherwise reported as not found. See [this issue](https://github.com/starknet-io/starknet-devnet-js/issues/26) and [this SO answer](https://stackoverflow.com/a/51669301) for more info, but generally, if using webpack, it should be enough to populate a config file with the desired polyfill implementations or with `false` values.

# Usage

## Spawn a new Devnet

This library allows you to spawn a Devnet instance inside your program, without a separate terminal. It finds a random free port, and releases all used resources on exit. You can specify a port of your choice via `args: ["--port", ...]`.

### Spawn a version without manual installation

Assuming your machine has a supported OS (macOS or Linux) and supported architecture (arm64/aarch64 or x64/x86_64), using `Devnet.spawnVersion` will quickly install and spawn a new Devnet.

```typescript
import { Devnet } from "starknet-devnet";

async function main() {
    // Specify anything from https://github.com/starknet-io/starknet-devnet/releases
    // Be sure to include the 'v' if it's in the version name.
    const devnet = await Devnet.spawnVersion("v0.10.1");
    console.log(await devnet.provider.isAlive()); // true
}
```

To use the latest compatible version:

```typescript
const devnet = await Devnet.spawnVersion("latest");
```

### Spawn an already installed Devnet

Assuming you have already installed Devnet and it is present in your environment's `PATH`, simply run:

```typescript
const devnet = await Devnet.spawnInstalled();
```

### Specify Devnet arguments

You can use the same CLI arguments you would pass to a Devnet running in a terminal:

```typescript
const devnet = await Devnet.spawnInstalled({ args: ["--accounts", "3"] });
```

E.g. to browse blocks, transactions and accounts of the spawned Devnet in the [web UI explorer](https://starknet-io.github.io/starknet-devnet/docs/web-ui), pass `--ui` and open `${devnet.provider.url}/ui` in a browser:

```typescript
const devnet = await Devnet.spawnInstalled({ args: ["--ui"] });
console.log(`${devnet.provider.url}/ui`);
```

### Devnet output

By default, the spawned Devnet inherits the output streams of the main program in which it is invoked. If you invoke your program in a terminal without any stream redirections, it will print Devnet logs in that same terminal together with your program output. This can be overriden:

```typescript
const outputStream = fs.createWriteStream("devnet-out.txt");
await events.once(outputStream, "open"); // necessary if specifying a --port, otherwise omissible
const devnet = await Devnet.spawnInstalled({
    stdout: outputStream,
    stderr: /* what you will, could be the same as stdout */,
});
// do stuff with devnet and then close the stream
outputStream.end();
```

To track the output in a separate terminal, open a new terminal and run:

```
tail -f devnet-out.txt
```

To ignore the output completely, specify `{ stdout: "ignore", stderr: "ignore" }`.

### Spawn a custom build

If you have a custom build of Devnet or have multiple custom versions present locally:

```typescript
// provide the command
const devnet = await Devnet.spawnCommand("my-devnet-command", { ... });
// or specify the path
const devnet = await Devnet.spawnCommand("/path/to/my-devnet-command", { ... });
```

### Killing

By default, the Devnet subprocess automatically exits and releases the used resources on program end, but you can send it a signal if needed:

```typescript
const devnet = await Devnet.spawnInstalled();
devnet.kill(...); // defaults to SIGTERM
```

### Keeping alive

To keep the spawned Devnet alive after your program exits, set the `keepAlive` flag:

```typescript
const devnet = await Devnet.spawnInstalled({ keepAlive: true });
```

In that case, you must take care of the spawned process after the program exits. To kill it, you need to:

1. Know the port it is using. It is logged on Devnet startup and is also a part of `devnet.provider.url`.
2. Kill the process using the port, which you can do:

    a. In JS, by relying on the [cross-port-killer library](https://www.npmjs.com/package/cross-port-killer).

    b. From shell, by executing `lsof -i :<PORT> | awk 'NR==2{print $2}' | xargs kill` (substitute `<PORT>` with yours).

## Connect to a running instance

If there already is a running Devnet instance (e.g. in another terminal or in another JS/TS program), you can simply connect to it by importing `DevnetProvider`. [Read more](https://starknet-io.github.io/starknet-devnet/docs/category/running) about different ways of running Devnet.

```typescript
import { DevnetProvider } from "starknet-devnet";
const devnet = new DevnetProvider(); // accepts an optional configuration object
console.log(await devnet.isAlive()); // true
```

## Enabling Starknet API support

Since this library only supports the [Devnet-specific API](https://starknet-io.github.io/starknet-devnet/docs/api#devnet-api), to interact via [Starknet JSON-RPC API](https://starknet-io.github.io/starknet-devnet/docs/api#starknet-api), use [starknet.js](https://www.starknetjs.com/).

E.g. to get the latest block after spawning Devnet, you would need to do:

```typescript
import { Devnet } from "starknet-devnet";
import * as starknet from "starknet";

const devnet = await Devnet.spawnInstalled();
const starknetProvider = new starknet.RpcProvider({ nodeUrl: devnet.provider.url });

const block = await starknetProvider.getBlock("latest");
```

## L1-L2 communication

Assuming there is an L1 provider running (e.g. [anvil](https://github.com/foundry-rs/foundry/tree/master/crates/anvil)), use the `postman` property of `DevnetProvider` to achieve [L1-L2 communication](https://starknet-io.github.io/starknet-devnet/docs/postman). See [this example](https://github.com/starknet-io/starknet-devnet-js/blob/master/test/l1-l2-postman.test.ts) for more info.

## Transaction Proofs

Use the `proofs` property of `DevnetProvider` to prove INVOKE v3 transactions. This is useful for testing proof-aware flows in your application. See the [Devnet proofs documentation](https://starknet-io.github.io/starknet-devnet/docs/proofs) for more details on proof modes.

**Note:** Before calling `proveTransaction`, Devnet requires at least 10 blocks to exist. Start Devnet with `--proof-mode devnet` to enable this feature.

```typescript
import { Devnet } from "starknet-devnet";
import * as starknet from "starknet";

const devnet = await Devnet.spawnInstalled({ args: ["--proof-mode", "devnet"] });

// ... ensure at least 10 blocks exist (e.g. via devnet.provider.createBlock()) ...

// Build an INVOKE v3 transaction payload
const invokeTx = {
    type: "INVOKE" as const,
    version: "0x3" as const,
    sender_address: account.address,
    calldata: ["0x1", "0x2"],
    signature: ["0x...", "0x..."],
    nonce: "0x0",
    resource_bounds: {
        l1_gas: { max_amount: "0x100", max_price_per_unit: "0x100" },
        l1_data_gas: { max_amount: "0x100", max_price_per_unit: "0x100" },
        l2_gas: { max_amount: "0x100", max_price_per_unit: "0x100" },
    },
    tip: "0x0",
    paymaster_data: [],
    account_deployment_data: [],
    nonce_data_availability_mode: "L1" as const,
    fee_data_availability_mode: "L1" as const,
};

// Prove the transaction
const proofResult = await devnet.provider.proofs.proveTransaction("latest", invokeTx);

console.log(proofResult.proof); // Base64-encoded mock proof
console.log(proofResult.proof_facts); // Array of 9 hex strings
console.log(proofResult.l2_to_l1_messages); // L2 to L1 messages from simulation
```

See [this example](https://github.com/starknet-io/starknet-devnet-js/blob/master/test/proofs.test.ts) for a complete test with transaction building and signing.

## Configuration modification and retrieval

Devnet's configuration can be modified, other than [on startup (as already described)](#specify-devnet-arguments), via `setGasPrice`. It can be retrieved via `getConfig`.

```typescript
const devnet = await Devnet.spawnInstalled({ args: ["--l2-gas-price-fri", ...] });
const modification = await devnet.provider.setGasPrice({ l2GasPrice: ... });
console.log((await devnet.provider.getConfig()).l2_gas_price_fri);
```

## Status

To get a summary of the current Devnet state, such as block and transaction counts, forking info and impersonation settings, use `getStatus`.

```typescript
const status = await devnet.provider.getStatus();
console.log(status.block_count, status.transaction_count, status.impersonated_accounts);
```

## Dump and load

To [dump](https://starknet-io.github.io/starknet-devnet/docs/dump-load-restart#dumping) the state of a Devnet and later load it, Devnet must be started with a `--dump-on` mode. `dump` always returns the dump, which can be passed directly to `load`, so no file is needed:

```typescript
const devnet = await Devnet.spawnInstalled({ args: ["--dump-on", "request"] });
// ... change the state ...
const dump = await devnet.provider.dump();
// ... change the state some more ...
await devnet.provider.load(dump); // back to the dumped state
```

To also write the dump to a file, pass a path to `dump`, and later pass that path to `load`. If Devnet was started with `--dump-path`, `dump()` writes to that path by default; use `dump(undefined, { inline: true })` to skip writing it.

Treat the returned dump as opaque: its format is defined by Devnet and may change between Devnet versions.

## Snapshots

To restore the state between tests without replaying transactions, use [in-memory snapshots](https://starknet-io.github.io/starknet-devnet/docs/dump-load-restart#in-memory-snapshots). Reverting consumes the snapshot (and all newer ones), so take a new snapshot after each revert to reuse a fixture:

```typescript
// ... set up the fixture ...
let snapshotId = await devnet.provider.snapshot();

async function resetFixture() {
    if (!(await devnet.provider.revert(snapshotId))) {
        throw new Error("Fixture snapshot is no longer available");
    }
    snapshotId = await devnet.provider.snapshot();
}
```

`revert` returns `false` if the snapshot is unknown, consumed, or invalidated by `restart` or `load`.

## State mutation

To prepare state directly, without executing transactions, use [`applyStateDiff`](https://starknet-io.github.io/starknet-devnet/docs/state-mutation). It atomically writes storage, sets nonces, declares classes, deploys contracts at chosen addresses (without running constructors) or replaces their classes. Changes apply to the `pre_confirmed` state and become visible at `latest` once a block is created.

```typescript
await devnet.provider.applyStateDiff({
    storage_diffs: [{ address: "0x123", storage_entries: [{ key: "0x456", value: "0x789" }] }],
    nonces: [{ contract_address: "0x123", nonce: "0xa" }],
});
```

To declare a class, supply its definition as the second argument; the computed hashes are returned. A Sierra class must be flattened: omit `sierra_program_debug_info` from the compiled artifact and stringify its `abi`. See [this example](https://github.com/starknet-io/starknet-devnet-js/blob/master/test/state-mutation.test.ts) for declaring and deploying a contract.

In [restrictive mode](https://starknet-io.github.io/starknet-devnet/docs/restrictive), `snapshot`, `revert` and `applyStateDiff` are restricted by default.

## Examples

See the [`test` directory](https://github.com/starknet-io/starknet-devnet-js/tree/master/test) for more usage examples.

## Contribute

If you spot a problem or room for improvement, check if an issue for it [already exists](https://github.com/starknet-io/starknet-devnet-js/issues). If not, [create a new one](https://github.com/starknet-io/starknet-devnet-js/issues/new). You are welcome to open a PR yourself to close the issue. Once you open a PR, you will see a template with a list of steps - please follow them.

### Test

Before running the tests with `npm test`, follow the steps defined in the [CI/CD workflow](.github/workflows/build-test-publish.yml). If your new test relies on environment variables, load them with `getEnvVar`. Conversely, to find all environment variables that need to be set before running existing tests, search the repo for `getEnvVar`.
