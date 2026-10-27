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
        const dumpPath = getRandomDumpPath();
        await dummyMint();

        const dump = await devnetProvider.dump(dumpPath);
        expect(dump).to.deep.equal(JSON.parse(fs.readFileSync(dumpPath).toString()));
    });

    it("should load an inline dump", async function () {
        // exceeds Number.MAX_SAFE_INTEGER, so it must not be rounded on the way through JS
        const largeAmount = 123456789123456789123n;
        const balanceBeforeDump = await dummyMint(largeAmount);
        expect(balanceBeforeDump).to.equal(largeAmount);

        const dump = await devnetProvider.dump(undefined, { inline: true });

        await dummyMint();
        await devnetProvider.load(dump);
        const finalBalance = await dummyMint();

        expect(finalBalance).to.equal(balanceBeforeDump + DUMMY_AMOUNT);
    });
});
