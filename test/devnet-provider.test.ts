import { expect, assert } from "chai";
import { BalanceUnit, Devnet, DevnetProvider, DevnetProviderError, MintResponse } from "..";
import * as starknet from "starknet";
import {
    ETH_TOKEN_CONTRACT_ADDRESS,
    STRK_TOKEN_CONTRACT_ADDRESS,
    getAccountBalance,
    getEnvVar,
} from "./util";

describe("DevnetProvider", function () {
    this.timeout(5000); // ms

    const devnetProvider = new DevnetProvider();
    const starknetProvider = new starknet.RpcProvider({ nodeUrl: devnetProvider.url });

    const DUMMY_ADDRESS = "0x1";
    const DUMMY_AMOUNT = 20n;

    beforeEach("restart the state", async function () {
        await devnetProvider.restart();
    });

    it("should have a healthcheck endpoint", async function () {
        const alive = await devnetProvider.isAlive();
        expect(alive).to.be.true;
    });

    it("should have predeployed accounts", async function () {
        const accounts = await devnetProvider.getPredeployedAccounts();
        expect(accounts).length.to.be.greaterThan(0);
    });

    it("should have configurable timeout", async function () {
        const insufficientTimeoutProvider = new DevnetProvider({ timeout: 1 /* ms */ });
        try {
            // dummy action that takes more time than the too short timeout
            await insufficientTimeoutProvider.mint(DUMMY_ADDRESS, DUMMY_AMOUNT);
            assert.fail("Should have timed out, got response instead");
        } catch (err) {
            const typedErr = err as DevnetProviderError;
            expect(typedErr.message).to.contain("timeout");
            expect(typedErr.message).to.contain("exceeded");
        }
    });

    function assertMintingResponse(
        resp: MintResponse,
        expectedAmount: bigint,
        expectedUnit: BalanceUnit,
    ) {
        expect(resp.tx_hash).to.match(/^0x[0-9a-fA-F]+/);
        expect(resp.new_balance).to.equal(BigInt(expectedAmount));
        expect(resp.unit).to.equal(expectedUnit);
    }

    async function assertBalance(
        accountAddress: string,
        expectedAmount: bigint,
        tokenContractAddress: string,
    ) {
        const actualBalance = await getAccountBalance(accountAddress, starknetProvider, {
            tokenContractAddress,
        });
        expect(actualBalance).to.equal(expectedAmount);
    }

    describe("minting", function () {
        it("works for WEI", async function () {
            const mintResp = await devnetProvider.mint(DUMMY_ADDRESS, DUMMY_AMOUNT, "WEI");
            assertMintingResponse(mintResp, DUMMY_AMOUNT, "WEI");
            await assertBalance(DUMMY_ADDRESS, DUMMY_AMOUNT, ETH_TOKEN_CONTRACT_ADDRESS);
            await assertBalance(DUMMY_ADDRESS, 0n, STRK_TOKEN_CONTRACT_ADDRESS);
        });

        it("works for FRI", async function () {
            const mintResp = await devnetProvider.mint(DUMMY_ADDRESS, DUMMY_AMOUNT, "FRI");
            assertMintingResponse(mintResp, DUMMY_AMOUNT, "FRI");
            await assertBalance(DUMMY_ADDRESS, DUMMY_AMOUNT, STRK_TOKEN_CONTRACT_ADDRESS);
            await assertBalance(DUMMY_ADDRESS, 0n, ETH_TOKEN_CONTRACT_ADDRESS);
        });

        it("works without specifying the unit", async function () {
            const mintResp = await devnetProvider.mint(DUMMY_ADDRESS, DUMMY_AMOUNT);
            assertMintingResponse(mintResp, DUMMY_AMOUNT, "FRI");
            await assertBalance(DUMMY_ADDRESS, DUMMY_AMOUNT, STRK_TOKEN_CONTRACT_ADDRESS);
            await assertBalance(DUMMY_ADDRESS, 0n, ETH_TOKEN_CONTRACT_ADDRESS);
        });

        it("should reflect the minted amount in predeployed accounts info", async function () {
            const accountIndex = 0;
            const accountsBefore = await devnetProvider.getPredeployedAccounts();
            const accountBefore = accountsBefore[accountIndex];

            expect(accountBefore.balance).to.be.null; // balance not included if not requested

            await devnetProvider.mint(accountBefore.address, DUMMY_AMOUNT, "WEI");

            const accountsAfter = await devnetProvider.getPredeployedAccounts({
                withBalance: true,
            });
            const accountAfter = accountsAfter[accountIndex];

            const expectedAmount = BigInt(accountBefore.initial_balance) + BigInt(DUMMY_AMOUNT);
            expect(accountAfter.balance).to.deep.equal({
                eth: {
                    amount: expectedAmount.toString(),
                    unit: "WEI",
                },
                strk: { amount: accountBefore.initial_balance, unit: "FRI" },
            });
        });

        it("works with large amount multiple of 10", async function () {
            const amount = 10n ** 30n;
            const resp = await devnetProvider.mint(DUMMY_ADDRESS, amount, "WEI");
            assertMintingResponse(resp, amount, "WEI");
            await assertBalance(DUMMY_ADDRESS, amount, ETH_TOKEN_CONTRACT_ADDRESS);
        });

        it("works with large amount with non-zero ones digit", async function () {
            const amount = 10n ** 30n + 1n;
            const resp = await devnetProvider.mint(DUMMY_ADDRESS, amount, "WEI");
            assertMintingResponse(resp, amount, "WEI");
            await assertBalance(DUMMY_ADDRESS, amount, ETH_TOKEN_CONTRACT_ADDRESS);
        });
    });

    describe("block manipulation", function () {
        it("should create new block", async function () {
            const originalLatestBlock = await starknetProvider.getBlockLatestAccepted();

            const { block_hash: createdBlockHash } = await devnetProvider.createBlock();

            const newLatestBlock = await starknetProvider.getBlockLatestAccepted();
            expect(newLatestBlock).to.deep.equal({
                block_hash: createdBlockHash,
                block_number: originalLatestBlock.block_number + 1,
            });
        });

        it("should abort blocks", async function () {
            const originalLatestBlock = await starknetProvider.getBlockLatestAccepted();

            const { block_hash: createdBlockHash1 } = await devnetProvider.createBlock();
            const { block_hash: createdBlockHash2 } = await devnetProvider.createBlock();

            const { aborted } = await devnetProvider.abortBlocks(createdBlockHash1);
            expect(aborted).to.deep.equal([createdBlockHash2, createdBlockHash1]);

            const newLatestBlock = await starknetProvider.getBlockLatestAccepted();
            expect(newLatestBlock).to.deep.equal(originalLatestBlock);
        });

        it("should fail when aborting non-existent blocks", async function () {
            const nonExistentBlockHash = "0x42";
            try {
                const resp = await devnetProvider.abortBlocks(nonExistentBlockHash);
                assert.fail(`Should have failed but got: ${resp}`);
            } catch (err) {
                expect(err).to.deep.equal({
                    code: -1,
                    message: "No block found",
                });
            }
        });

        it("should accept blocks on L1", async function () {
            const { block_hash: genesisBlockHash } = await starknetProvider.getBlock(0);
            const { block_hash: createdBlockHash1 } = await devnetProvider.createBlock();
            const { block_hash: createdBlockHash2 } = await devnetProvider.createBlock();

            const { accepted } = await devnetProvider.acceptOnL1(createdBlockHash1);
            expect(accepted).to.deep.equal([createdBlockHash1, genesisBlockHash]);

            const acceptedBlock = await starknetProvider.getBlock(createdBlockHash1);
            expect(acceptedBlock.status).to.equal("ACCEPTED_ON_L1");

            const latestBlock = await starknetProvider.getBlock(createdBlockHash2);
            expect(latestBlock.status).to.equal("ACCEPTED_ON_L2");
        });

        it("should fail when accepting blocks already accepted on L1", async function () {
            await devnetProvider.acceptOnL1("latest");
            try {
                const resp = await devnetProvider.acceptOnL1("latest");
                assert.fail(`Should have failed but got: ${resp}`);
            } catch (err) {
                expect(err).to.deep.equal({
                    code: -1,
                    message: "Block already accepted on L1",
                });
            }
        });
    });

    describe("time manipulation", function () {
        it("should set time after manually generating a block", async function () {
            const originalBlock = await starknetProvider.getBlock("latest");

            const futureTime = originalBlock.timestamp * 2;
            const { block_hash: blockHash } = await devnetProvider.setTime(futureTime);

            // since block generation was not requested as part of time setting
            expect(blockHash).to.be.null;

            const { block_hash: newBlockHash } = await devnetProvider.createBlock();
            const newBlock = await starknetProvider.getBlockWithTxHashes(newBlockHash);
            // expecting with `equal` may result in unwanted discrepancies
            expect(newBlock.timestamp).to.be.greaterThanOrEqual(futureTime);
        });

        it("should generate a block and set time in one request", async function () {
            const originalBlock = await starknetProvider.getBlock("latest");

            const futureTime = originalBlock.timestamp * 2;
            const { block_hash: blockHash } = await devnetProvider.setTime(futureTime, {
                generateBlock: true,
            });

            const newBlock = await starknetProvider.getBlock("latest");
            expect(newBlock.block_hash).to.equal(blockHash);
            expect(newBlock.timestamp).to.be.greaterThanOrEqual(futureTime);
        });

        it("should increase time", async function () {
            const originalBlock = await starknetProvider.getBlock("latest");

            const timeIncrement = 100;
            const { block_hash: newBlockHash } = await devnetProvider.increaseTime(timeIncrement);

            const newBlock = await starknetProvider.getBlock("latest");
            expect(newBlock.block_hash).to.equal(newBlockHash);
            expect(newBlock.timestamp).to.be.greaterThanOrEqual(
                originalBlock.timestamp + timeIncrement,
            );
        });
    });

    it("should retrieve correct config", async function () {
        // The existing background Devnet has one config
        const oldConfig = await devnetProvider.getConfig();

        // The newly spawned Devnet shall have its own config with the account number modified
        const totalAccounts = 3;
        const args = ["--accounts", totalAccounts.toString()];
        const customizedDevnet = await Devnet.spawnCommand(getEnvVar("DEVNET_PATH"), { args });

        const customizedConfig = await customizedDevnet.provider.getConfig();

        expect(customizedConfig.total_accounts).to.not.equal(oldConfig.total_accounts);
        expect(customizedConfig.total_accounts).to.equal(totalAccounts);
    });

    it("should retrieve status", async function () {
        const initialStatus = await devnetProvider.getStatus();
        expect(initialStatus.devnet_version).to.equal(getEnvVar("DEVNET_VERSION"));
        expect(initialStatus.chain_id).to.equal("SN_SEPOLIA");
        expect(initialStatus.is_forked).to.be.false;
        expect(initialStatus.fork_config).to.be.undefined;
        expect(initialStatus.impersonated_accounts).to.be.empty;
        expect(initialStatus.auto_impersonate).to.be.false;

        await devnetProvider.createBlock();
        const statusAfterBlock = await devnetProvider.getStatus();
        expect(statusAfterBlock.block_count).to.equal(initialStatus.block_count + 1);
        expect(statusAfterBlock.transaction_count).to.equal(initialStatus.transaction_count);

        await devnetProvider.mint(DUMMY_ADDRESS, DUMMY_AMOUNT);
        const statusAfterMint = await devnetProvider.getStatus();
        expect(statusAfterMint.transaction_count).to.equal(initialStatus.transaction_count + 1);
    });
});
