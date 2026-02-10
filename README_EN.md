# KAST — Kaspa Anonymous Sealed Token

> A UTXO Physical Vote Protocol on Kaspa
>
> *"Cast your vote. Burn the proof. Keep the truth."*

## Motivation

The goal of KAST is not to reinvent elections — it is to make the existing system tamper-proof by anchoring it to a blockchain.

Today's voting infrastructure already works: physical ballots, sealed envelopes, in-person ID verification, and public tallying. What it lacks is **cryptographic guarantees** against fraud, manipulation, and opacity. KAST preserves the familiar physical voting experience while embedding every critical step — token issuance, anonymization, casting, and counting — into Kaspa's L1 consensus, making each one immutable and publicly verifiable.

### Implementation Scope

With the **Covenant++ hard fork (TN12)**, a limited but functional subset of KAST is achievable: one-time vote tokens via UTXO, ZK-based eligibility proofs, covenant-enforced candidate constraints, and transparent on-chain tallying. This is sufficient for pilot deployments and proof-of-concept elections.

However, for production-grade national elections — requiring encrypted tallying, liquid delegation, cross-district composability, and full receipt-freeness — **waiting for vProgs is the prudent path**. vProgs will bring CairoVM execution, global state management via Computation DAG, and Proof Stitching, enabling the cryptographic sophistication that large-scale elections demand without compromising Kaspa's L1 security model.

**In short: Covenant++ proves the concept. vProgs delivers the system.**

---

## Overview

KAST is a physical-digital hybrid electronic voting protocol built on Kaspa's Covenant++ hard fork (TN12).

It applies the UTXO model's "consumed once, gone forever" property to vote tokens, combining ZK proof-based anonymization with covenant script rule enforcement to achieve **secret ballot elections with L1 consensus-level security**.

### Core Principles

| Principle | Mechanism |
|---|---|
| One person, one vote | UTXO double-spend prevention = double-vote prevention |
| Ballot secrecy | ZK proof severs the link between voter and vote content |
| Proof of participation | Original token UTXO's spent status is verifiable on-chain |
| Non-reissuable | UTXO destruction + mint authority burn |
| Public tallying | UTXO count at candidate addresses (verifiable by anyone) |
| Tamper-proof | Kaspa L1 consensus (PoW + DAG) protects all transactions |

---

## Architecture

### Kaspa Covenant++ Features Used

| Feature | Purpose |
|---|---|
| Covenant ID | Unique identifier for election tokens. All tokens belong to the same covenant chain |
| OpZkPrecompile (0xa6) | Verifies voter eligibility ZK proofs on L1 (RISC0 / Groth16) |
| Introspection opcodes | Output destination constraints, value preservation, time window enforcement |
| UTXO model | 1 token = 1 vote. Automatically destroyed after use |

### On-chain Structure

```
Transaction structure (unchanged):
  TransactionInput:
    previous_outpoint    ← reference to vote token UTXO
    signature_script     ← signature + ZK proof data (binary push)

  TransactionOutput:
    value                ← minimum (1 sompi)
    script_public_key    ← covenant rules (voting constraint script)
    covenant             ← Option<CovenantBinding>
      authorizing_input  ← index of the authorizing input
      covenant_id        ← election ID (Hash)
```

---

## Protocol Flow

### Phase 0: Election Setup

```
Election Commission:
  1. Build Merkle tree from voter registry
     Leaf = each voter's public key
  2. Issue Election Genesis TX
     Output: Election Master UTXO
       covenant_id: Hash(outpoint + outputs) ← unique election ID
       script_public_key: [Merkle root, candidate list, election rules]
  3. Commit Merkle root and tree size on-chain (public information)
```

### Phase 1: Token Minting + Physical Delivery

```
Mint TX (executed by commission via multisig):
  Input:  Election Master UTXO
  Outputs:
    [0]: Voter A's token UTXO
         covenant_id: election ID (continuation)
         script_public_key: <voter_A_pubkey> OpCheckSig + anonymization rules
    [1]: Voter B's token UTXO
    ...
    [N]: Next Mint Master UTXO (continuation)
         * Final Mint TX has no continuation → Master UTXO destroyed

Physical delivery:
  Each voter's private key encoded as QR code
  → Sealed in envelope and mailed (QR1)
```

### Phase 2: Anonymization (Identity Verification at Polling Station)

```
[Physical process]
  Voter brings QR1 envelope to polling station
  → Identity verification (ID check)
  → Station terminal constructs and broadcasts Anonymize TX
  → Prints new QR2 (anonymous vote token)

[On-chain process]
  Anonymize TX:
    Input: Voter A's identifiable token UTXO

    signature_script:
      ├── Voter A's signature (signed with private key)
      ├── ZK Proof (RISC0 or Groth16):
      │     Proves:
      │       "My public key is included in the election Merkle tree"
      │       "This nullifier is uniquely derived from my key"
      │     Hidden:
      │       Which leaf (which voter) is not revealed
      └── tag: 0x21 (RISC0 Succinct) or 0x20 (Groth16)

    Output: Anonymous token UTXO
      covenant_id: same election ID (continuation)
      script_public_key: <new_random_pubkey> + vote destination rules
      value: 1 sompi

  * At this point QR1's UTXO is destroyed → QR1 is invalidated
  * The link between Input (Voter A) and Output (anonymous token) is severed by ZK
```

### Phase 3: Voting

```
[Physical process]
  Voter scans QR2 at station PC
  → Selects candidate via touch interface
  → Terminal sends Vote TX
  → QR2 is consumed (UTXO destroyed)

[On-chain process]
  Vote TX:
    Input: Anonymous token UTXO

    signature_script:
      └── Signature with anonymous key

    Output: Candidate C's collection address
      covenant_id: same election ID (continuation)
      script_public_key: candidate_C_collection_script
      value: 1 sompi

  Rules enforced by covenant script:
    OpInputCovenantId      → verify covenant chain
    OpCovOutCount          → exactly 1 output
    OpTxOutputSpk          → output destination is in candidate list
    OpTxOutputAmount       → value is preserved
```

### Phase 4: Tallying

```
UTXO count at Candidate A's collection address = Candidate A's votes
UTXO count at Candidate B's collection address = Candidate B's votes
...

→ Verifiable on-chain by anyone
→ No central server or administrator involvement
```

### Phase 5: Verification

```
Proof of participation:
  Voter A's original token UTXO → spent (verifiable on-chain)
  → "Voter A participated in the election" ✓

Vote content secrecy:
  Voter A's anonymous token → Candidate ?'s address
  → Link severed in Phase 2, untraceable ✓
```

---

## QR Token Lifecycle

### QR1 (Mailed in Envelope)

```
Generated → mailed in envelope → used at polling station (Anonymize TX) → UTXO destroyed → done

× Reuse: UTXO no longer exists (consensus rejects)
× Reissue: Master UTXO already burned (mint authority destroyed)
× Copy: if used first, UTXO is gone; cannot be used again
         + identity verification at polling station (2-of-2 multisig) required
```

### QR2 (Printed at Polling Station)

```
Generated at terminal → used immediately for voting → UTXO destroyed → done

× Reuse: UTXO no longer exists
× Reissue: QR1 already destroyed, cannot re-execute Anonymize TX
× Copy: generated and used within terminal, physically difficult to copy
```

---

## Security: Attack Vectors and Countermeasures

### 1. Timing Analysis Attack

**Threat**: Temporal proximity between Anonymize TX and Vote TX could allow linking voter to vote content.

```
Example: Voter A anonymizes at 14:32:01, votes for Candidate X at 14:32:03
         → Time correlation suggests A → X
```

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Time-window batching | Covenant script uses OpTxInputDaaScore to separate anonymization and voting periods. Window 1 (morning): anonymization only. Window 2 (afternoon): voting only |
| High BPS utilization | Kaspa at 100 BPS produces 100 blocks per second. Many TXs land in the same block, making individual linking difficult |
| Terminal batch broadcast | Polling station terminals queue Anonymize TXs and broadcast in batches, concealing individual timing |

### 2. Election Commission Fraud (Token Inflation)

**Threat**: Commission mints more tokens than eligible voters and casts fraudulent votes.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Mint authority sealing | Final Mint TX burns Master UTXO (no continuation output). Minting becomes impossible thereafter |
| Public issuance audit | Merkle tree leaf count = voter count (public). All Mint TXs are visible on-chain. Token count can be cross-referenced with voter rolls |
| Multisig requirement | Master UTXO's script_public_key requires OpCheckMultiSig. N-of-M signatures needed to mint (prevents single-actor fraud) |
| Covenant constraint | Output count ≤ Merkle tree size + 1 (continuation) enforced by script |

### 3. QR1 Theft or Loss

**Threat**: If the envelope is stolen, the attacker could use the vote token first.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| 2-of-2 multisig | QR1's UTXO = voter's key + station terminal's key. Both required to execute Anonymize TX. Stealing the envelope alone is insufficient |
| In-person ID verification | Physical ID check (driver's license, national ID, etc.) is a prerequisite for terminal co-signing |
| Loss handling | Non-reissuable (Master is burned). Treated as loss of voting right (equivalent to losing a paper ballot) |

### 4. Coercion and Vote Buying

**Threat**: Voter is pressured to prove they voted for a specific candidate.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Anonymous key destruction | QR2's private key is generated, used, and immediately destroyed within the terminal's secure environment (TEE). The voter never knows the anonymous key |
| Irreversible link severance | ZK-based anonymization is one-way. The voter has no means to prove which anonymous token was theirs |
| Physical isolation | Polling station terminals are air-gapped. Voting booth design physically prevents screen capture |

### 5. Polling Station Terminal Tampering

**Threat**: A compromised terminal votes for a different candidate than the voter selected.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Confirmation screen | Display selection before TX broadcast. Show candidate address hash for verification |
| Open-source terminal | Polling station software is publicly available for third-party audit |
| Multi-terminal verification | Multiple independent terminals construct the TX; broadcast only if they agree |
| Post-vote receipt | Print short hash of the voted candidate address for post-hoc verification (balanced against coercion concerns) |

### 6. Sybil Attack (Fake Voter Registration)

**Threat**: Fictitious voters are added to the registry and included in the Merkle tree.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Public registry audit | Voter registry (Merkle tree leaf count) is public. Cross-referenced with census data |
| Integration with existing systems | Linked to national resident registry or national ID system; only verified individuals are registered |
| Pre-election Merkle root publication | Merkle root published before voting begins. Voters can verify their own inclusion |

### 7. Network Attack (51% Attack)

**Threat**: Attacker acquires majority hashrate on Kaspa network and alters vote TXs.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Kaspa's PoW + DAG resilience | DAG structure makes simple 51% attacks harder than on traditional blockchains |
| Limited voting period | Short voting window limits the time available for an attacker to amass hashrate |
| Finality confirmation | Wait for sufficient confirmations (DAG depth) before finalizing results |
| Multi-layer verification | Cross-reference on-chain results with physical polling station logs |

### 8. Privacy Leakage (Chain Analysis)

**Threat**: Pattern analysis of vote TXs (amounts, fees, script sizes) could identify voters.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Uniform TX structure | All vote TXs have identical value, fee, and script size. Eliminates pattern analysis vectors |
| Fixed token amount | All tokens are uniformly 1 sompi |
| Unified script | Anonymous token's script_public_key uses identical structure for all voters |

---

## Why Kaspa

| Dimension | Ethereum (Account) | Bitcoin (UTXO) | Kaspa Covenant++ (UTXO) |
|---|---|---|---|
| One-person-one-vote | Manual via mapping + require | Difficult due to script limits | **Native UTXO guarantee** |
| Double-vote prevention | Smart contract bug risk | ○ | **Consensus-level guarantee** |
| Ballot secrecy | External tools (Tornado Cash, etc.) | Difficult | **L1 ZK precompile** |
| Tally transparency | Requires contract trust | ○ | **Self-evident via UTXO count** |
| Throughput | ~15 TPS | ~7 TPS | **10-100 BPS, parallelizable** |
| Central server | Not required | Not required | **Not required** |
| Rule enforcement | EVM (broad attack surface) | Limited | **Covenant (minimal attack surface)** |

### Comparison with Other ZK / Privacy Chains

Other L1s are viable candidates for voting systems. The following is an honest comparison against KAST's requirements.

| | Kaspa (Covenant++ / vProgs) | Aztec (Ethereum L2) | Aleo | Cardano (eUTXO) |
|---|---|---|---|---|
| Consensus | **PoW (strongest censorship resistance)** | PoS (Ethereum) | PoS | PoS |
| Data model | **UTXO** | Notes (UTXO-like) | Records (UTXO-like) | **eUTXO** |
| Privacy | Via ZK proof | **Native (all TXs encrypted)** | **Native** | Via ZK proof |
| L1 ZK verification | **Yes (Groth16 / RISC0)** | **Yes** | **Yes** | Limited |
| L1 programmability | Limited (stack-based) | High (Noir) | High (Leo) | High (Plutus) |
| Throughput | **10,000+ TPS (at 100 BPS)** | Ethereum-dependent | Low | Low |

#### Privacy: Aztec and Aleo are superior

Aztec and Aleo embed privacy at the protocol level into every transaction. This means voter anonymity is guaranteed automatically, without the explicit anonymization step (Phase 2) that KAST requires. On Kaspa, anonymization must be explicitly implemented via ZK proofs and UTXO transitions.

#### Programmability: Kaspa L1 is limited, but sufficient for KAST

Kaspa's L1 script is an extension of Bitcoin Script and is not Turing-complete. Loops, dynamic arrays, and recursion are unavailable. Aztec (Noir), Aleo (Leo), and Cardano (Plutus) offer expressiveness close to general-purpose programming languages.

However, every piece of logic KAST requires can be expressed within the L1 script's capabilities:

- Merkle membership verification → `OpZkPrecompile` verifies ZK proof
- 1 input → 1 output constraint → `OpCovOutCount` enforces
- Output destination in candidate list → `OpTxOutputSpk` verifies
- Value preservation → `OpTxOutputAmount` verifies
- Time window constraint → `OpTxInputDaaScore` enforces

More complex logic such as encrypted tallying and liquid delegation will be addressed by vProgs (CairoVM L2) in the future.

#### vProgs (L2) Security: Based Rollup Design

vProgs adopts a "Based Rollup" design, which differs fundamentally from typical L2s in its extreme dependence on L1:

| Role | Typical L2 | Kaspa vProgs |
|---|---|---|
| Sequencing (TX ordering) | Own sequencer (censorship risk) | **Kaspa L1 handles it (PoW-protected)** |
| Data availability | Own or external DA (hiding risk) | **Kaspa L1 holds all data** |
| Settlement (validity verification) | Fraud proofs or ZK proofs | **ZK proofs verified by L1** |
| Execution | On L2 | **Off-chain (CairoVM)** |

The only role L2 assumes independently is execution. Sequencing, data availability, and settlement are all delegated to L1's PoW consensus. Attacking vProgs requires either "breaking ZK proof mathematics" or "breaking Kaspa L1's PoW" — neither of which is practically feasible.

#### Censorship Resistance: The most critical requirement for elections

Elections are a use case that directly confronts state power. While PoS chains are adequate for DeFi or NFTs, voting systems face a unique threat: governments have a direct incentive to censor vote transactions.

- **PoW**: Miners are anonymous and globally distributed. Structurally difficult to compel them to reject specific transactions.
- **PoS**: Validators are known and identifiable by their stake. Theoretically possible for a government to pressure validators into rejecting specific transactions.

For voting systems, PoW censorship resistance is not a "nice-to-have" — it is a "fatal if absent" requirement.

#### Throughput: 10,000+ TPS covers elections worldwide

Kaspa achieves 10,000+ TPS at 100 BPS. The following estimates show the TPS required for national elections in major countries:

| Country | Voters | Voting hours | Required TPS | Load on 10,000 TPS |
|---|---|---|---|---|
| Japan | 55 million | 13 hours | ~2,350 | 23% |
| United States | 144 million | 13 hours | ~6,150 | 62% |
| EU (combined) | 185 million | 13 hours | ~7,900 | 79% |
| India | 620 million | Spread over multiple days | Distributed | — |

KAST requires 2 TXs per voter (anonymization + voting). Japan's national election can be processed at roughly 23% of Kaspa's capacity, with ample headroom even under peak load conditions.

#### Conclusion: Why Kaspa

Aztec and Aleo are superior in privacy alone, and Cardano and Ethereum surpass Kaspa in L1 programmability. However, **no other chain combines PoW censorship resistance + UTXO model + L1 ZK verification + 10,000+ TPS**.

Censorship resistance is the highest-priority requirement for election systems, and PoS chains cannot match PoW on this front. Kaspa was not designed for voting, but it possesses the most suitable combination of properties for building a voting system.

### Opcodes Used

| Category | Opcode | Code | Purpose |
|---|---|---|---|
| ZK Verification | OpZkPrecompile | 0xa6 | Verify voter eligibility ZK proof |
| Covenant | OpInputCovenantId | 0xcf | Verify election covenant chain |
| Covenant | OpCovOutCount | 0xd2 | Constrain same-covenant output count |
| Covenant | OpCovOutputIdx | 0xd3 | Same-covenant output index |
| Covenant | OpAuthOutputCount | 0xcb | Authorized output count |
| Introspection | OpTxOutputSpk | 0xc3 | Verify output is in candidate list |
| Introspection | OpTxOutputAmount | 0xc2 | Verify value preservation |
| Introspection | OpTxInputAmount | 0xbe | Confirm input token amount |
| Introspection | OpTxInputDaaScore | 0xc0 | Enforce time windows (batching) |
| Signature | OpCheckSig | 0xac | Voter / terminal signature verification |
| Signature | OpCheckMultiSig | 0xae | Commission multisig / 2-of-2 |
| Hash | OpBlake2b | 0xaa | Nullifier derivation, data hashing |

---

## Limitations and Future Outlook

### Limitations at the Covenant++ Stage

| Limitation | Description |
|---|---|
| Encrypted tallying | With the "send to candidate address" model, the anonymous token's destination is public. Not a practical issue since the link is severed, but fully encrypted tallying requires vProgs |
| Script size limits | Complex voting rules (delegated voting, ranked-choice, etc.) may not fit within L1 script constraints |
| Indexer dependency | Efficient covenant_id-based tally queries require a dedicated indexer |

### Future Extensions with vProgs

| Extension | Description |
|---|---|
| Fully encrypted voting | CairoVM + Stwo enables tallying encrypted votes. Even candidate addresses remain hidden |
| Liquid Democracy | vProg global state manages delegation relationships |
| Real-time turnout display | vProg aggregates voting status, published with ZK proof |
| Cross-district composition | Multiple district vProgs combined via Proof Stitching |

---

## Tech Stack

| Component | Technology |
|---|---|
| L1 Blockchain | Kaspa (PoW + blockDAG, Covenant++ HF) |
| ZK Proof Generation | RISC0 (Rust guest program) / Groth16 (ark-bn254) |
| ZK Proof Verification | OpZkPrecompile (0xa6) on Kaspa L1 |
| Merkle Tree | Blake2b hash-based |
| Token Management | Covenant ID + UTXO |
| Physical Delivery | QR code in sealed envelope |
| Voting Terminal | Open-source, TEE-enabled |

---

## License

ISC

---

## References

- [Kaspa rusty-kaspa TN12](https://github.com/kaspanet/rusty-kaspa/tree/tn12)
- [Kaspa TN12 Documentation](https://github.com/kaspanet/rusty-kaspa/blob/tn12/docs/testnet12.md)
- [kaspanet/vprogs](https://github.com/kaspanet/vprogs)
- [vProgs Yellow Paper](https://kaspa.co.il/wp-content/uploads/2025/09/vProgs_yellow_paper.pdf)
- [Michael Sutton's covenant++ notes](https://gist.github.com/michaelsutton/5bd9ab358f692ee4f54ce2842a0815d1)
