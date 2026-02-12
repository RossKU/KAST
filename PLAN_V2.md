# KAST v2: JIT Mint + リアルタイム集約設計

## Context

v1は全量事前Mintモデル。議論で以下を決定:
- JIT Mint (投票所来所時にオンデマンド発行)
- 即時フロー (Mint→Anon→Vote 3分完結)
- リアルタイム集約 (Vote UTXOを随時マージ → 預託激減)
- 物理QR1→QR2匿名化は維持
- 国際対応 (義務投票証明、郵便投票は将来ZK)

## パラメータ決定

- TOKEN_VAL = 10,000,000 sompi (0.1 KAS)
- 集約権限 = 選管のみ (authSig必須)
- 候補者上限 = 10人
- 集約バッチ = MAX_AGG = 8入力

## 新フロー

```
[事前] QR1 = 空Wallet配布 (鍵ペアのみ)
[来所] 選管がMint → QR1 Walletへ送金         ← Phase 1
[来所] 本人+選管 2-of-2 Burn → QR2発行        ← Phase 2
[即時] QR2で投票 → 候補者アドレスへ            ← Phase 3
[随時] 選管が候補者UTXOを集約                  ← Phase 4 (aggregate)
[事後] タイムロック解除 → KAS回収              ← Phase 4 (release)
```

## コントラクト一覧 (5ファイル)

### 1. kast_mint_v2.sil
- v1からの変更: バッチサイズ柔軟化 (1〜4), TOKEN_VAL=0.1KAS
- seal関数は維持

### 2. kast_anon_v2.sil
- v1からの変更: MIN_AGE削除 (JIT即時フロー)

### 3. kast_vote_v2.sil
- v1からの変更: MIN_AGE削除, 候補者3→10人
- for(i,0,10) でLockingBytecodeP2PKホワイトリスト

### 4. kast_tally_v2.sil ★最大変更
- 新: aggregate entrypoint (リアルタイム集約)
- OpCovInputCount + OpCovInputIdx で全入力値を合算
- MAX_AGG=8 のfor loop (compile-time unroll)
- release は v1同様

### 5. kast_receipt.sil ★新規
- 義務投票国向けオンチェーン投票証明
- UTXO存在 = 投票済み証明

## ファイル変更

| 操作 | ファイル |
|---|---|
| 新規 | contracts/kast_mint_v2.sil |
| 新規 | contracts/kast_anon_v2.sil |
| 新規 | contracts/kast_vote_v2.sil |
| 新規 | contracts/kast_tally_v2.sil |
| 新規 | contracts/kast_receipt.sil |
| 新規 | contracts/args/args_*_v2.json, args_receipt.json |
| 出力 | build/kast_*_v2.json |

v1は残す (比較用)。

## 検証

1. silverc で全5コントラクトコンパイル
2. v1 vs v2 バイトコードサイズ比較
3. 50M voters コスト再試算 (集約効果込み)
4. git commit & push
