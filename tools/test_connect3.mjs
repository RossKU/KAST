import kaspa from 'kaspa';
const { RpcClient } = kaspa;

const endpoints = [
    "ws://tn12.kaspa.stream:17210",
    "wss://tn12.kaspa.stream:17210",
    "ws://tn12.kaspa.stream:17110",
    "wss://tn12.kaspa.stream:17110",
    "ws://tn12.kaspa.stream:18210",
    "wss://tn12.kaspa.stream:18210",
    "ws://tn12-wrpc.kaspa.stream:17210",
    "wss://wrpc.tn12.kaspa.stream:443",
    "wss://tn12.kaspa.stream/wrpc",
];

async function tryConnect(url) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.log(`  ${url} → timeout`);
            resolve(false);
        }, 8000);

        try {
            const rpc = new RpcClient(url);
            rpc.connect().then(async () => {
                clearTimeout(timeout);
                console.log(`  ${url} → CONNECTED!`);
                try {
                    const info = await rpc.getServerInfo();
                    console.log("  Server:", JSON.stringify(info).substring(0, 200));
                } catch(e) {
                    console.log("  getServerInfo error:", e.message);
                }
                try {
                    const bi = await rpc.getBlockDagInfo();
                    console.log("  BlockDAG:", JSON.stringify(bi).substring(0, 200));
                } catch(e) {
                    console.log("  getBlockDagInfo error:", e.message);
                }
                try { await rpc.disconnect(); } catch(_) {}
                resolve(true);
            }).catch((e) => {
                clearTimeout(timeout);
                console.log(`  ${url} → ${e.message}`);
                resolve(false);
            });
        } catch(e) {
            clearTimeout(timeout);
            console.log(`  ${url} → constructor error: ${e.message}`);
            resolve(false);
        }
    });
}

async function main() {
    console.log("=== Scanning TN12 wRPC endpoints ===\n");
    for (const url of endpoints) {
        const ok = await tryConnect(url);
        if (ok) {
            console.log(`\n✓ Working endpoint: ${url}`);
            break;
        }
    }
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
