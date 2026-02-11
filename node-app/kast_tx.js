const kaspa = require('kaspa');
const fs = require('fs');

const {
    RpcClient,
    PrivateKey,
    Address,
    ScriptBuilder,
    ScriptPublicKey,
    Transaction,
    TransactionInput,
    TransactionOutput,
    TransactionOutpoint,
    createAddress,
    Resolver,
} = kaspa;

// Load compiled SilverScript bytecode
const contract = JSON.parse(fs.readFileSync('../kast_simple.json', 'utf-8'));
console.log('Contract:', contract.contract_name);
console.log('Bytecode:', Buffer.from(contract.script).toString('hex'));
console.log('Bytecode length:', contract.script.length, 'bytes');
console.log('ABI:', JSON.stringify(contract.abi, null, 2));

async function main() {
    // Generate a test keypair
    const privKey = new PrivateKey('b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef');
    const keypair = privKey.toKeypair();
    const pubKey = keypair.publicKey;
    const address = keypair.toAddress('testnet');

    console.log('\n=== Test Keys ===');
    console.log('Address:', address.toString());
    console.log('Public Key:', pubKey.toString());

    // Build the script_public_key from SilverScript bytecode
    const scriptBytes = new Uint8Array(contract.script);
    console.log('\n=== Script Public Key ===');
    console.log('Script (hex):', Buffer.from(scriptBytes).toString('hex'));

    // Create ScriptPublicKey from the compiled bytecode
    const spk = new ScriptPublicKey(0, scriptBytes);
    console.log('ScriptPublicKey version:', spk.version);

    // Try connecting to TN12
    console.log('\n=== Connecting to TN12 ===');
    try {
        const rpc = new RpcClient({
            url: 'ws://127.0.0.1:17210',
            networkId: 'testnet-12',
        });

        console.log('Connecting...');
        await rpc.connect();
        console.log('Connected!');

        const info = await rpc.getServerInfo();
        console.log('Server info:', JSON.stringify(info, null, 2));

        // Get UTXO for our address
        const utxos = await rpc.getUtxosByAddresses({ addresses: [address.toString()] });
        console.log('\nUTXOs:', JSON.stringify(utxos, null, 2));

        if (utxos.entries && utxos.entries.length > 0) {
            const utxo = utxos.entries[0];
            console.log('\nUsing UTXO:', utxo.outpoint.transactionId, ':', utxo.outpoint.index);

            // Build a transaction that locks to our SilverScript contract
            const tx = new Transaction({
                version: 0,
                inputs: [
                    new TransactionInput({
                        previousOutpoint: new TransactionOutpoint(utxo.outpoint.transactionId, utxo.outpoint.index),
                        signatureScript: new Uint8Array([]),
                        sequence: 0,
                        sigOpCount: 1,
                    })
                ],
                outputs: [
                    new TransactionOutput({
                        value: BigInt(utxo.utxoEntry.amount) - 3000n, // minus fee
                        scriptPublicKey: spk,
                    })
                ],
                lockTime: 0n,
                subnetworkId: '0000000000000000000000000000000000000000',
                gas: 0n,
                payload: '',
            });

            console.log('\n=== Transaction Built ===');
            console.log('TX:', JSON.stringify(tx, null, 2));
        } else {
            console.log('\nNo UTXOs found. Fund this address first:', address.toString());
            console.log('Then re-run this script.');
        }

        await rpc.disconnect();
    } catch (err) {
        console.log('RPC connection failed (expected if no local TN12 node):', err.message || err);
        console.log('\nTo test with TN12:');
        console.log('1. Run a TN12 node: cargo run --release --bin kaspad -- --testnet --netsuffix=12 --utxoindex');
        console.log('2. Mine some coins to:', address.toString());
        console.log('3. Re-run this script');
    }

    // Even without TN12 connection, show the contract deployment TX structure
    console.log('\n=== KAST Contract Deployment TX Structure ===');
    console.log('1. Input: Fund from test wallet UTXO');
    console.log('2. Output: Lock to SilverScript bytecode');
    console.log('   script_public_key:', Buffer.from(scriptBytes).toString('hex'));
    console.log('3. To vote: Provide (sig, pubkey) in signature_script');
    console.log('   → Contract verifies: checkSig, outputs.length==1, value preservation');
}

main().catch(console.error);
