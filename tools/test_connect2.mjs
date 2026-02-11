import kaspa from 'kaspa';
const { RpcClient, Encoding } = kaspa;

async function main() {
    console.log("=== Testing RpcClient ===");

    // Try different constructor signatures
    try {
        console.log("\n--- Try 1: string URL ---");
        const rpc = new RpcClient("ws://127.0.0.1:17210");
        console.log("Created OK");
    } catch(e) {
        console.log("Error:", e.message);
    }

    try {
        console.log("\n--- Try 2: Borsh encoding with URL string ---");
        const rpc = new RpcClient(Encoding.Borsh, "ws://127.0.0.1:17210");
        console.log("Created OK");
    } catch(e) {
        console.log("Error:", e.message);
    }

    try {
        console.log("\n--- Try 3: No args ---");
        const rpc = new RpcClient();
        console.log("Created OK, methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(rpc)).filter(m => !m.startsWith('_')).join(', '));
    } catch(e) {
        console.log("Error:", e.message);
    }

    try {
        console.log("\n--- Try 4: config object with resolver ---");
        const rpc = new RpcClient({
            resolver: null,
            encoding: Encoding.Borsh,
        });
        console.log("Created OK");
    } catch(e) {
        console.log("Error:", e.message);
    }

    // Check if there's a Resolver class
    console.log("\n--- Checking for Resolver ---");
    console.log("Resolver:", kaspa.Resolver ? "exists" : "not found");
    console.log("RpcClient.defaultUrl:", RpcClient.defaultUrl || "not defined");

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
