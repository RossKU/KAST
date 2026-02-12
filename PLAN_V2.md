# KAST v2: JIT Mint + リアルタイム集約アーキテクチャ

## 背景

v1 は全量事前 Mint モデルだった。5,000万人規模で約2,500万KASの預託ロックが必要であり、実用に耐えない。v2 では以下の改善を導入:

1. **JIT Mint** — 投票所来所時にオンデマンド発行。事前在庫ゼロ
2. **即時フロー** — Mint → Anon → Vote を投票所内で3分完結
3. **リアルタイム集約** — Vote UTXOを選挙中に随時マージ。預託ロック 1,375万 → 3.7万KAS
4. **物理匿名化維持** — QR1(身分証) → QR2(投票用紙) の物理交換で脅迫/買収耐性
5. **国際対応** — 義務投票国向けオンチェーン投票証明、郵便投票は将来ZK対応

---

## パラメータ

| パラメータ | 値 | 根拠 |
|---|---|---|
| TOKEN_VAL | 10,000,000 sompi (0.1 KAS) | storage mass とのバランス |
| MAX_BATCH (Mint) | 4 | 投票所の混雑度に応じて1〜4を動的選択 |
| MAX_AGG (Tally) | 8 | スクリプトサイズ上限 10KB 以内 (4,010B) |
| 候補者数 | 最大10人 | LockingBytecodeP2PK ホワイトリスト |
| 集約権限 | 選管のみ | authSig 必須 (spam 防止) |

---

## プロトコルフロー

```
[事前] QR1 = 空Wallet配布 (鍵ペアのみ、KAS不要)
           ↓
[来所] 選管が JIT Mint → QR1 Wallet へ送金            ← Phase 1: KASTMintV2
           ↓
[来所] 本人(QR1) + 投票所端末 の 2-of-2 Burn → QR2発行  ← Phase 2: KASTAnonV2
           ↓
[即時] QR2 で投票 → 候補者集票所アドレスへ              ← Phase 3: KASTVoteV2
       QR2 は物理回収 (投票用紙と同じ)
       ステッカー配布 (投票済み証明、投票先は含まない)
           ↓
[随時] 選管が候補者UTXOを集約 (8入力→1出力)            ← Phase 4a: KASTTallyV2.aggregate
           ↓
[事後] タイムロック解除 → KAS全額回収                   ← Phase 4b: KASTTallyV2.release
```

---

## コントラクト一覧

### 1. KASTMintV2 — JIT トークン発行 (329 bytes)

| エントリポイント | 引数 | 機能 |
|---|---|---|
| `mint` | sig, sig | 1〜4トークン発行 + continuation UTXO |
| `seal` | sig, sig | 最終発行 + Master UTXO 永久封印 |

- デュアルシグ (commissioner1 + commissioner2)
- JIT: 投票者来所ごとに1トークン発行が基本
- 繁忙時はバッチ4で小プール作成も可能
- Covenant chain: 全出力が同一選挙IDを継承

### 2. KASTAnonV2 — 即時匿名化 (96 bytes)

| エントリポイント | 引数 | 機能 |
|---|---|---|
| `anonymize` | sig, sig | 身元付きトークン → 匿名トークン変換 |

- 2-of-2: 投票者鍵(QR1) + 投票所端末鍵
- v1 の MIN_AGE=600 を**削除** (JITフローで即時実行)
- 物理匿名化: QR1回収 → QR2発行 (新鍵ペア、端末で即生成)
- **脅迫耐性**: 投票者はQR2を投票所で交換するため、後から投票先を証明できない
- **買収耐性**: QR1を売っても投票先を制御不能 (投票所でQR2に変わる)
- 将来: OpZkPrecompile でオンチェーン匿名化追加

### 3. KASTVoteV2 — 即時投票 (488 bytes)

| エントリポイント | 引数 | 機能 |
|---|---|---|
| `vote` | sig, pubkey | 匿名トークン → 候補者集票アドレスへ送信 |

- 匿名鍵(QR2)の署名検証
- v1 の MIN_AGE=300 を**削除** (QR2受取後即投票)
- 候補者数: 3人 → **10人** (cand0〜cand9)
- LockingBytecodeP2PK でホワイトリスト強制
- 未使用スロットはダミー/burn鍵で埋める
- Covenant chain で選挙IDの一貫性検証

### 4. KASTTallyV2 — リアルタイム集約 + タイムロック (4,010 bytes) ★

| エントリポイント | 引数 | 機能 |
|---|---|---|
| `aggregate` | sig | 複数Vote UTXO → 1つに集約 (最大8入力) |
| `release` | sig | 選挙終了後のKAS回収 |

**v2最大の変更。** 選挙中に随時UTXO集約を実行し、預託ロックを劇的に削減。

集約の仕組み:
```
8 Vote UTXOs (各0.1 KAS) → 1 UTXO (0.8 KAS)
  ↑ OpCovInputCount(covId) = 8
  ↑ OpCovInputIdx(covId, i) で各入力のvalue取得
  ↑ sum(inputs) <= output.value を検証
  ↑ output.lockingBytecode == this.activeBytecode (自己参照)
```

- 選管署名必須 (permissionless にするとspam攻撃リスク)
- MAX_AGG=8: for ループが compile-time 展開。16だと10KB上限超過
- 集約頻度: 5分ごとに実行すれば同時ロック ≈ 17,000票分

集計方法:
```
候補者Aの得票数 = 候補者Aアドレスの総value / TOKEN_VAL
```
オンチェーンで誰でも検証可能。

### 5. KASTReceipt — 投票証明 (95 bytes) ★新規

| エントリポイント | 引数 | 機能 |
|---|---|---|
| `claim` | sig | 投票者が投票証明UTXOを回収 |
| `void` | sig | 選管が無効化 (選挙取消時) |

- **義務投票国向け** (ボリビア、オーストラリア等27カ国)
- Phase 2 実行時に別出力として発行
- UTXO存在 = 投票済み証明。投票先は**含まない**
- 投票者本人のみ claim 可能 (voterPk で署名検証)
- 義務投票でない国ではオフチェーン・ステッカーで代替

---

## コンパイル結果

| Contract | ファイル | Bytecode | ABI |
|---|---|---|---|
| KASTMintV2 | kast_mint_v2.sil | 329 bytes | mint(sig,sig) / seal(sig,sig) |
| KASTAnonV2 | kast_anon_v2.sil | 96 bytes | anonymize(sig,sig) |
| KASTVoteV2 | kast_vote_v2.sil | 488 bytes | vote(sig,pubkey) |
| KASTTallyV2 | kast_tally_v2.sil | 4,010 bytes | aggregate(sig) / release(sig) |
| KASTReceipt | kast_receipt.sil | 95 bytes | claim(sig) / void(sig) |

v1 との比較:

| Contract | v1 | v2 | 差分 |
|---|---|---|---|
| Mint | 265 B | 329 B | +64 B (柔軟バッチ) |
| Anon | 96 B | 96 B | 同一 (MIN_AGE削除のみ) |
| Vote | 166 B | 488 B | +322 B (候補者 3→10) |
| Tally | 50 B | 4,010 B | +3,960 B (aggregate追加) |
| Receipt | — | 95 B | 新規 |

---

## コスト試算 (50M voters, 0.1 KAS/token, 低混雑)

### v1 vs v2 比較

|  | v1 (旧) | v2 (新) | 改善 |
|---|---|---|---|
| 事前Mint在庫 | 500万 KAS | **0 KAS** | 100% 削減 |
| ピーク預託 | 1,375万 KAS | **~37,000 KAS** | 99.7% 削減 |
| 手数料 (消費) | ~28,000 KAS | ~44,000 KAS | +57% (storage mass) |
| **必要資金** | **~2,500万 KAS** | **~81,000 KAS** | **99.7% 削減** |

### 手数料内訳

| Phase | TX数 | Fee/TX | 小計 |
|---|---|---|---|
| 1. Mint | 2,500万 | ~120,000 sompi | 30,134 KAS |
| 2. Anon | 5,000万 | ~20,000 sompi | 10,152 KAS |
| 3. Vote | 2,750万 | ~11,000 sompi | 2,933 KAS |
| 4. Aggregate | 344万 | ~14,000 sompi | 498 KAS |
| **合計** | | | **43,716 KAS** |

Mint の storage mass (C/TOKEN_S = 100,000 grams) が手数料の69%を占める。
TOKEN_VAL を大きくすれば手数料は下がるが預託が増える — トレードオフ。

### ZK追加時 (将来)

| コスト要因 | PoC (現在) | Groth16 本番 |
|---|---|---|
| compute (sigops) | 43,000 KAS | 43,000 KAS |
| ZK verify (Phase 2) | — | +50,000〜100,000 KAS |
| 合計 (消費) | ~44,000 KAS | ~93,000〜143,000 KAS |

---

## セキュリティモデル

### 物理匿名化の3層防御

| 層 | 何を断つか | 現状 (PoC) | ZK追加後 |
|---|---|---|---|
| 物理的 | 投票所でQR交換。新デバイス/紙に | 有効 | 有効 |
| 運用的 | 投票所端末がログ非保持/破棄 | 有効 | 有効 |
| 暗号的 | オンチェーンでQR1→QR2リンク不能 | **未達** | 有効 |

### QR1 撮影時のリスク

| 分かること | PoC (ZKなし) | ZK追加後 |
|---|---|---|
| 投票したか | Yes (Phase 2 TXの有無) | Yes |
| 誰に投票したか | Yes (TX追跡可能) | **No** |

→ 投票事実の漏洩は公開情報として許容。投票先の秘匿はZK待ち。

### QR2 回収

- 投票用紙と同じ物理的回収モデル
- ZKがあれば回収されたQR2から投票者を逆引き不能
- 脅迫対象にならない (投票先証明不可)

---

## 国際対応

| 要件 | 対象国 | 対応 |
|---|---|---|
| 秘密投票 | 全民主国家 | QR1→QR2物理匿名化 + 将来ZK |
| 義務投票証明 | 27カ国 (ボリビア、豪州等) | KASTReceipt (オンチェーン) |
| 二重投票防止 | インク方式90カ国以上 | Covenant 1UTXO=1票で代替 |
| 郵便投票 | 多数国 | 将来: オンライン Phase 2 (ZK必須) |
| タイミング分析防止 | 全般 | Phase 2 TXをバッチ送信 |
| 投票者紐づけ許可 | 米国一部州 (IN, NC) | ZKオプション化で対応可能 |

---

## 技術的制約 (PoC段階)

| 制約 | 影響 | 対応時期 |
|---|---|---|
| OpZkPrecompile (0xa6) 未実装 | Phase 2 の暗号的匿名化不可 | SilverScript対応待ち |
| OpTxInputDaaScore 未実装 | 厳密な時間窓制御不可 | SilverScript対応待ち |
| checkMultiSig 未実装 | 2つのcheckSigで代替 | SilverScript対応待ち |
| Tally MAX_AGG=8 | 8以上は多段集約で対応 | スクリプトサイズ上限の制約 |
| 候補者数 最大10 | for展開でバイトコード膨張 | 動的配列サポート待ち |

---

## ファイル構成

```
KAST/
├── contracts/
│   ├── kast_mint_v2.sil        Phase 1: JIT発行 (329B)
│   ├── kast_anon_v2.sil        Phase 2: 即時匿名化 (96B)
│   ├── kast_vote_v2.sil        Phase 3: 即時投票 (488B)
│   ├── kast_tally_v2.sil       Phase 4: 集約+解除 (4,010B)
│   ├── kast_receipt.sil        投票証明 (95B)
│   ├── kast_mint.sil           v1 (比較用)
│   ├── kast_anon.sil           v1
│   ├── kast_vote.sil           v1
│   ├── kast_tally.sil          v1
│   └── args/
│       ├── args_mint_v2.json
│       ├── args_anon_v2.json
│       ├── args_vote_v2.json
│       ├── args_tally_v2.json
│       └── args_receipt.json
├── build/
│   ├── kast_mint_v2.json       コンパイル済み
│   ├── kast_anon_v2.json
│   ├── kast_vote_v2.json
│   ├── kast_tally_v2.json
│   └── kast_receipt.json
└── tools/
    ├── kast_tx.js              TX生成スクリプト (TN12接続待ち)
    └── test_*.mjs
```

---

## 次のステップ

1. **kaspad TN12 ビルド再開** → ノード起動 → TX送信テスト
2. **WASM SDK v0.15.0+** 取得 → kast_tx.js をv2コントラクト対応に更新
3. **OpZkPrecompile** SilverScript対応後 → Phase 2 に ZK 匿名化追加
4. **README.md** v2アーキテクチャ反映
