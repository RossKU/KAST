# KAST — Kaspa Anonymous Sealed Token

> A UTXO Physical Vote Protocol on Kaspa
>
> *"Cast your vote. Burn the proof. Keep the truth."*

**[日本語版 / Japanese](README_JA.md)**

---

## Motivation

The goal of KAST is not to reinvent elections — it is to make the existing system tamper-proof by anchoring it to a blockchain.

Today's voting infrastructure already works: physical ballots, sealed envelopes, in-person ID verification, and public tallying. What it lacks is **cryptographic guarantees** against fraud, manipulation, and opacity. KAST preserves the familiar physical voting experience while embedding every critical step — token issuance, anonymization, casting, and counting — into Kaspa's L1 consensus, making each one immutable and publicly verifiable.

### Implementation Scope

KAST is built on two layers of Kaspa's evolution:

- **Covenant++ (L1)**: UTXO token lifecycle — minting, anonymization, voting, aggregation, timelock release. Enforced by consensus.
- **vProgs (L2)**: Encrypted ballot casting, Benaloh Challenge verification, homomorphic tallying, and cross-district composition. Executed off-chain via CairoVM, verified on L1 via ZK proofs.

Both layers are required for the complete system. Covenant++ provides the token infrastructure; vProgs provides the cryptographic privacy and voter verification layer.

---

## Overview

KAST is a physical-digital hybrid electronic voting protocol built on Kaspa's Covenant++ (L1) and vProgs (L2).

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
    value                ← TOKEN_VAL (0.1 KAS)
    script_public_key    ← covenant rules (voting constraint script)
    covenant             ← Option<CovenantBinding>
      authorizing_input  ← index of the authorizing input
      covenant_id        ← election ID (Hash)
```

---

## Protocol Flow

```
[Pre-election]
  QR1 distributed to each voter (empty wallet = keypair only, no KAS)
  Election Genesis TX creates Master UTXO with unique covenant_id

[Election day — at polling station, ~3 minutes per voter]
  Phase 1: Commission JIT-mints token → voter's wallet         (KASTMint)
  Phase 2: Voter + Station 2-of-2 burn → anonymous QR2 issued  (KASTAnon)
  Phase 3: Voter writes candidate on QR2 paper → scans at PC    (KASTVote)
           → encrypted Vote TX → optional Benaloh on smartphone
           QR2 paper collected in ballot box

[During election — background]
  Phase 4a: Commission aggregates vote UTXOs in real-time       (KASTTally.aggregate)

[Post-election]
  Phase 4b: Timelock expires → KAS recovered                    (KASTTally.release)
  Tally:    total_value / TOKEN_VAL per candidate = vote count
```

### Phase 0: Election Setup

```
Election Commission:
  1. Generate Election Genesis TX
     Output: Election Master UTXO
       covenant_id: Hash(outpoint + outputs) ← unique election ID
  2. Generate QR1 for each registered voter
     QR1 = keypair only (empty wallet, no KAS pre-loaded)
     Private key encoded as QR code, distributed to voter
  3. Build Merkle tree from voter registry (for ZK verification)
     Commit Merkle root on-chain (public information)
```

### Phase 1: JIT Token Minting

Tokens are minted on-demand as voters arrive at polling stations — no pre-minting required.

```
Mint TX (commission dual-sig):
  Input:  Election Master UTXO (or continuation)
  Outputs:
    [0]: Voter token UTXO (value = TOKEN_VAL)
         covenant_id: election ID (continuation)
         script_public_key: KASTAnon(voter_pubkey, station_pubkey, electionAuthority, electionEnd)
    [1]: Continuation Master UTXO (same script)
         * Final Mint TX: no continuation → Master UTXO destroyed (seal)

  Covenant rules enforced (KASTMint contract):
    checkSig × 2          → dual-sig from commissioners
    OpCovOutCount          → all outputs in same covenant chain
    output.value           → uniform TOKEN_VAL per token
    output.lockingBytecode → continuation preserves master script

  Flexible batch: 1 to 4 tokens per TX (busy stations can pre-mint small pools)
```

### Phase 2: Anonymization (QR1 → QR2)

Physical anonymization at the polling station severs the link between voter identity and ballot.

```
[Physical process]
  1. Voter presents QR1 (identity wallet)
  2. Station verifies identity (ID check)
  3. Voter + Station co-sign Anonymize TX (2-of-2)
  4. Station generates fresh keypair → prints QR2 (anonymous ballot)
  5. QR1 is collected / invalidated

[On-chain process]
  Anonymize TX:
    Input: Voter's identifiable token UTXO

    signature_script:
      ├── Voter's signature (QR1 private key)
      └── Station terminal's signature (co-sign)
      + ZK Proof via OpZkPrecompile (on-chain anonymization)

    Output: Anonymous token UTXO
      covenant_id: same election ID (continuation)
      script_public_key: KASTVote(candidateA, ..., candidateJ, electionAuthority, electionEnd)
      value: TOKEN_VAL

  Covenant rules enforced (KASTAnon contract):
    checkSig × 2           → 2-of-2: voter key + station key
    OpZkPrecompile         → ZK proof severs on-chain voter→ballot link
    OpCovOutCount == 1     → exactly 1 anonymous output
    output.value == TOKEN_VAL → exact value (prevents fingerprinting)
    recover(sig) + timelock → deposit recovery if voter abandons

  * QR1's UTXO is destroyed → QR1 becomes invalid
  * Physical QR exchange provides coercion/bribery resistance
  * On-chain link is cryptographically severed via ZK proof
```

### Phase 3: Voting (Parallel Paper Ballot)

Voter uses QR2 at the station PC. QR2 paper doubles as a physical ballot — collected after use for post-election audit.

```
QR2 paper design:
  ┌─────────────────────────┐
  │  [QR Code]              │  ← anonymous key (scanned by terminal)
  │                         │
  │  Candidate: ___________ │  ← voter writes name (optional, recommended)
  │                         │
  │  Election: 2027 ...     │
  └─────────────────────────┘

[Physical process]
  1. Voter receives QR2 paper
  2. Voter writes candidate name on paper (intent recorded physically FIRST)
  3. Voter scans QR2 at station PC → selects same candidate on screen
  4. Terminal displays destination address — voter verifies against posted
     candidate address list on the booth wall
  5. Terminal constructs encrypted Vote TX → broadcast
  6. Optional: voter runs Benaloh Challenge on smartphone (see below)
  7. QR2 paper collected in ballot box (like a paper ballot)
  8. Voter receives sticker / participation receipt

[Benaloh Challenge — optional smartphone verification]
  After step 5, before step 7:
  a. Terminal displays enc_vote as QR code
  b. Voter scans with smartphone verification app (open source, multi-vendor)
  c. Voter taps "Challenge" → terminal reveals randomness as QR
  d. Voter scans → app decrypts → shows candidate name
  e. Voter confirms it matches their selection → this vote is DISCARDED
  f. Repeat until satisfied → final "Cast" sends the real vote
  * Terminal cannot cheat: encryption binding makes fake randomness impossible
  * Smartphone only sees discarded challenge votes, not the real cast

[On-chain process]
  Vote TX:
    Input: Anonymous token UTXO

    signature_script:
      └── Signature with anonymous key (QR2)

    Output: Encrypted vote → candidate's collection address
      covenant_id: same election ID (continuation)
      script_public_key: candidate collection script (P2PK)
      value: TOKEN_VAL

  Covenant rules enforced (KASTVote contract):
    checkSig               → anonymous key signature
    OpCovOutCount == 1     → exactly 1 vote output
    OpTxOutputSpk          → destination is in candidate whitelist (up to 10)
    output.value == TOKEN_VAL → exact value (prevents fingerprinting)
    OpInputCovenantId      → covenant chain verification
    recover(sig) + timelock → deposit recovery if ballot abandoned
```

### Phase 4: Tallying + Real-time Aggregation

During the election, the commission periodically consolidates vote UTXOs to free up locked capital. After the election, KAS is recovered via timelock release.

```
[During election — Real-time Aggregation]
  Aggregate TX (commission signature):
    Inputs: Multiple vote UTXOs at same candidate address (up to 8)
    Output: 1 consolidated UTXO (value = sum of inputs)

  Covenant rules enforced (KASTTally.aggregate):
    checkSig                    → election authority only
    OpCovInputCount             → count same-covenant inputs
    OpCovInputIdx + input.value → sum all input values
    output.value >= total       → value preservation
    output.lockingBytecode      → self-referencing (same tally script)
    OpCovOutCount == 1          → single consolidated output

  Example: 8 vote UTXOs (0.8 KAS) → 1 UTXO (0.8 KAS)

[Post-election — Tally & Release]
  Vote count = total_value_at_candidate_address / TOKEN_VAL
  → Verifiable on-chain by anyone, no central server

  Release TX (commission signature + timelock):
    require(tx.time >= electionEnd)
    → Commission recovers deposited KAS after election concludes
```

### Phase 5: Physical-Digital Audit

Post-election, collected QR2 papers are scanned and cross-referenced with on-chain data for full-coverage consistency verification.

```
[Audit process — under election observer supervision]
  1. Ballot boxes opened, QR2 papers extracted
  2. QR2 papers batch-scanned (barcode reader / camera)
  3. Anonymous public keys extracted from each QR code
  4. Audit API cross-references each key with on-chain Vote TX:

     Layer 1 — Count verification (100%, automated):
       QR2 papers collected vs Vote TXs on chain
       Match → all votes accounted for
       Papers < TXs → phantom votes detected (terminal fabrication)
       Papers > TXs → unused ballots (voter left without voting)

     Layer 2 — Signature verification (100%, automated):
       Each QR2 public key → find Vote TX signed by this key
       Verify: covenant chain valid, value == TOKEN_VAL, destination in whitelist

     Layer 3 — Handwriting cross-check (statistical):
       For papers with handwritten candidate names:
       OCR / manual read → compare with chain vote destination
       Normal noise rate: ~2-3% (equivalent to current invalid ballot rate)
       Anomalous rate (>10%): triggers full investigation at that station

[Proof of participation]
  Voter's QR1 token UTXO → spent (verifiable on-chain)
  → "This voter participated in the election" ✓
  Compulsory voting countries: KASTReceipt UTXO (separate TX) as supplementary proof

[Vote content secrecy]
  ZK proof cryptographically severs voter → ballot link
  Physical QR exchange provides additional coercion resistance
  Encrypted voting ensures on-chain vote content is not visible
```

---

## QR Token Lifecycle

### QR1 (Identity Wallet — distributed pre-election)

```
Generated → distributed to voter (empty wallet, keypair only)
→ Voter brings to polling station
→ Token JIT-minted to QR1 wallet (Phase 1)
→ Used for anonymization (Phase 2, 2-of-2 co-sign) → UTXO destroyed
→ QR1 collected at station → done

× Reuse: UTXO no longer exists (consensus rejects)
× Reissue: Master UTXO already burned (mint authority destroyed)
× Stolen: useless alone — requires station terminal co-sign (2-of-2)
× Photographed: on-chain shows participation only, not vote choice (with ZK)
```

### QR2 (Anonymous Ballot Paper — generated at polling station)

```
Generated at terminal (fresh keypair) → printed on ballot paper
  Paper has: QR code (anonymous key) + write area for candidate name
→ Voter writes candidate name on paper (physical intent record)
→ Voter scans QR2 at station PC → selects candidate → encrypted Vote TX
→ Optional: Benaloh Challenge on smartphone (terminal honesty verification)
→ QR2 paper collected in ballot box → done

Post-election:
→ QR2 papers batch-scanned → API cross-references with on-chain votes
→ Handwritten names compared with chain results (statistical audit)
→ Count of papers vs count of on-chain TXs (full-coverage verification)

× Reuse: UTXO no longer exists
× Reissue: QR1 already destroyed, cannot re-execute Anonymize TX
× Coercion: voter cannot prove vote choice (QR2 collected, vote encrypted, link severed)
× Recovered: ZK prevents tracing back to voter; encrypted vote hides candidate choice
```

---

## Security: Attack Vectors and Countermeasures

### 1. Timing Analysis Attack

**Threat**: In the JIT flow, Mint → Anon → Vote happens within ~3 minutes at the station. An observer could correlate a voter's arrival time with on-chain TX timestamps to link voter identity to vote content.

```
Example: Voter A arrives at 14:30, on-chain shows Mint at 14:31, Anon at 14:32, Vote for X at 14:33
         → Time correlation suggests A → X
```

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Terminal batch broadcast | Station terminals queue all TXs (Mint, Anon, Vote) and broadcast in randomized batches every N minutes. Individual timing is concealed within the batch |
| Physical booth separation | Phase 2 (anonymization) and Phase 3 (voting) occur in physically separate booths. Observer cannot correlate which voter enters which booth |
| High BPS utilization | Kaspa at 100 BPS: many TXs land in the same block. With batching, dozens of voters' TXs are interleaved |
| DaaScore windows | When OpTxInputDaaScore is available, covenant-enforced time separation between phases can be added |

### 2. Election Commission Fraud (Token Inflation)

**Threat**: Commission JIT-mints more tokens than voters who actually arrive, casting fraudulent votes.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Mint authority sealing | `seal()` entrypoint burns Master UTXO permanently. Minting becomes impossible after seal |
| JIT audit trail | Every Mint TX is on-chain with timestamp. Total minted tokens can be cross-referenced with polling station visitor logs in real-time |
| Dual-sig requirement | KASTMint requires both commissioners' signatures. Single-actor fraud is impossible |
| Public issuance count | Merkle tree leaf count = registered voter count (public). Minted tokens exceeding this count are immediately detectable |
| Covenant constraint | KASTMint enforces uniform TOKEN_VAL per output and covenant chain continuity |

### 3. QR1 Theft or Loss

**Threat**: QR1 is mailed in a sealed envelope. If intercepted, the attacker could impersonate the voter.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| 2-of-2 multisig | KASTAnon requires voter's signature (QR1) + station terminal's signature. Stolen QR1 alone cannot execute Anonymize TX |
| In-person ID verification | Physical ID check (driver's license, national ID, etc.) is a prerequisite for the station terminal to co-sign |
| JIT protection | In v2, QR1 is an empty wallet — no token exists until the voter arrives. Stealing QR1 before arrival gains nothing; the attacker must also pass ID verification at the station |
| Loss handling | Non-reissuable (Master can be sealed). Treated as loss of voting right. Voter can report loss for audit trail |

### 4. Coercion and Vote Buying

**Threat**: Voter is pressured to prove they voted for a specific candidate, or sells their vote.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Physical QR exchange | QR1 → QR2 exchange at the station creates a physical break. Voter walks away without any proof of vote choice |
| QR2 collection | QR2 is physically collected after voting (like a paper ballot in a ballot box). Voter cannot retain proof |
| Anonymous key destruction | QR2's private key is generated and used within the terminal's secure environment (TEE). Destroyed after Vote TX |
| Link severance | Physical: only the station sees QR1→QR2 mapping. ZK: on-chain link is cryptographically broken |
| Booth isolation | Voting booth prevents screen capture. Terminal is air-gapped |
| Vote buying futility | Buying QR1 is useless — the buyer cannot control the vote (QR2 is generated at the station with a fresh key) |

### 5. Polling Station Terminal Tampering

**Threat**: A compromised terminal votes for a different candidate than the voter selected, or leaks the QR1→QR2 mapping. (See also: [Vector 10](#10-terminal-trust-vote-integrity) for physical-digital countermeasures)

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Confirmation screen | Display candidate selection before Vote TX broadcast. Show candidate name and address hash |
| Open-source terminal | All polling station software is publicly auditable. Hardware attestation via TEE |
| Multi-terminal verification | Multiple independent terminals construct the TX; broadcast only if outputs match |
| Log destruction | Station terminal destroys QR1→QR2 mapping logs after each voter's session. No persistent record |
| Watchdog observers | Independent election observers can monitor terminal behavior and audit batch broadcasts |

### 6. Sybil Attack (Fake Voter Registration)

**Threat**: Fictitious voters are added to the registry. Commission mails QR1 to fake addresses and uses them to cast fraudulent votes.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Public registry audit | Voter registry (Merkle tree leaf count) is public. Cross-referenced with census data |
| Integration with existing ID systems | Linked to national resident registry, national ID, or biometric database. Only verified individuals receive QR1 |
| Pre-election Merkle root publication | Merkle root published before voting begins. Any voter can verify their own inclusion |
| JIT cross-check | JIT Mint count per station vs. actual visitor count is auditable. Stations with anomalous mint-to-visitor ratios are flagged |

### 7. Network Attack (51% Attack)

**Threat**: Attacker acquires majority hashrate on Kaspa network and reverses or alters vote TXs.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Kaspa's PoW + DAG resilience | DAG structure makes 51% attacks significantly harder than on traditional blockchains |
| Limited voting period | Short election window limits the time available for an attacker to amass hashrate |
| Finality confirmation | Wait for sufficient DAG depth confirmations before finalizing results |
| Multi-layer verification | Cross-reference on-chain results with physical polling station logs and parallel paper audit trail |

### 8. Privacy Leakage (Chain Analysis)

**Threat**: Pattern analysis of vote TXs (amounts, fees, script sizes, timing) could fingerprint individual voters.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Uniform TX structure | All vote TXs have identical value (TOKEN_VAL), script size (KASTVote = 549 bytes for all voters), and structure |
| Fixed token amount | All tokens are uniformly TOKEN_VAL (0.1 KAS). No amount-based fingerprinting |
| Unified script | KASTVote contract is identical for all voters in one election (same constructor args = same bytecode) |
| Batch broadcast | TXs are batched at the station, preventing timing-based fingerprinting |

### 9. Aggregation Manipulation

**Threat**: The election authority, who controls the aggregate function, could manipulate vote counts during real-time aggregation — dropping votes, delaying aggregation to cause deposit exhaustion, or selectively aggregating.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Value preservation (on-chain) | KASTTally.aggregate enforces `output.value >= sum(input.values)` via covenant. The authority **cannot** reduce the total value — any attempt is rejected by consensus |
| Covenant self-reference | Aggregated output must use the same KASTTally script (`this.activeBytecode`). Authority cannot redirect funds to a different address |
| Pre-aggregation tally | Vote count is always verifiable pre-aggregation: count all covenant UTXOs at the candidate address. Aggregation is an optimization, not a requirement for counting |
| Aggregation delay detection | If the authority delays aggregation, deposit runs low and JIT minting slows. This is publicly observable and triggers audit |
| Independent aggregation audit | Any observer can verify every Aggregate TX: sum of inputs == output value, same covenant chain, same script. Anomalies are detectable |
| Selective aggregation defense | Even if the authority only aggregates certain candidates, the raw UTXO count remains on-chain as ground truth. Aggregation cannot erase individual vote UTXOs — only consolidate them |

### 10. Terminal Trust (Vote Integrity)

**Threat**: The station terminal generates QR2's private key and constructs the Vote TX. The voter has no cryptographic control over Phase 3 — the terminal could cast a vote for a different candidate than selected.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Parallel paper ballot | Voter writes candidate name on QR2 paper BEFORE digital vote. Paper serves as physical intent record. Post-election audit compares paper with on-chain results |
| Benaloh Challenge (smartphone) | Voter optionally verifies terminal honesty via open-source app. Terminal commits to encrypted vote, voter challenges by requesting decryption. Encryption binding makes forgery mathematically impossible. Verified on voter's own device |
| Candidate address poster | Candidate collection addresses posted on booth wall (physical, pre-printed). Voter visually confirms terminal's displayed address matches the poster |
| Physical-digital audit | All collected QR2 papers are scanned post-election. API cross-references QR2 keys with on-chain TXs. Count discrepancy or handwriting mismatch triggers investigation |
| Multi-terminal consensus | Multiple independent terminals construct the TX; broadcast only if outputs match |

### 11. Mempool Censorship (Selective TX Filtering)

**Threat**: Miners observe Vote TX destinations in the mempool and selectively delay or exclude votes for specific candidates. Requires far less than 51% hashrate — even 10% can create statistically significant bias.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Encrypted voting | Vote TX contains encrypted candidate choice. Miners cannot determine the destination candidate. Censorship becomes random (useless) |
| Station batch broadcast | TXs are batched and broadcast to multiple nodes simultaneously, reducing single-miner censorship opportunity |
| DAG structure | Kaspa's DAG allows parallel blocks. Censored TX can be included by any other miner within 100ms |
| Censorship monitoring | Real-time comparison of broadcast TXs vs confirmed TXs. Anomalous confirmation delays at specific stations trigger alerts |

### 12. Commissioner Key Compromise

**Threat**: Both commissioner private keys are compromised simultaneously — enabling unlimited JIT minting, premature seal, or unauthorized aggregation.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| HSM key storage | Commissioner keys stored in Hardware Security Modules. Keys never leave the HSM |
| Per-station key pairs | Each polling station has unique commissioner key pairs. One station's compromise doesn't affect others |
| Mint count monitoring | Real-time on-chain monitoring: total minted tokens vs total station visitors. Anomalous mint spikes trigger immediate alert |
| Seal authority separation | Seal function (Master UTXO burn) requires separate authorization from mint function |

### 13. Deposit Leak (Unspent Tokens)

**Threat**: Voter receives token but never completes the flow (walks away after Phase 1 or Phase 2). Without recovery, TOKEN_VAL per abandoned token is locked permanently.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| recover entrypoint | KASTAnon and KASTVote include `recover(sig authSig)` with `require(tx.time >= electionEnd)`. Election authority can reclaim deposits after election |
| Station monitoring | Station tracks issued QR2s vs completed votes. Uncompleted sessions are flagged for post-election recovery |

### 14. Denial of Service (Election Infrastructure)

**Threat**: Attacker floods the Kaspa network with spam transactions during voting hours, delays block confirmation, or sends dust UTXOs to candidate addresses to bloat the UTXO set.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| KIP-9 storage mass | Kaspa's fee model penalizes small UTXO creation. Dust attacks are economically expensive |
| Covenant filtering | Only covenant-bound UTXOs with the correct election ID participate in tally. Non-covenant dust is ignored |
| Priority fee lanes | Election TXs can use higher fees to ensure inclusion during congestion |
| DAG throughput | Kaspa's 10,000+ TPS capacity provides substantial headroom above election requirements (~2,000-6,000 TPS for national elections) |

### 15. Mint Output Script Not Enforced

**Threat**: KASTMint enforces TOKEN_VAL and covenant chain continuity, but does **not** verify the output's `lockingBytecode` (destination script). Commissioners could mint tokens directly to KASTVote or KASTTally addresses, bypassing the anonymization step entirely — creating "ghost votes" without a corresponding voter.

**Countermeasures**:

| Countermeasure | Implementation |
|---|---|
| Off-chain audit | Every Mint TX output script is visible on-chain. Third-party auditors verify that all minted tokens are locked to KASTAnon scripts. Deviation is immediately detectable |
| Station cross-reference | Each minted token is tied to a voter arrival (JIT model). Tokens minted to non-KASTAnon scripts have no corresponding voter session |
| Covenant enforcement (future) | When Kaspa supports `OpTxOutputSpk` pattern matching in Mint scripts, the output destination can be enforced on-chain |

---

## Physical-Digital Audit

Post-election audit system that provides 100% automated coverage of the vote-to-paper consistency.

### Audit API

```
POST /api/audit/verify
  Input:  { pubkey: "<QR2 anonymous public key>" }
  Output: {
    vote_tx_found: true,
    tx_hash: "...",
    covenant_valid: true,
    value_correct: true,
    candidate: "<candidate name>"
  }

POST /api/audit/batch
  Input:  { pubkeys: [...], station_id: "tokyo-05" }
  Output: {
    papers_scanned: 1000,
    votes_on_chain: 1000,
    matched: 1000,
    phantom_votes: 0,
    unused_ballots: 0,
    consistency: 100.0%
  }

GET /api/audit/station/{station_id}/summary
  Output: {
    papers: 1000,
    chain_votes: 1000,
    handwritten_submitted: 820,
    handwritten_match: 802,
    handwritten_mismatch: 18,
    noise_rate: 2.2%,
    status: "NORMAL"
  }
```

### Three-Layer Verification

| Layer | Verification | Coverage | Automation |
|---|---|---|---|
| 1. Count | QR2 paper count vs on-chain TX count | **100%** | Fully automated |
| 2. Signature | Each QR2 key → matching Vote TX on chain | **100%** | Fully automated |
| 3. Handwriting | Written candidate name vs chain destination | Voters who wrote (~80%) | OCR + manual |

Anomaly thresholds:
- Layer 1: any count discrepancy → immediate investigation
- Layer 2: any unmatched key → flag as phantom vote or unused ballot
- Layer 3: noise rate > 10% at any station → full manual recount

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
| Japan | 55 million | 13 hours | ~3,525 | 35% |
| United States | 144 million | 13 hours | ~9,230 | 92% |
| EU (combined) | 185 million | Multi-day / multi-state | Distributed | — |
| India | 620 million | Spread over multiple days | Distributed | — |

KAST requires 3 TXs per voter (Mint + Anonymize + Vote; Mint batching up to 4 reduces effective count). Japan's national election uses roughly 35% of Kaspa's capacity. Large-scale elections (US, EU) can leverage multi-day voting or higher BPS targets.

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

## Implementation Status

Contracts are written in [SilverScript](https://github.com/aspect-build/silverscript) and compiled with `silverc`. Full source and bytecodes are in this repository.

### Compiled Contracts

| Contract | File | Bytecode | ABI | Role |
|---|---|---|---|---|
| KASTMintV2 | `kast_mint_v2.sil` | 329 B | `mint(sig,sig)` / `seal(sig,sig)` | JIT token issuance |
| KASTAnonV2 | `kast_anon_v2.sil` | 157 B | `anonymize(sig,sig)` / `recover(sig)` | 2-of-2 anonymization + deposit recovery |
| KASTVoteV2 | `kast_vote_v2.sil` | 549 B | `vote(sig,pubkey)` / `recover(sig)` | 10-candidate voting + deposit recovery |
| KASTTallyV2 | `kast_tally_v2.sil` | 4,016 B | `aggregate(sig)` / `release(sig)` | Real-time aggregation + covenant termination |
| KASTReceipt | `kast_receipt.sil` | 95 B | `claim(sig)` / `void(sig)` | Compulsory voting proof (separate TX) |

### Cost Estimate (50M voters, TOKEN_VAL = 0.1 KAS, low congestion)

| | Required capital | Nature |
|---|---|---|
| Peak deposit | ~37,000 KAS | Recovered after election |
| Transaction fees | ~44,000 KAS | Consumed (paid to miners) |
| **Total** | **~81,000 KAS** | |

Fee breakdown: Mint 30K (69%, dominated by storage mass) + Anon 10K + Vote 3K + Aggregate 0.5K.

### Parameters

| Parameter | Value | Rationale |
|---|---|---|
| TOKEN_VAL | 0.1 KAS (10M sompi) | Balance between storage mass fees and deposit |
| MAX_BATCH (Mint) | 4 | Adjustable per station congestion |
| MAX_AGGREGATE (Tally) | 8 | Script size limit (10KB max) |
| Candidate slots | 10 | Covers most election types |

Security hardening (v2.1): exact value matching (`==` not `>=`) prevents fingerprinting, `recover` entrypoints prevent permanent deposit lock, `release` enforces covenant chain termination, and KASTReceipt is issued as a separate TX to preserve anonymization.

---

## International Compatibility

| Requirement | Affected Countries | KAST Approach |
|---|---|---|
| Secret ballot | All democracies | Physical QR1/QR2 exchange + ZK anonymization |
| Compulsory voting proof | 27 countries (Bolivia, Australia, etc.) | Phase 2 UTXO spent-status as primary proof; KASTReceipt as optional separate TX |
| Double-vote prevention | 90+ ink-based countries | Covenant: 1 UTXO = 1 vote (replaces ink) |
| Timing analysis prevention | General | TX batch broadcast at stations + encrypted voting |
| Voter-ballot linking permitted | US states (IN, NC) | ZK can be made optional |
| Terminal trust verification | General | Parallel paper ballot + Benaloh Challenge + Physical-Digital Audit API |
| Elderly / low-digital-literacy | Japan, many countries | Handwritten candidate name on QR2 paper (familiar voting experience) |

---

## Design Constraints

| Constraint | Impact | Mitigation |
|---|---|---|
| MAX_AGGREGATE = 8 | Tally aggregation limited to 8 inputs per TX | Multi-pass aggregation; compile-time loop unrolling limits |
| Candidate slots = 10 | Max 10 candidates per election | Sufficient for most elections; expandable with vProgs |
| Script size limit (10KB) | Complex voting rules may not fit in L1 | vProgs (CairoVM) for advanced logic |
| Indexer dependency | Efficient covenant_id queries need dedicated indexer | Standard blockchain infrastructure |
| No remote voting | Physical polling station required | By design — prevents physical coercion attacks |

### vProgs Extensions (CairoVM L2)

| Extension | Description |
|---|---|
| Encrypted voting + Benaloh | CairoVM + Stwo enables encrypted ballot casting with smartphone verification |
| Homomorphic tallying | Tally encrypted votes without decrypting individual ballots |
| Liquid Democracy | vProg global state manages delegation relationships |
| Real-time turnout display | vProg aggregates voting status, published with ZK proof |
| Cross-district composition | Multiple district vProgs combined via Proof Stitching |

---

## Tech Stack

| Component | Technology |
|---|---|
| L1 Blockchain | Kaspa (PoW + blockDAG, Covenant++ HF) |
| L2 Execution | vProgs (CairoVM, Based Rollup) |
| ZK Proof Generation | RISC0 (Rust guest program) / Groth16 (ark-bn254) |
| ZK Proof Verification | OpZkPrecompile (0xa6) on Kaspa L1 |
| Vote Encryption | Threshold encryption (commissioner N-of-M decryption) |
| Voter Verification | Benaloh Challenge (open-source smartphone app) |
| Merkle Tree | Blake2b hash-based |
| Token Management | Covenant ID + UTXO |
| Physical Delivery | QR code in sealed envelope |
| Voting Terminal | Open-source, TEE-enabled |
| Audit System | Physical-Digital Audit API (QR2 scan → on-chain cross-reference) |

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
