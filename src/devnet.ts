import { ChildProcess, spawn as spawnChildProcess } from "child_process";
import { DevnetProvider } from "./devnet-provider";
import { DevnetError } from "./types";
import { isFreePort, sleep } from "./util";
import {
    DEFAULT_DEVNET_HOST,
    DEFAULT_DEVNET_PORT,
    LATEST_COMPATIBLE_DEVNET_VERSION,
} from "./constants";
import { VersionHandler } from "./version-handler";
import { Stream } from "stream";

export type DevnetOutput = "inherit" | "ignore" | Stream | number;

export interface DevnetConfig {
    /** The CLI args you would pass to a Devnet run in terminal. */
    args?: string[];
    stdout?: DevnetOutput;
    stderr?: DevnetOutput;
    /** The maximum amount of time waited for Devnet to start. Defaults to 5000 ms. */
    maxStartupMillis?: number;
    /**
     * If `false` (default), automatically closes the spawned Devnet on program exit.
     * Otherwise keeps it alive.
     */
    keepAlive?: boolean;
}

export interface LegacyDumpConversionConfig {
    /**
     * The CLI args the legacy dump was created with, e.g. `["--account-class", "cairo0"]`; needed
     * to reproduce the dumped state.
     */
    args?: string[];
    /**
     * The command or path of the Devnet (v0.11.0 or newer) used for conversion. If omitted, the
     * latest compatible version is used, fetched if not present locally.
     */
    command?: string;
}

/**
 * Attempt to extract the URL from the provided Devnet CLI args. If host or present not present,
 * populates the received array with default values. The host defaults to 127.0.0.1 and the port
 * is randomly assigned.
 * @param args CLI args to Devnet
 * @returns the URL enabling communication with the Devnet instance
 */
async function ensureUrl(args: string[]): Promise<string> {
    let host: string;
    const hostParamIndex = args.indexOf("--host");
    if (hostParamIndex === -1) {
        host = DEFAULT_DEVNET_HOST;
        args.push("--host", host);
    } else {
        host = args[hostParamIndex + 1];
    }

    let port: string;
    const portParamIndex = args.indexOf("--port");
    if (portParamIndex === -1) {
        port = await getFreePort();
        args.push("--port", port);
    } else {
        port = args[portParamIndex + 1];
    }

    return `http://${host}:${port}`;
}

async function getFreePort(): Promise<string> {
    const step = 1000;
    const maxPort = 65535;
    for (let port = DEFAULT_DEVNET_PORT + step; port <= maxPort; port += step) {
        if (await isFreePort(port)) {
            return port.toString();
        }
    }

    throw new DevnetError("Could not find a free port! Try rerunning your command.");
}

export class Devnet {
    static instances: Devnet[] = [];

    private static CLEANUP_REGISTERED = false;

    private constructor(
        private process: ChildProcess,
        public provider: DevnetProvider,
    ) {}

    /**
     * Assumes `starknet-devnet` is installed and present in the environment PATH and executes it, using the args provided in `config`.
     * @param config an object for configuring Devnet
     * @returns a newly spawned Devnet instance
     */
    static async spawnInstalled(config: DevnetConfig = {}): Promise<Devnet> {
        return this.spawnCommand("starknet-devnet", config);
    }

    /**
     * Spawns a new Devnet using the provided command and optional args in `config`.
     * The `command` can be an absolute or a relative path, or a command in your environment's PATH.
     * @param command the command used for starting Devnet; can be a path
     * @param config configuration object
     * @returns a newly spawned Devnet instance
     */
    static async spawnCommand(command: string, config: DevnetConfig = {}): Promise<Devnet> {
        const args = config.args || [];
        const devnetUrl = await ensureUrl(args);

        const devnetProcess = spawnChildProcess(command, args, {
            detached: true,
            stdio: [undefined, config.stdout || "inherit", config.stderr || "inherit"],
        });
        devnetProcess.unref();

        const devnetInstance = new Devnet(devnetProcess, new DevnetProvider({ url: devnetUrl }));

        if (!config.keepAlive) {
            // store it now to ensure it's cleaned up automatically if the remaining steps fail
            Devnet.instances.push(devnetInstance);
            if (!Devnet.CLEANUP_REGISTERED) {
                Devnet.registerCleanup();
            }
        }

        return new Promise((resolve, reject) => {
            const maxStartupMillis = config?.maxStartupMillis ?? 5000;
            devnetInstance.ensureAlive(maxStartupMillis).then(() => resolve(devnetInstance));

            devnetProcess.on("error", function (e) {
                reject(e);
            });

            devnetProcess.on("exit", function () {
                if (devnetProcess.exitCode) {
                    reject(`Devnet exited with code ${devnetProcess.exitCode}. \
Check Devnet's logged output for more info. \
The output location is configurable via the config object passed to the Devnet spawning method.`);
                }
            });
        });
    }

    /**
     * Spawns a Devnet of the provided `version` using the parameters provided in `config`.
     * If not present locally, a precompiled version is fetched, extracted and executed.
     * If you already have a local Devnet you would like to run, use {@link spawnCommand}.
     * @param version if set to `"latest"`, uses the latest Devnet version compatible with this library;
     *     otherwise needs to be a semver string with a prepended "v" (e.g. "v1.2.3") and
     *     should be available in https://github.com/starknet-io/starknet-devnet/releases
     * @param config configuration object
     * @returns a newly spawned Devnet instance
     */
    static async spawnVersion(version: string, config: DevnetConfig = {}): Promise<Devnet> {
        version = version === "latest" ? LATEST_COMPATIBLE_DEVNET_VERSION : version;

        const command = await VersionHandler.getExecutable(version);
        return this.spawnCommand(command, config);
    }

    /**
     * Converts a legacy dump file, produced by Devnet before v0.11.0, to the current dump format by
     * running Devnet with `--convert-legacy-dump`. Devnet replays the legacy dump, writes the
     * result and exits without starting a server.
     * https://starknet-io.github.io/starknet-devnet/docs/dump-load-restart#legacy-dumps
     * @param legacyDumpPath the path of the legacy dump file
     * @param outputPath the path where the converted dump is written
     * @param config configuration object
     */
    static async convertLegacyDump(
        legacyDumpPath: string,
        outputPath: string,
        config: LegacyDumpConversionConfig = {},
    ): Promise<void> {
        const command =
            config.command ??
            (await VersionHandler.getExecutable(LATEST_COMPATIBLE_DEVNET_VERSION));
        const args = [
            ...(config.args ?? []),
            "--load-path",
            legacyDumpPath,
            "--convert-legacy-dump",
            outputPath,
        ];

        // Replay logs go to stdout and can be large, so only stderr, which has the errors, is kept
        const conversionProcess = spawnChildProcess(command, args, {
            stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        conversionProcess.stderr?.on("data", (chunk) => (stderr += chunk));

        return new Promise((resolve, reject) => {
            conversionProcess.on("error", reject);
            conversionProcess.on("close", (code, signal) => {
                if (code === 0) {
                    resolve();
                } else {
                    const cause = signal ? `signal ${signal}` : `exit code ${code}`;
                    reject(
                        new DevnetError(
                            `Converting the legacy dump failed with ${cause}: ${stderr.trim()}`,
                        ),
                    );
                }
            });
        });
    }

    private async ensureAlive(maxStartupMillis: number): Promise<void> {
        const checkPeriod = 100; // ms
        const maxIterations = maxStartupMillis / checkPeriod;

        for (let i = 0; !this.process.exitCode && i < maxIterations; ++i) {
            if (await this.provider.isAlive()) {
                return;
            }
            await sleep(checkPeriod);
        }

        throw new DevnetError(
            "Could not spawn Devnet! Ensure that you can spawn using the chosen method. \
Alternatively, increase the startup time defined in the config object provided on spawning.",
        );
    }

    /**
     * Sends the provided signal to the underlying Devnet process. Keep in mind
     * that the process is killed automatically on program exit.
     * @param signal the signal to be sent; deaults to `SIGTERM`
     * @returns `true` if successful; `false` otherwise
     */
    public kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
        return this.process.kill(signal);
    }

    private static cleanup() {
        for (const instance of Devnet.instances) {
            if (!instance.process.killed) {
                instance.kill();
            }
        }
    }

    private static registerCleanup() {
        // This handler just propagates the exit code.
        process.on("exit", Devnet.cleanup);

        for (const event of ["SIGINT", "SIGTERM", "SIGQUIT", "uncaughtException"]) {
            process.on(event, () => {
                Devnet.cleanup();
                process.exit(1); // Omitting this results in ignoring e.g. ctrl+c
            });
        }

        Devnet.CLEANUP_REGISTERED = true;
    }
}
