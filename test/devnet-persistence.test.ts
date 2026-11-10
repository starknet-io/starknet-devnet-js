import * as starknet from "starknet";
import { DevnetDump, DevnetProvider, DevnetProviderError, LegacyDevnetDump } from "..";
import { assert, expect } from "chai";
import { getEnvVar } from "./util";

describe("Devnet persistence", async function () {
    this.timeout(10_000); // ms

    const DUMMY_ADDRESS = "0x1";
    const DUMMY_AMOUNT = 20n;
    /** Exceeds u64::MAX, so it must not be rounded on the way through JS */
    const LARGE_AMOUNT = 123456789123456789123n;

    const devnetProvider = new DevnetProvider();
    const starknetProvider = new starknet.RpcProvider({ nodeUrl: devnetProvider.url });

    beforeEach("restart the state", async function () {
        await devnetProvider.restart();
    });

    async function dummyMint(amount = DUMMY_AMOUNT) {
        const { new_balance } = await devnetProvider.mint(DUMMY_ADDRESS, amount);
        return new_balance;
    }

    it("should dump and load", async function () {
        const balanceBeforeDump = await dummyMint(LARGE_AMOUNT);
        const blockBeforeDump = await starknetProvider.getBlockLatestAccepted();

        const dump = await devnetProvider.dump();
        expect(dump.format).to.equal("starknet-devnet-dump");
        expect(dump.devnet_version).to.equal(getEnvVar("DEVNET_VERSION"));

        await dummyMint();
        // A dump is plain JSON, so it survives being stored as a string
        await devnetProvider.load(JSON.parse(JSON.stringify(dump)));

        // Loading restores the state exactly, without re-executing transactions
        expect(await starknetProvider.getBlockLatestAccepted()).to.deep.equal(blockBeforeDump);
        expect(await dummyMint()).to.equal(balanceBeforeDump + DUMMY_AMOUNT);
    });

    it("should load a legacy dump", async function () {
        const legacyDump: LegacyDevnetDump = [
            {
                jsonrpc: "2.0",
                id: 1,
                method: "devnet_mint",
                params: { address: DUMMY_ADDRESS, amount: 1000, unit: "FRI" },
            },
        ];
        await devnetProvider.load(legacyDump);
        expect(await dummyMint()).to.equal(1000n + DUMMY_AMOUNT);
    });

    it("should reject loading from a path", async function () {
        try {
            await devnetProvider.load("/path/to/dump.json" as unknown as DevnetDump);
            assert.fail("Should have failed earlier");
        } catch (err) {
            expect(err).to.be.instanceOf(DevnetProviderError);
            expect((err as DevnetProviderError).message).to.contain("--load-path");
        }
    });

    it("should revert to a snapshot only once", async function () {
        const balanceAtSnapshot = await dummyMint();
        const snapshotId = await devnetProvider.snapshot();

        await dummyMint();
        expect(await devnetProvider.revert(snapshotId)).to.be.true;
        expect(await dummyMint()).to.equal(balanceAtSnapshot + DUMMY_AMOUNT);

        // reverting consumes the snapshot
        expect(await devnetProvider.revert(snapshotId)).to.be.false;
    });

    it("should invalidate snapshots on restart", async function () {
        const snapshotId = await devnetProvider.snapshot();
        await devnetProvider.restart();
        expect(await devnetProvider.revert(snapshotId)).to.be.false;
    });
});
