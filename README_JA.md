# KAST — Kaspa Anonymous Sealed Token

> A UTXO Physical Vote Protocol on Kaspa
>
> *"Cast your vote. Burn the proof. Keep the truth."*

**[English Version](README.md)**

---

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
    value                ← TOKEN_VAL (0.1 KAS)
    script_public_key    ← Covenant ルール（投票制約スクリプト）
    covenant             ← Option<CovenantBinding>
      authorizing_input  ← 認可する入力のインデックス
      covenant_id        ← 選挙 ID（Hash）
```

---

## プロトコルフロー

```
[事前]
  QR1 を各有権者に配布 (空Wallet = 鍵ペアのみ、KAS不要)
  Election Genesis TX で Master UTXO を生成 (一意な covenant_id)

[投票日 — 投票所にて、1人あたり約3分]
  Phase 1: 選管が JIT Mint → 投票者のウォレットへ送金       (KASTMint)
  Phase 2: 投票者 + 端末の 2-of-2 で Burn → 匿名QR2発行    (KASTAnon)
  Phase 3: QR2 で投票 → 候補者集票アドレスへ                (KASTVote)
           QR2 は物理回収 (投票用紙と同じ)
           ステッカー / 投票証明を配布

[投票中 — バックグラウンド]
  Phase 4a: 選管が Vote UTXO をリアルタイム集約             (KASTTally.aggregate)

[事後]
  Phase 4b: タイムロック解除 → KAS 全額回収                 (KASTTally.release)
  集計:     候補者アドレスの total_value / TOKEN_VAL = 得票数
```

### Phase 0: 選挙セットアップ

```
選挙管理委員会:
  ① Election Genesis TX を発行
     Output: Election Master UTXO
       covenant_id: Hash(outpoint + outputs) ← 選挙の一意な ID
  ② 各有権者に QR1 を生成・配布
     QR1 = 鍵ペアのみ (空ウォレット、KAS は不要)
     秘密鍵を QR コード化して配布
  ③ 有権者名簿から Merkle tree を構築 (将来の ZK 検証用)
     Merkle root をオンチェーンにコミット（公開情報）
```

### Phase 1: JIT トークン発行

投票者が投票所に来所した時点でオンデマンド発行。事前の全量発行は不要。

```
Mint TX (選管デュアルシグ):
  Input:  Election Master UTXO (または continuation)
  Outputs:
    [0]: 投票者トークン UTXO (value = TOKEN_VAL)
         covenant_id: 選挙 ID (continuation)
         script_public_key: KASTAnon(voter_pubkey, station_pubkey)
    [1]: Continuation Master UTXO (同一スクリプト)
         ※ 最終 Mint TX: continuation なし → Master UTXO 消滅 (seal)

  Covenant ルール (KASTMint コントラクト):
    checkSig × 2          → 選管2名のデュアルシグ
    OpCovOutCount          → 全出力が同一 covenant chain
    output.value           → 均一な TOKEN_VAL
    output.lockingBytecode → continuation が master スクリプトを保持

  柔軟バッチ: 1TX あたり 1〜4 トークン (繁忙時は小プール事前生成も可)
```

### Phase 2: 匿名化（QR1 → QR2）

投票所での物理的な匿名化により、投票者の身元と投票内容のリンクを断つ。

```
[物理プロセス]
  ① 投票者が QR1 (身元ウォレット) を提示
  ② 投票所で本人確認 (ID チェック)
  ③ 投票者 + 投票所端末で匿名化 TX に共同署名 (2-of-2)
  ④ 端末が新しい鍵ペアを生成 → QR2 (匿名投票用紙) を印刷
  ⑤ QR1 は回収・無効化

[オンチェーンプロセス]
  Anonymize TX:
    Input: 投票者の identifiable トークン UTXO

    signature_script:
      ├── 投票者の署名 (QR1 の秘密鍵)
      └── 投票所端末の署名 (共同署名)
      + OpZkPrecompile による ZK Proof (オンチェーン匿名化)

    Output: 匿名トークン UTXO
      covenant_id: 同じ選挙 ID (continuation)
      script_public_key: KASTVote(candidateA, ..., candidateJ, electionAuthority, electionEnd)
      value: TOKEN_VAL

  Covenant ルール (KASTAnon コントラクト):
    checkSig × 2           → 2-of-2: 投票者鍵 + 端末鍵
    OpZkPrecompile         → ZK proof で投票者→投票用紙のリンクを暗号的に切断
    OpCovOutCount == 1     → 匿名出力は1つだけ
    output.value == TOKEN_VAL → 完全一致 (フィンガープリント防止)
    recover(sig) + timelock → 未使用時の預託回収

  ※ QR1 の UTXO は消滅 → QR1 は無効化
  ※ 物理的な QR 交換が脅迫/買収耐性を提供
  ※ ZK proof によりオンチェーンのリンクは暗号的に切断
```

### Phase 3: 投票（並走紙投票モデル）

投票者は備え付けPCでQR2を使って投票。QR2用紙は物理的な投票用紙を兼ね、投票後に回収して選挙後の監査に使用。

```
QR2用紙のデザイン:
  ┌─────────────────────────┐
  │  [QRコード]              │  ← 匿名鍵（端末がスキャン）
  │                         │
  │  候補者名: ____________ │  ← 投票者が自書（任意、推奨）
  │                         │
  │  選挙: 2027参院選        │
  └─────────────────────────┘

[物理プロセス]
  ① 投票者が QR2 用紙を受け取る
  ② 用紙に候補者名を自書（物理的に意思を先に記録）
  ③ 備え付けPCで QR2 をスキャン → 画面で同じ候補者を選択
  ④ 端末が送信先アドレスを表示 — ブース壁に掲示された
     候補者アドレス一覧と目視照合
  ⑤ 端末が暗号化 Vote TX を構築 → 送信
  ⑥ 任意: スマホで Benaloh チャレンジ（端末検証、後述）
  ⑦ QR2 用紙を投票箱に投函（投票用紙と同じ回収モデル）
  ⑧ 投票者にステッカー / 参加証明を配布

[Benaloh チャレンジ — スマホでの任意検証]
  ⑤の後、⑦の前に実施:
  a. 端末が暗号化投票を QR コードで表示
  b. 投票者が検証アプリでスキャン（オープンソース、複数団体配布）
  c. 「チャレンジ」→ 端末が復号用乱数を QR で表示
  d. スキャン → アプリが復号 → 候補者名を表示
  e. 選択内容と一致を確認 → この票は破棄
  f. 納得するまで繰り返し → 最後に「投票する」で実際の票を送信
  ※ 暗号の束縛性により端末は偽の乱数を生成不可能
  ※ スマホが見るのは破棄されたチャレンジ票のみ（実際の投票は未検証）

[オンチェーンプロセス]
  Vote TX:
    Input: 匿名トークン UTXO

    signature_script:
      └── 匿名鍵での署名 (QR2)

    Output: 暗号化投票 → 候補者の集票アドレス
      covenant_id: 同じ選挙 ID (continuation)
      script_public_key: 候補者集票スクリプト (P2PK)
      value: TOKEN_VAL

  Covenant ルール (KASTVote コントラクト):
    checkSig               → 匿名鍵の署名検証
    OpCovOutCount == 1     → 出力は1つだけ
    OpTxOutputSpk          → 出力先が候補者ホワイトリスト内 (最大10人)
    output.value == TOKEN_VAL → 完全一致 (フィンガープリント防止)
    OpInputCovenantId      → covenant chain の検証
    recover(sig) + timelock → 未使用時の預託回収
```

### Phase 4: 集計 + リアルタイム集約

選挙中、選管が定期的に Vote UTXO を集約し、ロック資本を解放する。選挙後にタイムロック解除で KAS を回収。

```
[選挙中 — リアルタイム集約]
  Aggregate TX (選管の署名):
    Inputs: 同一候補者アドレスの複数 Vote UTXO (最大8入力)
    Output: 1つの集約 UTXO (value = 全入力の合計)

  Covenant ルール (KASTTally.aggregate):
    checkSig                    → 選管のみ実行可能
    OpCovInputCount             → 同一 covenant の入力数を取得
    OpCovInputIdx + input.value → 全入力の value を合算
    output.value >= total       → 価値保全
    output.lockingBytecode      → 自己参照 (同一 tally スクリプト)
    OpCovOutCount == 1          → 単一の集約出力

  例: 8 Vote UTXO (0.8 KAS) → 1 UTXO (0.8 KAS)

[選挙後 — 集計 & 解除]
  得票数 = 候補者アドレスの total_value / TOKEN_VAL
  → オンチェーンで誰でも検証可能、中央サーバー不要

  Release TX (選管の署名 + タイムロック):
    require(tx.time >= electionEnd)
    → 選挙終了後、選管が預託 KAS を回収
```

### Phase 5: 物理・デジタル監査

選挙後、回収した QR2 用紙をスキャンし、オンチェーンデータと全数照合する。

```
[監査プロセス — 立会人の監視下で実施]
  ① 投票箱を開封、QR2 用紙を取り出す
  ② QR2 用紙を一括スキャン (バーコードリーダー / カメラ)
  ③ 各 QR コードから匿名公開鍵を抽出
  ④ 監査 API がオンチェーンと照合:

     レイヤー1 — 枚数検証 (100%, 完全自動):
       回収した QR2 枚数 vs オンチェーンの Vote TX 数
       一致 → 全投票が正常 ✓
       紙 < TX → 幽霊票を検出（端末が偽造）
       紙 > TX → 未使用投票用紙あり（投票者が未投票で退出）

     レイヤー2 — 署名検証 (100%, 完全自動):
       各 QR2 公開鍵 → 対応する Vote TX を検索
       検証: covenant chain 正当、value == TOKEN_VAL、送信先がホワイトリスト内

     レイヤー3 — 手書き照合 (統計的):
       候補者名を自書した用紙について:
       OCR / 手作業で読み取り → チェーン上の投票先と比較
       正常なノイズ率: ~2-3% (現行の無効票率と同等)
       異常率 (>10%): 当該投票所の全数調査を発動

[投票参加の証明]
  投票者の QR1 トークン UTXO → spent (オンチェーンで確認可能)
  → 「この投票者は選挙に参加した」 ✓
  義務投票国: KASTReceipt UTXO (独立TX) で補助的証明

[投票内容の秘匿]
  ZK proof が投票者→投票用紙のリンクを暗号的に切断
  物理的 QR 交換が追加の脅迫耐性を提供
  暗号化投票によりオンチェーンで投票内容は不可視
```

---

## QR トークンのライフサイクル

### QR1（身元ウォレット — 事前配布）

```
生成 → 投票者に配布 (空ウォレット、鍵ペアのみ)
→ 投票者が投票所に持参
→ トークンが JIT Mint で QR1 ウォレットに送金 (Phase 1)
→ 匿名化に使用 (Phase 2, 2-of-2 共同署名) → UTXO 消滅
→ QR1 は投票所で回収 → 終わり

× 再利用: UTXO が存在しない (コンセンサスが拒否)
× 再発行: Master UTXO が burn 済み (mint 権限が消滅)
× 盗難: 単独では無効 — 投票所端末の共同署名 (2-of-2) が必要
× 撮影: オンチェーンでは投票参加の事実のみ判明、投票先は不明 (ZK追加後)
```

### QR2（匿名投票用紙 — 投票所で生成）

```
端末で生成 (新しい鍵ペア) → 投票用紙に印刷
  用紙構成: QRコード (匿名鍵) + 候補者名記入欄
→ 投票者が候補者名を自書 (物理的に意思を記録)
→ 備え付けPCで QR2 をスキャン → 候補者選択 → 暗号化 Vote TX 送信
→ 任意: スマホで Benaloh チャレンジ (端末の正直性検証)
→ QR2 用紙を投票箱に投函 → 終わり

選挙後:
→ QR2 用紙を一括スキャン → API でオンチェーンと照合
→ 手書き候補者名とチェーン結果を比較 (統計監査)
→ 用紙枚数 vs オンチェーン TX 数の全数照合

× 再利用: UTXO が存在しない
× 再発行: QR1 が消滅済みなので匿名化 TX を再実行できない
× 脅迫: 投票者は投票先を証明できない (QR2回収済み、投票は暗号化、リンク切断)
× 回収後の追跡: ZK により回収された QR2 から投票者の逆引きは不能、暗号化により投票先も不明
```

---

## セキュリティ: 攻撃ベクトルと対策

### 1. タイミング分析攻撃

**脅威**: JIT フローでは Mint → Anon → Vote が投票所内で約3分で完結する。投票者の来所時刻とオンチェーン TX のタイムスタンプを照合することで、投票者と投票先をリンクされる可能性。

```
例: 投票者Aが14:30に来所、オンチェーンでMint 14:31、Anon 14:32、候補者Xへ投票 14:33
    → 時間相関から A → X の投票が推測される
```

**対策**:

| 対策 | 実装方法 |
|---|---|
| 端末バッチ送信 | 投票所端末が全TX（Mint, Anon, Vote）をキューに蓄積し、ランダム化してN分ごとにバッチ送信。個人のタイミングがバッチ内に埋没 |
| 物理的ブース分離 | Phase 2（匿名化）と Phase 3（投票）を物理的に別ブースで実施。観察者がどの投票者がどのブースに入ったかを追跡不能に |
| 高 BPS の活用 | Kaspa 100 BPS: 多数の TX が同一ブロックに入る。バッチ送信と併用で数十人の TX が混在 |
| 将来: DaaScore 窓 | OpTxInputDaaScore が利用可能になれば、Covenant で強制的なフェーズ間時間分離を追加可能 |

### 2. 選挙管理委員会の不正（トークン水増し）

**脅威**: 選管が来所者数以上のトークンを JIT Mint し、不正投票を行う。

**対策**:

| 対策 | 実装方法 |
|---|---|
| Mint 権限の封印 | `seal()` エントリポイントで Master UTXO を永久に burn。seal 後は mint 不可能 |
| JIT 監査証跡 | 全 Mint TX はタイムスタンプ付きでオンチェーン。発行トークン総数を投票所の来所者ログとリアルタイムで照合可能 |
| デュアルシグ要求 | KASTMint は委員2名の署名を要求。単独犯による不正は不可能 |
| 発行数の公開検証 | Merkle tree リーフ数 = 有権者数（公開情報）。登録数を超える発行は即座に検出可能 |
| Covenant 制約 | KASTMint が出力ごとの均一 TOKEN_VAL と covenant chain の連続性を強制 |

### 3. QR1 の盗難・紛失

**脅威**: QR1 は封筒で郵送される。配送中に盗まれた場合、攻撃者が投票者になりすます可能性。

**対策**:

| 対策 | 実装方法 |
|---|---|
| 2-of-2 マルチシグ | KASTAnon は投票者の署名 (QR1) + 投票所端末の署名を要求。盗んだ QR1 だけでは匿名化 TX を実行不可 |
| 投票所での本人確認 | 物理 ID チェック（免許証、マイナンバーカード等）が端末共同署名の前提条件 |
| JIT による保護 | v2 では QR1 は空ウォレット — 来所するまでトークンは存在しない。来所前に QR1 を盗んでも何も得られず、攻撃者は投票所で本人確認も突破する必要がある |
| 紛失時の扱い | 再発行不可（Master は seal 可能）。投票権の喪失として扱う。紛失届で監査証跡を残す |

### 4. 脅迫・買収

**脅威**: 「候補者 X に入れたことを証明しろ」と脅迫される、または投票権を売買される。

**対策**:

| 対策 | 実装方法 |
|---|---|
| 物理的 QR 交換 | 投票所での QR1 → QR2 交換が物理的な断絶を生む。投票者は投票先の証拠を一切持たずに退出 |
| QR2 の回収 | QR2 は投票後に物理回収される（投票用紙を投票箱に入れるのと同じ）。投票者は証拠を保持できない |
| 匿名鍵の破棄 | QR2 の秘密鍵は端末の TEE で生成・使用・即破棄。投票者自身も匿名鍵を知らない |
| リンク切断 | 物理的: QR1→QR2 の対応は投票所だけが知る。将来の ZK: オンチェーンリンクも暗号的に切断 |
| ブース隔離 | 投票ブースが画面撮影を物理的に防止。端末は外部通信を遮断 |
| 買収の無意味化 | QR1 を買っても投票先を制御不能 — QR2 は投票所で新しい鍵から生成されるため |

### 5. 投票所端末の改竄

**脅威**: 改竄された端末が投票者の選択と異なる候補者に投票する、または QR1→QR2 の対応を漏洩する。

**対策**:

| 対策 | 実装方法 |
|---|---|
| 投票確認画面 | Vote TX 送信前に候補者名とアドレスハッシュを表示。投票者が確認 |
| オープンソース端末 | 投票所ソフトウェアを公開し第三者監査可能に。TEE によるハードウェア認証 |
| 端末の多重検証 | 複数の独立端末で TX を構築し、出力が一致した場合のみ送信 |
| ログ破棄 | 端末は投票者ごとのセッション終了後に QR1→QR2 対応ログを破棄。永続的な記録を残さない |
| 独立監視員 | 第三者の選挙監視員が端末の動作を監視し、バッチ送信を監査 |

### 6. Sybil 攻撃（偽有権者の登録）

**脅威**: 架空の有権者を名簿に追加し、偽アドレスに QR1 を郵送して不正投票に使用。

**対策**:

| 対策 | 実装方法 |
|---|---|
| 名簿の公開監査 | 有権者名簿（Merkle tree リーフ数）を公開。人口統計データとの照合 |
| 既存 ID 制度との連携 | 住民基本台帳、マイナンバー、生体認証データベースと紐づけ。実在する有権者のみが QR1 を受領 |
| Merkle root の事前公開 | 投票開始前に Merkle root を公開。有権者が自身の inclusion を検証可能 |
| JIT クロスチェック | 投票所ごとの JIT Mint 数 vs 実際の来所者数を監査可能。異常な比率の投票所はフラグ |

### 7. ネットワーク攻撃（51% 攻撃）

**脅威**: Kaspa ネットワークの過半数のハッシュレートを取得し、投票 TX を改竄・巻き戻す。

**対策**:

| 対策 | 実装方法 |
|---|---|
| Kaspa の PoW + DAG 耐性 | DAG 構造により、51% 攻撃が従来のブロックチェーンより大幅に困難 |
| 投票期間の制限 | 短い選挙期間を設定し、攻撃者がハッシュレートを集積する時間を制限 |
| ファイナリティの確認 | 十分な DAG depth 確認を待ってから結果を確定 |
| 多層検証 | オンチェーン結果と投票所の物理ログ、並行する紙の監査証跡を照合 |

### 8. プライバシー漏洩（チェーン分析）

**脅威**: 投票 TX のパターン分析（金額、手数料、スクリプトサイズ、タイミング）から投票者を特定する。

**対策**:

| 対策 | 実装方法 |
|---|---|
| 均一な TX 構造 | 全投票 TX の value (TOKEN_VAL)、スクリプトサイズ (KASTVote = 全投票者共通488B)、構造が同一 |
| 固定額の投票トークン | 全トークンが TOKEN_VAL (0.1 KAS) で統一。金額ベースの fingerprint 不可 |
| 統一スクリプト | KASTVote コントラクトは同一選挙内の全投票者で同一（同一コンストラクタ引数 = 同一バイトコード） |
| バッチ送信 | TX を投票所でバッチ送信し、タイミングベースの fingerprint を防止 |

### 9. 集約の不正操作

**脅威**: aggregate 関数を管理する選管が、集約中に票を消失させる、集約を遅延させて預託を枯渇させる、または特定候補の票だけを選択的に集約する。

**対策**:

| 対策 | 実装方法 |
|---|---|
| 価値保全（オンチェーン） | KASTTally.aggregate は `output.value >= sum(input.values)` を Covenant で強制。選管は価値を減少させることが**不可能** — 試みはコンセンサスが拒否 |
| Covenant 自己参照 | 集約出力は同一 KASTTally スクリプト (`this.activeBytecode`) を使用しなければならない。選管が別アドレスに資金を流用することは不可能 |
| 集約前の集計可能性 | 得票数は集約前でも常に検証可能: 候補者アドレスの全 covenant UTXO をカウント。集約は最適化であり、集計の必要条件ではない |
| 集約遅延の検出 | 選管が集約を遅延させると預託が不足し JIT Mint が滞る。これは公開的に観測可能であり、監査のトリガーになる |
| 独立した集約監査 | 全 Aggregate TX を第三者が検証可能: 入力合計 == 出力値、同一 covenant chain、同一スクリプト。異常は検出可能 |
| 選択的集約への防御 | 選管が特定候補のみ集約しても、未加工の UTXO カウントがオンチェーンに ground truth として残る。集約は個別の Vote UTXO を消去できない — 統合するだけ |

### 10. 端末信頼性（投票の完全性）

**脅威**: 投票所端末が QR2 の秘密鍵を生成・保持し Vote TX を構築する。投票者は Phase 3 で暗号的な制御権を持たないため、端末が選択と異なる候補者に投票する可能性。

**対策**:

| 対策 | 実装方法 |
|---|---|
| 並走紙投票 | 投票者がデジタル投票の**前に** QR2 用紙に候補者名を自書。紙が物理的な意思記録となる。選挙後に紙とオンチェーン結果を照合 |
| Benaloh チャレンジ (スマホ) | 投票者が任意でオープンソースアプリにより端末の正直性を検証。端末は暗号化投票にコミット、投票者がチャレンジで復号を要求。暗号の束縛性により偽造は数学的に不可能。投票者自身のデバイスで検証 |
| 候補者アドレス掲示 | 候補者の集票アドレスをブース壁に物理掲示（事前印刷）。投票者が端末表示と目視照合 |
| 物理・デジタル監査 | 回収した全 QR2 用紙を選挙後にスキャン。API がオンチェーン TX と全数照合。枚数不一致や手書き異常率で調査発動 |
| 多重端末合意 | 複数の独立端末で TX を構築し、出力が一致した場合のみ送信 |

### 11. メンプール検閲（選択的 TX フィルタリング）

**脅威**: マイナーがメンプール内の Vote TX の送信先を観察し、特定候補への票を選択的に遅延・除外。51% は不要 — 10% のハッシュレートでも統計的に有意な偏りを生成可能。

**対策**:

| 対策 | 実装方法 |
|---|---|
| 暗号化投票 | Vote TX は暗号化された候補者選択を含む。マイナーは送信先候補者を判別不能。検閲がランダムになり無意味化 |
| 投票所バッチ送信 | TX をバッチ化して複数ノードに同時送信。単一マイナーの検閲機会を削減 |
| DAG 構造 | Kaspa の DAG は並列ブロックを許容。検閲された TX は 100ms 以内に別マイナーが取り込み可能 |
| 検閲モニタリング | 送信 TX vs 確認 TX のリアルタイム比較。特定投票所で異常な確認遅延があればアラート |

### 12. 選管鍵の同時漏洩

**脅威**: 2名の commissioner 秘密鍵が同時に漏洩 — 無制限の JIT Mint、不正な seal、不正な集約が可能に。

**対策**:

| 対策 | 実装方法 |
|---|---|
| HSM 鍵保管 | commissioner 鍵をハードウェアセキュリティモジュールに格納。鍵が HSM から出ることはない |
| 投票所ごとの鍵ペア | 各投票所に固有の commissioner 鍵ペア。1箇所の漏洩が他に影響しない |
| Mint 数モニタリング | リアルタイムのオンチェーン監視: Mint トークン総数 vs 投票所来所者数。異常な Mint スパイクで即時アラート |
| Seal 権限の分離 | seal 機能 (Master UTXO 永久封印) に mint とは別の認可を要求 |

### 13. 預託リーク（未使用トークン）

**脅威**: 投票者がトークンを受け取った後、フローを完了せずに退出（Phase 1 または Phase 2 後に離脱）。回収手段がなければ TOKEN_VAL が永久ロック。

**対策**:

| 対策 | 実装方法 |
|---|---|
| recover エントリポイント | KASTAnon と KASTVote に `recover(sig authSig)` と `require(tx.time >= electionEnd)` を実装。選挙終了後に選管が預託を回収可能 |
| 投票所モニタリング | 投票所が発行した QR2 数 vs 完了した投票数を追跡。未完了セッションを選挙後の回収対象としてフラグ |

### 14. サービス拒否攻撃（選挙インフラ）

**脅威**: 攻撃者が投票時間帯に Kaspa ネットワークにスパム TX を大量送信してブロック確認を遅延、または候補者アドレスにダスト UTXO を送信して UTXO セットを肥大化。

**対策**:

| 対策 | 実装方法 |
|---|---|
| KIP-9 storage mass | Kaspa の手数料モデルが小額 UTXO 作成にペナルティ。ダスト攻撃は経済的に高コスト |
| Covenant フィルタリング | 正しい選挙 ID を持つ covenant 付き UTXO のみが集計に参加。covenant 外のダストは無視 |
| 優先手数料レーン | 選挙 TX は高い手数料を使用して混雑時の確実な取込を確保 |
| DAG スループット | Kaspa の 10,000+ TPS 容量が選挙に必要な ~2,000-6,000 TPS を大幅に上回る |

---

## 物理・デジタル監査

選挙後の監査システム。投票と紙の整合性を100%自動カバーする。

### 監査 API

```
POST /api/audit/verify
  Input:  { pubkey: "<QR2 匿名公開鍵>" }
  Output: {
    vote_tx_found: true,
    tx_hash: "...",
    covenant_valid: true,
    value_correct: true,
    candidate: "<候補者名>"
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

### 3層検証

| レイヤー | 検証内容 | カバー率 | 自動化 |
|---|---|---|---|
| 1. 枚数 | QR2 用紙枚数 vs オンチェーン TX 数 | **100%** | 完全自動 |
| 2. 署名 | 各 QR2 鍵 → 対応する Vote TX がチェーン上に存在 | **100%** | 完全自動 |
| 3. 手書き | 自書した候補者名 vs チェーン上の投票先 | 書いた人のみ (~80%) | OCR + 手動 |

異常検出しきい値:
- レイヤー1: 枚数不一致 → 即時調査
- レイヤー2: 未照合鍵 → 幽霊票または未使用投票用紙としてフラグ
- レイヤー3: ノイズ率 > 10% → 当該投票所の全数手作業再集計

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

### 他の ZK / プライバシーチェーンとの比較

投票システムに適した L1 は他にも存在する。以下は KAST の要件に照らした正直な比較である。

| | Kaspa (Covenant++ / vProgs) | Aztec (Ethereum L2) | Aleo | Cardano (eUTXO) |
|---|---|---|---|---|
| コンセンサス | **PoW（検閲耐性最強）** | PoS（Ethereum 依存） | PoS | PoS |
| データモデル | **UTXO** | Notes（UTXO 的） | Records（UTXO 的） | **eUTXO** |
| プライバシー | ZK proof で実装 | **ネイティブ（全 TX 暗号化）** | **ネイティブ** | ZK proof で実装 |
| L1 ZK 検証 | **あり（Groth16 / RISC0）** | **あり** | **あり** | 限定的 |
| L1 プログラマビリティ | 制限的（スタックベース） | 高い（Noir 言語） | 高い（Leo 言語） | 高い（Plutus） |
| スループット | **10,000+ TPS（100 BPS 時）** | Ethereum 依存 | 低い | 低い |

#### プライバシー: Aztec / Aleo の方が上

Aztec と Aleo は、全トランザクションにプライバシーがプロトコルレベルで組み込まれている。つまり KAST の Phase 2（匿名化ステップ）のような追加処理なしに、投票者の匿名性が自動的に確保される。Kaspa ではこの匿名化を ZK proof + UTXO 遷移で明示的に実装する必要がある。

#### プログラマビリティ: Kaspa L1 は制限的、ただし KAST には十分

Kaspa の L1 スクリプトは Bitcoin Script の拡張であり、チューリング不完全である。ループ、動的配列、再帰といった構造は使えない。Aztec (Noir)、Aleo (Leo)、Cardano (Plutus) は汎用プログラミング言語に近い表現力を持つ。

ただし、KAST が必要とするロジックは L1 スクリプトの範囲内で全て記述可能である:

- Merkle membership 検証 → `OpZkPrecompile` で ZK proof を検証
- 1 入力 → 1 出力の制約 → `OpCovOutCount` で強制
- 出力先が候補者リスト内 → `OpTxOutputSpk` で検証
- トークン量の保存 → `OpTxOutputAmount` で検証
- 時間窓の制約 → `OpTxInputDaaScore` で強制

暗号化集計や委任投票など、より複雑なロジックは将来の vProgs（CairoVM L2）で対応する。

#### vProgs (L2) のセキュリティ: Based Rollup 設計

vProgs は「Based Rollup」設計を採用しており、一般的な L2 とは異なり、L1 への依存度が極めて高い:

| 役割 | 一般的な L2 | Kaspa vProgs |
|---|---|---|
| シーケンシング（TX 順序確定） | 独自シーケンサー（検閲リスク） | **Kaspa L1 が担当（PoW で保護）** |
| データ可用性 | 独自 or 外部 DA（隠蔽リスク） | **Kaspa L1 が全データ保持** |
| 決済（正当性検証） | 詐欺証明 or ZK proof | **ZK proof で L1 が検証** |
| 実行 | L2 上 | **オフチェーン（CairoVM）** |

L2 が独自に担うのは実行のみであり、シーケンシング・データ可用性・決済は全て L1 の PoW コンセンサスに委ねられる。vProgs を攻撃するには「ZK proof の数学を破る」か「Kaspa L1 の PoW を破る」しかなく、いずれも現実的ではない。

#### 検閲耐性: 選挙で最も重要な要件

選挙は国家権力と直接衝突するユースケースである。DeFi や NFT であれば PoS チェーンでも十分だが、投票システムでは政府が投票 TX を検閲するインセンティブを持つ。

- **PoW**: マイナーは匿名で世界中に分散しており、特定の TX を拒否させることが構造的に困難
- **PoS**: バリデータは既知でありステーキング額で特定可能。理論的に政府がバリデータに圧力をかけ、特定の TX を拒否させることが可能

投票システムにとって、PoW の検閲耐性は「あれば望ましい」ではなく「なければ致命的」な要件である。

#### スループット: 10,000+ TPS で世界中の選挙に対応

Kaspa は 100 BPS 到達時に 10,000+ TPS を実現する。以下は主要国の国政選挙に必要な TPS の試算:

| 国 | 投票者数 | 投票時間 | 必要 TPS | 10,000 TPS に対する負荷 |
|---|---|---|---|---|
| 日本 | 5,500 万人 | 13 時間 | ~2,350 | 23% |
| アメリカ | 1.44 億人 | 13 時間 | ~6,150 | 62% |
| EU 全体 | 1.85 億人 | 13 時間 | ~7,900 | 79% |
| インド | 6.2 億人 | 複数日に分散 | 分散で対応可 | — |

KAST では 1 投票者あたり 2 TX（匿名化 + 投票）を必要とする。日本の国政選挙は Kaspa の処理能力の 23% 程度で処理可能であり、ピーク負荷を考慮しても十分な余裕がある。

#### 結論: なぜ Kaspa なのか

プライバシー単体では Aztec / Aleo が優位であり、L1 プログラマビリティでは Cardano / Ethereum が上回る。しかし、**PoW による検閲耐性 + UTXO モデル + L1 ZK 検証 + 10,000+ TPS** を全て備えるチェーンは Kaspa 以外に存在しない。

選挙システムにおいて検閲耐性は最優先の要件であり、この点で PoS チェーンは PoW に勝てない。Kaspa は「投票のために設計されたわけではないが、投票に最も適した技術的組み合わせを持つチェーン」である。

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

## 実装状況

コントラクトは [SilverScript](https://github.com/aspect-build/silverscript) で記述し、`silverc` でコンパイル済み。ソースとバイトコードは本リポジトリに格納。

### コンパイル済みコントラクト

| Contract | ファイル | Bytecode | ABI | 役割 |
|---|---|---|---|---|
| KASTMintV2 | `kast_mint_v2.sil` | 329 B | `mint(sig,sig)` / `seal(sig,sig)` | JIT トークン発行 |
| KASTAnonV2 | `kast_anon_v2.sil` | 157 B | `anonymize(sig,sig)` / `recover(sig)` | 2-of-2 匿名化 + 預託回収 |
| KASTVoteV2 | `kast_vote_v2.sil` | 549 B | `vote(sig,pubkey)` / `recover(sig)` | 10候補者投票 + 預託回収 |
| KASTTallyV2 | `kast_tally_v2.sil` | 4,016 B | `aggregate(sig)` / `release(sig)` | リアルタイム集約 + covenant 終端検証 |
| KASTReceipt | `kast_receipt.sil` | 95 B | `claim(sig)` / `void(sig)` | 義務投票証明 (独立TX発行) |

### コスト試算 (5,000万人規模, TOKEN_VAL = 0.1 KAS, 低混雑)

| | 必要資金 | 性質 |
|---|---|---|
| ピーク預託 | ~37,000 KAS | 選挙後に全額回収 |
| トランザクション手数料 | ~44,000 KAS | 消費 (マイナーへ) |
| **合計** | **~81,000 KAS** | |

手数料内訳: Mint 30K (69%, storage mass が支配的) + Anon 10K + Vote 3K + Aggregate 0.5K

### パラメータ

| パラメータ | 値 | 根拠 |
|---|---|---|
| TOKEN_VAL | 0.1 KAS (10M sompi) | storage mass と預託のバランス |
| MAX_BATCH (Mint) | 4 | 投票所の混雑度に応じて調整 |
| MAX_AGGREGATE (Tally) | 8 | スクリプトサイズ上限 (10KB) |
| 候補者スロット | 10 | 主要な選挙形態をカバー |

セキュリティ強化 (v2.1): value 完全一致 (`==`) でフィンガープリント防止、`recover` で未使用トークンの預託回収、`release` で covenant chain 終端を強制、KASTReceipt は匿名化を保護するため独立TX発行に変更。

---

## 国際対応

| 要件 | 対象国 | KAST のアプローチ |
|---|---|---|
| 秘密投票 | 全民主国家 | QR1/QR2 物理交換 + ZK 匿名化 |
| 義務投票証明 | 27カ国 (ボリビア、豪州等) | Phase 2 UTXO spent-status が主証明; KASTReceipt は補助的に独立TX発行 |
| 二重投票防止 | インク方式 90カ国以上 | Covenant: 1 UTXO = 1票 (インク不要) |
| タイミング分析防止 | 全般 | TX バッチ送信 + 暗号化投票 |
| 投票者紐づけ許可 | 米国一部州 (IN, NC) | ZK をオプション化で対応可能 |
| 端末信頼性検証 | 全般 | 並走紙投票 + Benaloh チャレンジ + 物理・デジタル監査 API |
| 高齢者 / デジタルリテラシー低 | 日本、多数国 | QR2 用紙に候補者名を自書（馴染みのある投票体験） |

---

## 設計上の制約

| 制約 | 影響 | 緩和策 |
|---|---|---|
| MAX_AGGREGATE = 8 | 集約は8入力/TX に制限 | 多段集約; compile-time ループ展開の制限 |
| 候補者スロット = 10 | 選挙あたり最大10候補 | 主要選挙に十分; vProgs で拡張可能 |
| スクリプトサイズ制限 (10KB) | 複雑な投票ルールは L1 に収まらない可能性 | vProgs (CairoVM) で高度なロジック |
| インデクサーの必要性 | covenant_id ベースの効率的なクエリに専用インデクサーが必要 | 標準ブロックチェーンインフラ |
| リモート投票なし | 物理的な投票所が必須 | 設計上の意図 — 物理的脅迫攻撃を防止 |

### vProgs 拡張 (CairoVM L2)

| 拡張 | 説明 |
|---|---|
| 暗号化投票 + Benaloh | CairoVM + Stwo で暗号化投票を送信、スマホでの Benaloh 検証 |
| 準同型集計 | 個別の投票を復号せずに暗号化したまま集計 |
| 委任投票 (Liquid Democracy) | vProg のグローバルステートで委任関係を管理 |
| リアルタイム投票率表示 | vProg が投票状況を集計し、ZK proof 付きで公開 |
| クロス選挙区合成 | 複数の選挙区 vProg を Proof Stitching で結合 |

---

## 技術スタック

| コンポーネント | 技術 |
|---|---|
| L1 ブロックチェーン | Kaspa (PoW + blockDAG, Covenant++ HF) |
| L2 実行環境 | vProgs (CairoVM, Based Rollup) |
| ZK 証明生成 | RISC0 (Rust ゲストプログラム) / Groth16 (ark-bn254) |
| ZK 証明検証 | OpZkPrecompile (0xa6) on Kaspa L1 |
| 投票暗号化 | 閾値暗号 (commissioner N-of-M 復号) |
| 投票者検証 | Benaloh チャレンジ (オープンソーススマホアプリ) |
| Merkle tree | Blake2b ハッシュベース |
| トークン管理 | Covenant ID + UTXO |
| 物理配送 | QR コード封入封筒 |
| 投票端末 | オープンソース、TEE 対応 |
| 監査システム | 物理・デジタル監査 API (QR2 スキャン → オンチェーン照合) |

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
