import { expect } from "chai";
import * as starknet from "starknet";
import { Devnet, InvokeV3Transaction } from "..";
import { getContractArtifact, getEnvVar, getPredeployedAccount } from "./util";
import { SIMPLE_CONTRACT_PATH, SIMPLE_CONTRACT_CASM_HASH } from "./constants";

describe("Transaction proofs", function () {
    this.timeout(60_000); // ms

    let devnet: Devnet;
    let starknetProvider: starknet.RpcProvider;
    let account: starknet.Account;
    let contract: starknet.Contract;

    before("Set up Devnet with proof mode and deploy test contract", async function () {
        devnet = await Devnet.spawnCommand(getEnvVar("DEVNET_PATH"), {
            args: ["--proof-mode", "devnet"],
        });
        starknetProvider = new starknet.RpcProvider({ nodeUrl: devnet.provider.url });
        account = await getPredeployedAccount(devnet.provider, starknetProvider);

        // Deploy the simple contract for testing
        const contractArtifact = getContractArtifact(SIMPLE_CONTRACT_PATH);
        const deployment = await account.declareAndDeploy({
            contract: contractArtifact,
            compiledClassHash: SIMPLE_CONTRACT_CASM_HASH,
            constructorCalldata: { initial_balance: 100 },
        });

        contract = new starknet.Contract({
            abi: contractArtifact.abi,
            address: deployment.deploy.contract_address,
            providerOrAccount: account,
        });

        // Devnet's proof mode requires at least 10 blocks to exist before proving.
        for (let i = 0; i < 10; i++) {
            await devnet.provider.createBlock();
        }
    });

    after("close devnet", async function () {
        devnet?.kill();
    });

    it("should prove a transaction and return proof data", async function () {
        // Build an invoke call
        const call = contract.populate("increase_balance", [50, 0]);

        // Get account nonce
        const nonce = await account.getNonce();

        // Build the invoke transaction payload
        const invokeTx = await buildInvokeV3Transaction(account, [call], nonce);

        // Prove the transaction
        const proofResult = await devnet.provider.proofs.proveTransaction("latest", invokeTx);

        // Verify proof response structure
        expect(proofResult).to.have.property("proof");
        expect(proofResult).to.have.property("proof_facts");
        expect(proofResult).to.have.property("l2_to_l1_messages");

        expect(proofResult.proof).to.be.a("string");
        expect(proofResult.proof.length).to.be.greaterThan(0);

        expect(proofResult.proof_facts).to.be.an("array");
        expect(proofResult.proof_facts.length).to.equal(9); // devnet mode returns 9 elements

        expect(proofResult.l2_to_l1_messages).to.be.an("array");
    });

    it("should prove and then execute a transaction successfully", async function () {
        const initialBalance = await contract.get_balance();
        const incrementAmount = 25n;

        // Build an invoke call
        const call = contract.populate("increase_balance", [incrementAmount, 0]);

        // Get account nonce
        const nonce = await account.getNonce();

        // Build the invoke transaction payload
        const invokeTx = await buildInvokeV3Transaction(account, [call], nonce);

        // First, prove the transaction
        const proofResult = await devnet.provider.proofs.proveTransaction("latest", invokeTx);

        expect(proofResult.proof).to.be.a("string");
        expect(proofResult.proof_facts).to.have.lengthOf(9);

        // Now execute the same transaction
        const { transaction_hash } = await account.execute([call]);
        const receipt = await starknetProvider.waitForTransaction(transaction_hash);

        expect(receipt.isSuccess()).to.be.true;

        // Verify the state changed
        const newBalance = await contract.get_balance();
        expect(newBalance).to.equal(initialBalance + incrementAmount);
    });

    it("should fail to prove a transaction that would revert", async function () {
        const badCall: starknet.Call = {
            contractAddress: contract.address,
            entrypoint: "nonexistent_function",
            calldata: [],
        };

        // Estimation would itself fail for a reverting call, so hand-pick bounds
        // to ensure the failure surfaces from proveTransaction and not estimateFee.
        const fixedBounds: starknet.ResourceBoundsBN = {
            l1_gas: { max_amount: 0x1000n, max_price_per_unit: 0x1000n },
            l1_data_gas: { max_amount: 0x1000n, max_price_per_unit: 0x1000n },
            l2_gas: { max_amount: 0x100000000n, max_price_per_unit: 0x1000n },
        };

        const nonce = await account.getNonce();
        const invokeTx = await buildInvokeV3Transaction(account, [badCall], nonce, fixedBounds);

        try {
            await devnet.provider.proofs.proveTransaction("latest", invokeTx);
            expect.fail("Should have thrown an error for reverting transaction");
        } catch (err) {
            // rpc-provider throws the raw JSON-RPC error object: { code, message, ... }
            const rpcErr = err as { code?: unknown; message?: unknown };
            expect(rpcErr.code, `unexpected error shape: ${JSON.stringify(err)}`).to.be.a("number");
            expect(rpcErr.message).to.be.a("string").and.not.empty;
        }
    });

    it("should prove multiple transactions in sequence", async function () {
        const call1 = contract.populate("increase_balance", [10, 0]);
        const call2 = contract.populate("increase_balance", [20, 0]);

        // Get current nonce
        let nonce = await account.getNonce();

        // Prove first transaction
        const invokeTx1 = await buildInvokeV3Transaction(account, [call1], nonce);
        const proof1 = await devnet.provider.proofs.proveTransaction("latest", invokeTx1);
        expect(proof1.proof_facts).to.have.lengthOf(9);

        // Execute first transaction to advance nonce
        await account.execute([call1]);

        // Get new nonce
        nonce = await account.getNonce();

        // Prove second transaction with updated nonce
        const invokeTx2 = await buildInvokeV3Transaction(account, [call2], nonce);
        const proof2 = await devnet.provider.proofs.proveTransaction("latest", invokeTx2);
        expect(proof2.proof_facts).to.have.lengthOf(9);

        // Proofs should be different (different transactions)
        expect(proof1.proof).to.not.equal(proof2.proof);
    });
});

/**
 * Build an INVOKE v3 transaction payload compatible with starknet_proveTransaction.
 */
async function buildInvokeV3Transaction(
    account: starknet.Account,
    calls: starknet.Call[],
    nonce: string | bigint,
    overrideBounds?: starknet.ResourceBoundsBN,
): Promise<InvokeV3Transaction> {
    // Compile the calldata
    const calldata = starknet.transaction.getExecuteCalldata(calls, account.cairoVersion);

    // Use provided bounds, or estimate them. Estimation will fail for reverting
    // calls, so pass `overrideBounds` when the test deliberately submits one.
    const bounds = overrideBounds ?? (await account.estimateInvokeFee(calls)).resourceBounds;

    const resourceBounds = {
        l1_gas: {
            max_amount: toHex(bounds.l1_gas.max_amount),
            max_price_per_unit: toHex(bounds.l1_gas.max_price_per_unit),
        },
        l1_data_gas: {
            max_amount: toHex(bounds.l1_data_gas.max_amount),
            max_price_per_unit: toHex(bounds.l1_data_gas.max_price_per_unit),
        },
        l2_gas: {
            max_amount: toHex(bounds.l2_gas.max_amount),
            max_price_per_unit: toHex(bounds.l2_gas.max_price_per_unit),
        },
    };

    // Build the unsigned transaction
    const unsignedTx: Omit<InvokeV3Transaction, "signature"> = {
        type: "INVOKE",
        version: "0x3",
        sender_address: account.address,
        calldata: calldata.map((c) => toHex(c)),
        nonce: toHex(nonce),
        resource_bounds: resourceBounds,
        tip: "0x0",
        paymaster_data: [],
        account_deployment_data: [],
        nonce_data_availability_mode: "L1",
        fee_data_availability_mode: "L1",
    };

    // Sign the transaction using the account's signer
    const chainId = await account.provider.getChainId();

    const signerDetails: starknet.V3InvocationsSignerDetails = {
        walletAddress: account.address,
        chainId,
        cairoVersion: account.cairoVersion,
        nonce: BigInt(nonce.toString()),
        version: "0x3",
        resourceBounds: bounds,
        tip: 0n,
        paymasterData: [],
        accountDeploymentData: [],
        nonceDataAvailabilityMode: starknet.EDataAvailabilityMode.L1,
        feeDataAvailabilityMode: starknet.EDataAvailabilityMode.L1,
    };

    const signature = await account.signer.signTransaction(calls, signerDetails);

    // Convert signature to array of hex strings
    // starknet.js Signature can be ArraySignatureType (string[]) or WeierstrassSignatureType
    let signatureStrings: string[];
    if (Array.isArray(signature)) {
        signatureStrings = signature.map((s) => (typeof s === "string" ? s : toHex(s)));
    } else {
        // WeierstrassSignatureType has r and s properties
        const sig = signature as { r: bigint; s: bigint };
        signatureStrings = [toHex(sig.r), toHex(sig.s)];
    }

    return {
        ...unsignedTx,
        signature: signatureStrings,
    };
}

function toHex(value: string | number | bigint): string {
    if (typeof value === "string" && value.startsWith("0x")) {
        return value; // Already a hex string
    }
    return "0x" + BigInt(value).toString(16);
}
