import { assert, expect } from "chai";
import { Devnet, DevnetProvider, GithubError } from "..";
import { getEnvVar, sleep } from "./util";
import path from "path";
import tmp from "tmp";
import fs from "fs";

describe("Spawnable Devnet", function () {
    this.timeout(10_000);

    let devnetPath: string;
    let devnetVersion: string;
    let oldEnv: NodeJS.ProcessEnv;

    before(function () {
        // a predefined path corresponding to a Devnet executable
        devnetPath = getEnvVar("DEVNET_PATH");

        // a semver string corresponding to a compatible Devnet version
        devnetVersion = getEnvVar("DEVNET_VERSION");

        // clone environment to later restore it; some tests may modify it
        oldEnv = Object.assign({}, process.env);
    });

    afterEach(function () {
        process.env = oldEnv;
    });

    it("should be spawnable by command in PATH", async function () {
        const devnetDir = path.dirname(devnetPath);
        process.env.PATH += `:${devnetDir}`;

        // command expects Devnet to be available in PATH
        const devnet = await Devnet.spawnInstalled();
        expect(await devnet.provider.isAlive()).to.be.true;
    });

    it("should be spawnable via path and killable", async function () {
        const devnet = await Devnet.spawnCommand(devnetPath);
        expect(await devnet.provider.isAlive()).to.be.true;

        // the subprocess is killed automatically on program exit,
        // but here it is demonstrated that it can be killed on request
        const success = devnet.kill();
        expect(success).to.be.true;

        // could work without the sleep, but on slower systems it needs some time to die in peace
        await sleep(2000);

        expect(await devnet.provider.isAlive()).to.be.false;
    });

    it("should spawn multiple Devnets at different ports", async function () {
        const devnet = await Devnet.spawnCommand(devnetPath);
        const anotherDevnet = await Devnet.spawnCommand(devnetPath);

        expect(devnet.provider.url).to.not.be.equal(anotherDevnet.provider.url);

        expect(await devnet.provider.isAlive()).to.be.true;
        expect(await anotherDevnet.provider.isAlive()).to.be.true;
    });

    it("should fail if command does not exist", async function () {
        const invalidCommand = "some-certainly-invald-command";
        try {
            await Devnet.spawnCommand(invalidCommand);
            assert.fail("Should have failed earlier");
        } catch (err) {
            expect(err).to.have.property("code").equal("ENOENT");
        }
    });

    it("should fail if invalid CLI param", async function () {
        try {
            await Devnet.spawnCommand(devnetPath, { args: ["--faulty-param", "123"] });
            assert.fail("Should have failed earlier");
        } catch (err) {
            expect(err).to.contain("Devnet exited");
            expect(err).to.contain("Check Devnet's logged output");
        }
    });

    it("should log errors to a file", async function () {
        const stdoutFile = tmp.fileSync();
        const stderrFile = tmp.fileSync();
        try {
            await Devnet.spawnCommand(devnetPath, {
                args: ["--faulty-param", "123"],
                stdout: stdoutFile.fd,
                stderr: stderrFile.fd,
            });
            assert.fail("Should have failed earlier");
        } catch {
            const stdoutContent = fs.readFileSync(stdoutFile.name).toString();
            expect(stdoutContent).to.be.empty;

            const stderrContent = fs.readFileSync(stderrFile.name).toString();
            expect(stderrContent).to.contain("unexpected argument '--faulty-param'");
        }
    });

    it("should log non-error output to a file", async function () {
        const stdoutFile = tmp.fileSync();
        const stderrFile = tmp.fileSync();

        const dummyPort = 1234; // assuming it's free
        await Devnet.spawnCommand(devnetPath, {
            args: ["--port", dummyPort.toString()],
            stdout: stdoutFile.fd,
            stderr: stderrFile.fd,
        });

        const stdoutContent = fs.readFileSync(stdoutFile.name).toString();
        expect(stdoutContent).to.contain(`Starknet Devnet listening on 127.0.0.1:${dummyPort}`);

        const stderrContent = fs.readFileSync(stderrFile.name).toString();
        expect(stderrContent).to.be.empty;
    });

    it("should use the specified ports", async function () {
        const dummyPort = 2345; // assuming it's free

        const provider = new DevnetProvider({ url: `http://127.0.0.1:${dummyPort}` });
        expect(await provider.isAlive()).to.be.false;

        const devnet = await Devnet.spawnCommand(devnetPath, {
            args: ["--port", dummyPort.toString()],
        });

        expect(provider.url).to.equal(devnet.provider.url);
        expect(await provider.isAlive()).to.be.true;
    });

    it("should pass CLI args", async function () {
        const predeployedAccountsNumber = 13;
        const initialBalance = "123";
        const devnet = await Devnet.spawnCommand(devnetPath, {
            args: [
                "--accounts",
                predeployedAccountsNumber.toString(),
                "--initial-balance",
                initialBalance,
            ],
        });

        const predeployedAccounts = await devnet.provider.getPredeployedAccounts();
        expect(predeployedAccounts).to.have.lengthOf(predeployedAccountsNumber);
        expect(predeployedAccounts[0].initial_balance).to.equal(initialBalance);
    });

    it("should spawn by version", async function () {
        this.timeout(30_000);
        const devnet = await Devnet.spawnVersion(`v${devnetVersion}`);
        expect(await devnet.provider.isAlive()).to.be.true;
    });

    it("should spawn if specifying 'latest'", async function () {
        this.timeout(30_000);
        const devnet = await Devnet.spawnVersion("latest");
        expect(await devnet.provider.isAlive()).to.be.true;
    });

    it("should fail if missing 'v' in version specifier", async function () {
        try {
            await Devnet.spawnVersion(devnetVersion);
            assert.fail("Should have failed earlier");
        } catch (err) {
            const typedErr = err as GithubError;
            expect(typedErr.message).to.contain("Version not found");
        }
    });

    it("should fail if version does not exist", async function () {
        try {
            await Devnet.spawnVersion("v1.2.345");
            assert.fail("Should have failed earlier");
        } catch (err) {
            const typedErr = err as GithubError;
            expect(typedErr.message).to.contain("Version not found");
        }
    });
});
