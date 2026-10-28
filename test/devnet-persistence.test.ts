import * as path from "path";
import * as fs from "fs";
import { DevnetProvider } from "..";
import { expect } from "chai";

describe("Devnet persistence", async function () {
    this.timeout(10_000); // ms

    const WORKDIR = "/tmp";
    const DUMP_PREFIX = "persisted_devnet_";
    const DUMP_EXTENSION = ".dump.json";

    const DUMMY_ADDRESS = "0x1";
    const DUMMY_AMOUNT = 20n;

    const devnetProvider = new DevnetProvider();

    function removeDumps() {
        for (const fileName of fs.readdirSync(WORKDIR)) {
            if (fileName.startsWith(DUMP_PREFIX) && fileName.endsWith(DUMP_EXTENSION)) {
                const file = path.join(WORKDIR, fileName);
                fs.unlinkSync(file);
            }
        }
    }

    beforeEach("clear workdir and Devnet state", async function () {
        removeDumps();
        await devnetProvider.restart();
    });

    afterEach("clear workdir", function () {
        removeDumps();
    });

    function getRandomDumpPath() {
        const name = `${DUMP_PREFIX}${Math.random().toString().slice(2)}${DUMP_EXTENSION}`;
        return path.join(WORKDIR, name);
    }

    async function dummyMint(amount = DUMMY_AMOUNT) {
        const { new_balance } = await devnetProvider.mint(DUMMY_ADDRESS, amount);
        return new_balance;
    }

    it("should dump and load", async function () {
        const dumpPath = getRandomDumpPath();

        const balanceBeforeDump = await dummyMint();
        await devnetProvider.dump(dumpPath);

        const balanceBeforeLoad = await dummyMint();
        expect(balanceBeforeLoad).to.equal(balanceBeforeDump + BigInt(DUMMY_AMOUNT));

        await devnetProvider.load(dumpPath);
        const finalBalance = await dummyMint();

        expect(finalBalance).to.equal(balanceBeforeDump + BigInt(DUMMY_AMOUNT));
    });

    it("should dump without providing a path in request", async function () {
        await dummyMint(); // dumping is skipped if there are no transactions, so we add one
        const dump = await devnetProvider.dump();
        expect(dump.map((event) => event.method)).to.include("devnet_mint");
    });

    it("should return the dump when also writing it to a file", async function () {
        await dummyMint();

        // Devnet may be running in a container, so the written file is not read here
        const dumpWrittenToFile = await devnetProvider.dump(getRandomDumpPath());
        const inlineDump = await devnetProvider.dump(undefined, { inline: true });
        expect(dumpWrittenToFile).to.deep.equal(inlineDump);
    });

    it("should load an inline dump", async function () {
        // Exceeds Number.MAX_SAFE_INTEGER, so it must not be rounded on the way through JS.
        // Kept below u64::MAX, since Devnet fails to load inline events with larger integers.
        const largeAmount = 12345678912345678912n;
        const balanceBeforeDump = await dummyMint(largeAmount);
        expect(balanceBeforeDump).to.equal(largeAmount);

        const dump = await devnetProvider.dump(undefined, { inline: true });

        await dummyMint();
        await devnetProvider.load(dump);
        const finalBalance = await dummyMint();

        expect(finalBalance).to.equal(balanceBeforeDump + DUMMY_AMOUNT);
    });
});
