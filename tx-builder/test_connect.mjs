import kaspa from 'kaspa';
const { RpcClient, NetworkId, Encoding } = kaspa;

// TN12 public nodes - try common ports
const endpoints = [
    "ws://127.0.0.1:17210",  // local node
    "wss://tn12.kaspa.ws",   // possible public endpoint
    "ws://tn12.kaspa.stream:17210", // possible
];

async function tryConnect(url) {
    console.log(`Trying ${url}...`);
    try {
        const rpc = new RpcClient({
            url: url,
            encoding: Encoding.Borsh,
            networkId: new NetworkId("testnet-12"),
        });

        await Promise.race([
            rpc.connect(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
        ]);

        console.log("  Connected!");
        const info = await rpc.getServerInfo();
        console.log("  Server info:", JSON.stringify(info, null, 2));
        await rpc.disconnect();
        return true;
    } catch(e) {
        console.log(`  Failed: ${e.message}`);
        return false;
    }
}

async function main() {
    console.log("=== Testing TN12 Connection ===\n");

    // First check what RpcClient expects
    console.log("RpcClient constructor:", typeof RpcClient);
    console.log("Encoding:", Encoding ? Object.keys(Encoding) : "undefined");

    for (const url of endpoints) {
        const ok = await tryConnect(url);
        if (ok) break;
    }

    console.log("\nDone.");
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
