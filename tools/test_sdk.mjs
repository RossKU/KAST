import kaspa from 'kaspa';

console.log("=== Kaspa SDK loaded ===");
console.log("Available exports:", Object.keys(kaspa).sort().join(', '));

// Check for covenant-related classes
const covenantRelated = Object.keys(kaspa).filter(k =>
    k.toLowerCase().includes('covenant') ||
    k.toLowerCase().includes('script') ||
    k.toLowerCase().includes('transaction') ||
    k.toLowerCase().includes('rpc') ||
    k.toLowerCase().includes('network')
);
console.log("\nRelevant exports:", covenantRelated.join(', '));

// Check version
if (kaspa.version) console.log("\nVersion:", kaspa.version);

// Try to see network types
if (kaspa.NetworkId) {
    console.log("\nNetworkId available");
    try {
        const tn12 = new kaspa.NetworkId("testnet-12");
        console.log("TN12 NetworkId:", tn12.toString());
    } catch(e) {
        console.log("TN12 NetworkId error:", e.message);
        try {
            const tn11 = new kaspa.NetworkId("testnet-11");
            console.log("TN11 works:", tn11.toString());
        } catch(e2) {
            console.log("TN11 error too:", e2.message);
        }
    }
}
