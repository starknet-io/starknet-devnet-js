import { expect, assert } from "chai";
import { readFileSync } from "fs";
import * as starknet from "starknet";
import { DevnetProvider, SierraContractClass } from "..";
import { SIMPLE_CONTRACT_PATH } from "./constants";

describe("State mutation", function () {
    this.timeout(10_000); // ms

    const devnetProvider = new DevnetProvider();
    const starknetProvider = new starknet.RpcProvider({ nodeUrl: devnetProvider.url });

    beforeEach("restart the state", async function () {
        await devnetProvider.restart();
    });

    it("should write storage and set nonces in the pre-confirmed state", async function () {
        const [{ address }] = await devnetProvider.getPredeployedAccounts();
        const key = "0x123";

        const response = await devnetProvider.applyStateDiff({
            storage_diffs: [{ address, storage_entries: [{ key, value: "0x789" }] }],
            nonces: [{ contract_address: address, nonce: "0xa" }],
        });
        expect(response).to.deep.equal({ classes: [] });

        const storageAt = async (blockId: starknet.BlockIdentifier) =>
            BigInt((await starknetProvider.getStorageAt(address, key, blockId)).value);

        expect(await storageAt("pre_confirmed")).to.equal(0x789n);
        expect(
            BigInt(await starknetProvider.getNonceForAddress(address, "pre_confirmed")),
        ).to.equal(10n);

        // Changes become visible at "latest" once a block is created
        expect(await storageAt("latest")).to.equal(0n);
        await devnetProvider.createBlock();
        expect(await storageAt("latest")).to.equal(0x789n);
    });

    it("should declare and deploy a supplied class", async function () {
        const artifact = JSON.parse(readFileSync(SIMPLE_CONTRACT_PATH).toString());
        const contractClass: SierraContractClass = {
            sierra_program: artifact.sierra_program,
            contract_class_version: artifact.contract_class_version,
            entry_points_by_type: artifact.entry_points_by_type,
            abi: JSON.stringify(artifact.abi),
        };

        const {
            classes: [{ class_hash: classHash, compiled_class_hash: compiledClassHash }],
        } = await devnetProvider.applyStateDiff({}, [{ contract_class: contractClass }]);
        expect(compiledClassHash).to.be.a("string");

        // The constructor is not run on deployment, so its storage is initialized directly
        const address = "0x1234abcd";
        const balanceKey = starknet.num.toHex(starknet.hash.starknetKeccak("balance"));
        await devnetProvider.applyStateDiff({
            deployed_contracts: [{ address, class_hash: classHash }],
            storage_diffs: [{ address, storage_entries: [{ key: balanceKey, value: "0x2a" }] }],
        });
        await devnetProvider.createBlock();

        expect(BigInt(await starknetProvider.getClassHashAt(address))).to.equal(BigInt(classHash));
        const contract = new starknet.Contract({
            abi: artifact.abi,
            address,
            providerOrAccount: starknetProvider,
        });
        expect(await contract.get_balance()).to.equal(42n);
    });

    it("should fail atomically when targeting a non-existent contract", async function () {
        const [{ address }] = await devnetProvider.getPredeployedAccounts();
        const key = "0x123";
        try {
            const resp = await devnetProvider.applyStateDiff({
                storage_diffs: [
                    { address, storage_entries: [{ key, value: "0x1" }] },
                    { address: "0xdead", storage_entries: [{ key, value: "0x1" }] },
                ],
            });
            assert.fail(`Should have failed but got: ${resp}`);
        } catch (err) {
            expect(err).to.have.property("code", 20);
        }

        expect(
            BigInt((await starknetProvider.getStorageAt(address, key, "pre_confirmed")).value),
        ).to.equal(0n);
    });
});
