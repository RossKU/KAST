# KAST — Kaspa Anonymous Sealed Token

> A UTXO Physical Vote Protocol on Kaspa
>
> *"Cast your vote. Burn the proof. Keep the truth."*

## モチベーション

KAST の目的は選挙を再発明することではない。既存の選挙システムをブロックチェーンに固定し、**改竄不可能にすること**である。

今日の投票インフラは既に機能している。紙の投票用紙、封筒、対面での本人確認、公開集計。欠けているのは、不正・改竄・不透明性に対する**暗号学的保証**だけだ。KAST は馴染みのある物理的な投票体験を維持しつつ、トークン発行・匿名化・投票・集計の全ステップを Kaspa の L1 コンセンサスに埋め込み、その全てを不可逆かつ公開検証可能にする。

### 実装スコープ

**Covenant++ ハードフォーク（TN12）** により、KAST の限定的だが機能する部分集合が実現可能である。UTXO による 1 回限りの投票トークン、ZK ベースの有権者資格証明、Covenant による候補者制約、オンチェーンでの透明な集計。これはパイロット運用や概念実証選挙には十分である。

ただし、本番レベルの国政選挙 — 暗号化集計、委任投票、選挙区横断合成、完全な受領証不可能性が求められる — には、**vProgs を待つのが賢明**である。vProgs は CairoVM 実行、Computation DAG によるグローバルステート管理、Proof Stitching をもたらし、大規模選挙が要求する暗号学的精緻さを Kaspa の L1 セキュリティモデルを損なうことなく実現する。

**要するに: Covenant++ でコンセプトを証明し、vProgs でシステムを届ける。**

---

## 概要

KAST は、Kaspa の Covenant++ ハードフォーク（TN12）の機能を活用した、物理・デジタルハイブリッド型の電子投票プロトコルである。

UTXO モデルの「1回使ったら消滅する」性質を投票権トークンに応用し、ZK proof による匿名化と Covenant スクリプトによるルール強制を組み合わせることで、**L1 コンセンサスレベルのセキュリティで秘密投票を実現する**。

### 基本原則

| 原則 | 実現手段 |
|---|---|
| 1人1票 | UTXO の二重支払い防止 = 二重投票防止 |
| 投票の秘密 | ZK proof によるリンク切断（投票者 ↔ 投票内容） |
| 投票参加の証明 | 元トークン UTXO の spent 状態をオンチェーンで確認可能 |
| 再発行不可 | UTXO 消滅 + Mint 権限の burn |
| 公開集計 | 候補者アドレスの UTXO カウント（誰でも検証可能） |
| 改竄不可能 | Kaspa L1 コンセンサス（PoW + DAG）がトランザクションを保護 |

---

## アーキテクチャ

### 使用する Kaspa Covenant++ の機能

| 機能 | 用途 |
|---|---|
| Covenant ID | 選挙トークンの一意な識別子。全トークンが同一 covenant チェーンに属する |
| OpZkPrecompile (0xa6) | 有権者資格の ZK 証明を L1 で検証 (RISC0 / Groth16) |
| イントロスペクション opcodes | 出力先の制約、トークン量の保存、時間窓の強制 |
| UTXO モデル | 1 トークン = 1 投票権。使用後は自動消滅 |

### オンチェーン構造

```
Transaction 構造（変更なし）:
  TransactionInput:
    previous_outpoint    ← 投票トークン UTXO への参照
    signature_script     ← 署名 + ZK proof データ（バイナリ push）

  TransactionOutput:
    value                ← 最小値 (1 sompi)
    script_public_key    ← Covenant ルール（投票制約スクリプト）
    covenant             ← Option<CovenantBinding>
      authorizing_input  ← 認可する入力のインデックス
      covenant_id        ← 選挙 ID（Hash）
```

---

## プロトコルフロー

### Phase 0: 選挙セットアップ

```
選挙管理委員会:
  ① 有権者名簿から Merkle tree を構築
     リーフ = 各有権者の公開鍵
  ② Election Genesis TX を発行
     Output: Election Master UTXO
       covenant_id: Hash(outpoint + outputs) ← 選挙の一意な ID
       script_public_key: [Merkle root, 候補者リスト, 選挙ルール]
  ③ Merkle root と tree サイズをオンチェーンにコミット（公開情報）
```

### Phase 1: トークン発行 + 物理配送

```
Mint TX (選挙管理委員会がマルチシグで実行):
  Input:  Election Master UTXO
  Outputs:
    [0]: 投票者 A のトークン UTXO
         covenant_id: 選挙 ID (continuation)
         script_public_key: <voter_A_pubkey> OpCheckSig + 匿名化ルール
    [1]: 投票者 B のトークン UTXO
    ...
    [N]: 次の Mint 用 Master UTXO (continuation)
         ※ 最終 Mint TX では continuation なし → Master UTXO 消滅

物理配送:
  各投票者の秘密鍵を QR コード化
  → 封筒に封入して郵送（QR1）
```

### Phase 2: 匿名化（投票所での本人確認）

```
[物理プロセス]
  投票者が封筒の QR1 を投票所に持参
  → 本人確認（ID チェック）
  → 投票所端末が匿名化 TX を構築・送信
  → 新しい QR2（匿名投票トークン）を印刷

[オンチェーンプロセス]
  Anonymize TX:
    Input: 投票者 A の identifiable トークン UTXO

    signature_script:
      ├── 投票者 A の秘密鍵による署名
      ├── ZK Proof (RISC0 or Groth16):
      │     証明内容:
      │       「私の公開鍵は選挙 Merkle tree に含まれる」
      │       「この nullifier は私の鍵から一意に導出された」
      │     非公開:
      │       どのリーフ（どの投票者）かは隠される
      └── tag: 0x21 (RISC0 Succinct) or 0x20 (Groth16)

    Output: 匿名トークン UTXO
      covenant_id: 同じ選挙 ID (continuation)
      script_public_key: <new_random_pubkey> + 投票先制約ルール
      value: 1 sompi

  ※ この時点で QR1 の UTXO は消滅 → QR1 は無効化
  ※ Input（投票者 A）と Output（匿名トークン）のリンクは ZK で切断
```

### Phase 3: 投票

```
[物理プロセス]
  投票者が QR2 を備え付け PC にスキャン
  → タッチ操作で候補者を選択
  → 端末が Vote TX を送信
  → QR2 は使用済み（UTXO 消滅）

[オンチェーンプロセス]
  Vote TX:
    Input: 匿名トークン UTXO

    signature_script:
      └── 匿名鍵での署名

    Output: 候補者 C の集票アドレス
      covenant_id: 同じ選挙 ID (continuation)
      script_public_key: candidate_C_collection_script
      value: 1 sompi

  Covenant スクリプトが強制するルール:
    OpInputCovenantId      → covenant chain の検証
    OpCovOutCount          → 出力が 1 つだけであること
    OpTxOutputSpk          → 出力先が候補者リストに含まれること
    OpTxOutputAmount       → value が保存されること
```

### Phase 4: 集計

```
候補者 A の集票アドレスの UTXO 数 = 候補者 A の得票数
候補者 B の集票アドレスの UTXO 数 = 候補者 B の得票数
...

→ オンチェーンで誰でも検証可能
→ 中央サーバーや管理者の介入なし
```

### Phase 5: 検証

```
投票参加の証明:
  投票者 A の元トークン UTXO → spent（オンチェーンで確認可能）
  → 「投票者 A は投票に参加した」 ✓

投票内容の秘匿:
  投票者 A の匿名トークン → 候補者 ? のアドレス
  → Phase 2 でリンクが切断されているため追跡不可能 ✓
```

---

## QR トークンのライフサイクル

### QR1（封筒で郵送）

```
生成 → 封筒で郵送 → 投票所で使用（匿名化 TX）→ UTXO 消滅 → 終わり

×再利用: UTXO が存在しない（コンセンサスが拒否）
×再発行: Master UTXO が burn 済み（mint 権限が消滅）
×コピー: 先に使われたら UTXO 消滅、後から使えない
         + 投票所での本人確認 (2-of-2 マルチシグ) が必要
```

### QR2（投票所で印刷）

```
投票所端末で生成 → その場で投票に使用 → UTXO 消滅 → 終わり

×再利用: UTXO が存在しない
×再発行: QR1 が消滅済みなので匿名化 TX を再実行できない
×コピー: 端末内で生成・即使用なので物理的にコピー困難
```

---

## セキュリティ: 攻撃ベクトルと対策

### 1. タイミング分析攻撃

**脅威**: 匿名化 TX と投票 TX の時間的近接性から、投票者と投票内容のリンクを推測される。

```
例: 投票者 A が 14:32:01 に匿名化、14:32:03 に候補者 X へ投票
    → 時間相関から A → X の投票が推測される
```

**対策**:

| 対策 | 実装方法 |
|---|---|
| 時間窓バッチング | Covenant スクリプトで OpTxInputDaaScore を使い、匿名化期間と投票期間を分離。Window 1 (午前): 匿名化のみ、Window 2 (午後): 投票のみ |
| 高 BPS の活用 | Kaspa 100 BPS 環境では 1 秒に 100 ブロック。同一ブロック内に多数の TX が入り、個別のリンクが困難 |
| 端末バッチ送信 | 投票所端末が匿名化 TX をキューに蓄積し、まとめてブロードキャスト。個人のタイミングが隠れる |

### 2. 選挙管理委員会の不正（トークン水増し）

**脅威**: 委員会が有権者数以上のトークンを発行し、不正投票を行う。

**対策**:

| 対策 | 実装方法 |
|---|---|
| Mint 権限の封印 | 最終 Mint TX で Master UTXO を burn（continuation output を作らない）。以降 mint 不可 |
| 発行数の公開検証 | Merkle tree のリーフ数 = 有権者数（公開情報）。Mint TX はオンチェーンで全て可視。発行トークン数と名簿を照合可能 |
| マルチシグ要求 | Master UTXO の script_public_key に OpCheckMultiSig を設定。N-of-M 署名がないと Mint 不可（単独犯の防止） |
| Covenant による制約 | 出力数 ≤ Merkle tree サイズ + 1 (continuation) をスクリプトで強制 |

### 3. QR1 の盗難・紛失

**脅威**: 封筒を盗まれた場合、攻撃者が先に投票トークンを使用する。

**対策**:

| 対策 | 実装方法 |
|---|---|
| 2-of-2 マルチシグ | QR1 の UTXO = 投票者の鍵 + 投票所端末の鍵。両方が揃わないと匿名化 TX を実行できない。封筒を盗んだだけでは不可 |
| 投票所での本人確認 | 物理 ID チェック（免許証、マイナンバーカード等）を端末署名の前提条件にする |
| 紛失時の扱い | 再発行不可（Master は burn 済み）。投票権の喪失として扱う（紙の投票用紙の紛失と同等） |

### 4. 強制投票（脅迫・買収）

**脅威**: 「候補者 X に入れたことを証明しろ」と脅迫される。

**対策**:

| 対策 | 実装方法 |
|---|---|
| 匿名鍵の破棄 | QR2 の秘密鍵を投票所端末のセキュア環境（TEE）で生成・使用・即破棄。投票者自身も匿名鍵を知らない設計 |
| リンク切断の不可逆性 | ZK proof による匿名化は一方向。投票者が「自分の匿名トークンはこれだ」と証明する手段がない |
| 物理的分離 | 投票所の端末は外部通信を遮断。投票画面の撮影を物理的に防止（投票ブース設計） |

### 5. 投票所端末の改竄

**脅威**: 端末が投票者の選択と異なる候補者に投票する。

**対策**:

| 対策 | 実装方法 |
|---|---|
| 投票確認画面 | TX 送信前に選択内容を表示し、投票者が確認。候補者アドレスのハッシュを表示 |
| オープンソース端末 | 投票所端末のソフトウェアを公開。第三者監査を可能にする |
| 端末の多重検証 | 複数の独立した端末で TX を構築し、一致を確認してから送信 |
| 投票後レシート | 投票した候補者アドレスの短縮ハッシュを印刷。事後検証に利用可能（ただし脅迫対策とのバランスが必要） |

### 6. Sybil 攻撃（偽有権者の登録）

**脅威**: 架空の有権者を名簿に追加し、Merkle tree に含める。

**対策**:

| 対策 | 実装方法 |
|---|---|
| 名簿の公開監査 | 有権者名簿（Merkle tree のリーフ数）を公開。人口統計データとの照合 |
| 既存制度との連携 | 住民基本台帳やマイナンバーとの紐づけにより、実在する有権者のみを登録 |
| Merkle root の事前公開 | 投票開始前に Merkle root を公開し、有権者が自分の inclusion を検証可能 |

### 7. ネットワーク攻撃（51% 攻撃）

**脅威**: Kaspa ネットワークの過半数のハッシュレートを取得し、投票 TX を改竄する。

**対策**:

| 対策 | 実装方法 |
|---|---|
| Kaspa の PoW + DAG 耐性 | DAG 構造により、単純な 51% 攻撃が従来のブロックチェーンより困難 |
| 投票期間の制限 | 短い投票期間を設定し、攻撃者がハッシュレートを集める時間を制限 |
| ファイナリティの確認 | 十分な確認数（DAG depth）を待ってから集計を確定 |
| 多層検証 | オンチェーン結果と投票所の物理ログを照合 |

### 8. プライバシー漏洩（チェーン分析）

**脅威**: 投票 TX のパターン分析（金額、手数料、スクリプトサイズ）から投票者を特定する。

**対策**:

| 対策 | 実装方法 |
|---|---|
| 均一な TX 構造 | 全投票 TX の value、手数料、スクリプトサイズを統一。パターン分析の余地を排除 |
| 固定額の投票トークン | 全トークンが 1 sompi で統一 |
| 統一スクリプト | 匿名トークンの script_public_key を全投票者で同一構造にする |

---

## Kaspa の技術的優位性

### なぜ Kaspa なのか

| 比較軸 | Ethereum (Account) | Bitcoin (UTXO) | Kaspa Covenant++ (UTXO) |
|---|---|---|---|
| 1人1票の保証 | mapping + require で手動実装 | スクリプト制限で困難 | **UTXO の天然保証** |
| 二重投票防止 | コントラクトのバグリスク | ○ | **コンセンサスレベルで保証** |
| 投票の秘密 | Tornado Cash 等の外部依存 | 実現困難 | **L1 ZK プリコンパイルで実現** |
| 集計の透明性 | コントラクトの信頼が必要 | ○ | **UTXO カウントで自明** |
| 処理速度 | ~15 TPS | ~7 TPS | **10-100 BPS、並列処理可能** |
| 中央サーバー | 不要 | 不要 | **不要** |
| ルール強制 | EVM (攻撃面が広い) | 制限的 | **Covenant (最小限の攻撃面)** |

### 使用するオペコード一覧

| カテゴリ | オペコード | コード | 用途 |
|---|---|---|---|
| ZK 検証 | OpZkPrecompile | 0xa6 | 有権者資格の ZK proof 検証 |
| Covenant | OpInputCovenantId | 0xcf | 選挙 covenant chain の検証 |
| Covenant | OpCovOutCount | 0xd2 | 同一 covenant 出力数の制約 |
| Covenant | OpCovOutputIdx | 0xd3 | 同一 covenant 出力インデックス |
| Covenant | OpAuthOutputCount | 0xcb | 認可された出力数 |
| イントロスペクション | OpTxOutputSpk | 0xc3 | 出力先が候補者リストに含まれるか検証 |
| イントロスペクション | OpTxOutputAmount | 0xc2 | トークン量の保存を検証 |
| イントロスペクション | OpTxInputAmount | 0xbe | 入力トークン量の確認 |
| イントロスペクション | OpTxInputDaaScore | 0xc0 | 時間窓の強制（バッチング） |
| 署名 | OpCheckSig | 0xac | 投票者 / 端末の署名検証 |
| 署名 | OpCheckMultiSig | 0xae | 委員会マルチシグ / 2-of-2 |
| ハッシュ | OpBlake2b | 0xaa | nullifier 導出、データハッシュ |

---

## 制約と今後の展望

### Covenant++ 段階での制約

| 制約 | 説明 |
|---|---|
| 投票内容の暗号化集計 | 候補者アドレスへの送信方式では、匿名トークンの送り先自体は公開。リンクが切れているので実用上問題ないが、完全な暗号化集計には vProgs が必要 |
| スクリプトサイズ制限 | 複雑な投票ルール（委任投票、順位投票等）は L1 スクリプトの制約に収まらない可能性がある |
| インデクサーの必要性 | covenant_id ベースの集計クエリを効率的に行うには、専用のインデクサーが必要 |

### vProgs 時代の拡張（将来）

| 拡張 | 説明 |
|---|---|
| 完全暗号化投票 | CairoVM + Stwo で投票内容を暗号化したまま集計。候補者アドレスすら非公開 |
| 委任投票 (Liquid Democracy) | vProg のグローバルステートで委任関係を管理 |
| リアルタイム投票率表示 | vProg が投票状況を集計し、ZK proof 付きで公開 |
| クロス選挙区合成 | 複数の選挙区 vProg を Proof Stitching で結合 |

---

## 技術スタック

| コンポーネント | 技術 |
|---|---|
| L1 ブロックチェーン | Kaspa (PoW + blockDAG, Covenant++ HF) |
| ZK 証明生成 | RISC0 (Rust ゲストプログラム) / Groth16 (ark-bn254) |
| ZK 証明検証 | OpZkPrecompile (0xa6) on Kaspa L1 |
| Merkle tree | Blake2b ハッシュベース |
| トークン管理 | Covenant ID + UTXO |
| 物理配送 | QR コード封入封筒 |
| 投票端末 | オープンソース、TEE 対応 |

---

## ライセンス

ISC

---

## 参考

- [Kaspa rusty-kaspa TN12](https://github.com/kaspanet/rusty-kaspa/tree/tn12)
- [Kaspa TN12 ドキュメント](https://github.com/kaspanet/rusty-kaspa/blob/tn12/docs/testnet12.md)
- [kaspanet/vprogs](https://github.com/kaspanet/vprogs)
- [vProgs Yellow Paper](https://kaspa.co.il/wp-content/uploads/2025/09/vProgs_yellow_paper.pdf)
- [Michael Sutton's covenant++ notes](https://gist.github.com/michaelsutton/5bd9ab358f692ee4f54ce2842a0815d1)
