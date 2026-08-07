# LINE アカウント紐付け（個別コード方式） 設計書

- 作成日: 2026-08-07
- ステータス: 承認済み（実装計画へ）
- 前提調査: `docs/LINE_USERID_LINKING_RESEARCH.md`
- 上位ゴール: Slackの担当回答を本人のLINEへ自動送信する（③）。本設計はその前提となる
  「アプリの users ↔ LINEの userId」の対応表づくり。

## 1. 目的

各メンバーの LINE userId を収集し、`users` テーブルに紐付ける。
方式は調査で決定済みの**個別コード方式**:
メンバーごとに固有コードを発行 → 公式LINEにコードを送ってもらう → Webhookで受けて自動紐付け。

## 2. 全体フロー

```
管理画面でコードを一括発行（例: RIM-4823）
  → 管理者がメンバーへ個別に案内（文面テンプレはこちらで用意）
  → メンバーが公式LINEのトークにコードを送る
  → LINEプラットフォーム → POST /api/webhooks/line-userid（署名検証）
  → コードを users.line_link_code と突合
  → 一致: users.line_user_id を保存し、reply APIで「登録できました😊」（replyは無料）
  → 不一致: 何もしない（人間のチャット対応に委ねる。誤反応させない）
  → 管理画面「LINE連携」で連携状況を確認・取り消し
```

- 既存の手動チャット運用は不変（チャットON＋WebhookONの併用。調査で確認済み）
- 「応答メッセージ」もONのまま（ユーザー確認済み。キーワード応答ならコードに反応しない）

## 3. スコープ

### やること（この版）

- `users` に3カラム追加（`line_user_id` / `line_link_code` / `line_linked_at`）
- コードの一括発行（管理画面ボタン。未発行のアクティブメンバー全員に採番）
- Webhook受け口（LINE署名検証・コード突合・reply返信）
- 管理画面「LINE連携」セクション（一覧・未連携の可視化・連携取り消し）
- メンバー向け案内文テンプレ

### やらないこと（意図的な見送り）

| 見送るもの | 理由 |
|---|---|
| LINEへのプッシュ送信（③本体） | 課金対象。通数見積もりと合わせて次フェーズ |
| LIFF・アカウント連携API | 個別コード方式で足りる（調査済み） |
| followers/ids API | 未認証アカウントでは使えない |
| リッチメニュー等のLINE側UI | 不要 |

## 4. データモデル（users テーブルへの追加）

| カラム | 型 | 内容 |
|---|---|---|
| line_user_id | TEXT NULL UNIQUE | LINEのuserId（U始まり33字）。UNIQUEで「1つのLINEに複数メンバー」を防ぐ |
| line_link_code | TEXT NULL UNIQUE | 紐付けコード（例: RIM-7F3K9QCD）。発行時に採番。紐付け成立時にNULLへ戻す（一度きり） |
| line_linked_at | TIMESTAMPTZ NULL | 紐付け完了日時 |

- コード形式: `RIM-` + 8文字。文字集合は `23456789ABCDEFGHJKMNPQRSTVWXYZ`（紛らわしい 0/1/I/O/L/U を除いた30字）。
  空間は 30^8 ≒ 6.5×10^11 で総当たり不能（旧仕様の4桁数字＝1万通りは数百回の試行で他人の枠を奪えたため2026-08-07に改訂）。
  乱数は `crypto.randomInt`（`Math.random` は不使用）。衝突時は再抽選（UNIQUE制約が最終防衛）
- コードは一度きり: 紐付け成立時に `line_link_code` をNULLに戻す。再連携が必要な場合は管理画面から再発行する
- 対象: `is_active = true` の全メンバー（インターン含む。LINE連絡は全員共通のため）。退職（`is_active = false`）後はコードが残っていても紐付け不可

## 5. Webhook `/api/webhooks/line-userid`

1. **署名検証**: ヘッダ `x-line-signature` と、channel secret による rawBody の HMAC-SHA256(base64) を
   `timingSafeEqual` で比較。secret未設定は500・不一致は401（Slack受け口と同じ流儀）。channelSecretが空文字の場合も
   `verifyLineSignature` 内でfail-closed（`false`）にする
2. `events[]` を走査。`type === "message"` かつ `message.type === "text"` かつ `source.type === "user"`（1:1トークのみ。
   グループ/ルームで晒されたコードでの紐付けを防ぐ）のみ対象
3. テキストを正規化（trim・全角英数→半角・ハイフン類の表記ゆれ吸収・大文字化）してコード形式 `RIM-[0-9A-Z]{8}` に
   一致するか判定。一致しないメッセージは**完全に無視**（通常の人間宛てチャット。誤反応させない）
4. 判定順序（オラクル化防止のため冪等チェックを先行させる）:
   1. 送信者の `line_user_id` で検索し、既に**誰か**に紐付いていれば reply「すでに連携済みです😊」で終了
      （コード照合前。LINE再送・コード再送を吸収する）
   2. コードで `users.line_link_code`（`is_active = true` 限定）を検索。見つからなければ統一失敗文言
   3. 条件付きUPDATE（`line_user_id IS NULL` の行だけ）で紐付け。失敗（使用済み/同時送信の競合）なら統一失敗文言
   4. 成功 → `line_user_id` / `line_linked_at` を保存し `line_link_code` をNULLに戻す（一度きり化）。
      reply「登録できました😊 （氏名）さんとして連携しました」＋管理者へSlack通知（best-effort）
   - **統一失敗文言**（見つからない/使用済み/退職者コードのいずれも同一）:
     「このコードでは連携できませんでした。お手数ですが担当にご確認ください🙇‍♂️」
     区別は外部に応答として漏らさず、`console.warn` にのみ理由を残す（総当たりオラクル化の防止）
5. reply は必ず**reply API**（無料）。push は使わない
6. 常に200を返す（LINEの再送で多重処理しないよう、既連携チェックが冪等性を担保）

## 6. 管理画面「LINE連携」セクション

`AdminSection` に新セクション `"line"` を追加（型 → navItems → AdminNavIcon → 表示ブロックの4点セット）。
中身は別コンポーネント（`app/components/AdminLineLinkSection.tsx`）に切り出す（page.tsx肥大化対策）。

- 一覧: 氏名／コード／状態（連携済み・未連携）／連携日時。未連携を上に。`is_active=false` でも
  `line_user_id` が残っている行（退職済みだが紐付けが残る行）は「無効メンバー」バッジ付きで表示する
- ボタン「コードを一括発行」: 未発行のアクティブメンバー全員に採番（confirm付き）
- 行操作「連携を取り消す」: `line_user_id`/`line_linked_at` をNULLに（confirm付き。誤紐付けの救済。
  取り消し時点で既に `line_link_code` はNULLのため、再連携させるには下の再発行が必要）
- 行操作「コード再発行」: `reissueLineLinkCode` で新しいコードを採番して上書き（confirm付き。古いコードは失効）。
  取り消し後の再案内や、コード紛失時に使う
- 案内文テンプレをコピーできる欄（コード差し込み済みの文面）

API: `/api/admin/line-links`（GET一覧・POST一括発行）、`/api/admin/line-links/[id]`（PATCH取り消し）。
認証は既存 isAdmin パターン。

## 7. 環境変数

- `LINE_CHANNEL_SECRET`（署名検証）
- `LINE_CHANNEL_ACCESS_TOKEN`（reply API）
- いずれも Vercel に設定（ユーザーが控え済み）。`.env.example` に追記

## 8. エラー処理

| 事象 | 挙動 |
|---|---|
| 署名検証失敗 | 401。ログ |
| secret未設定 | 500（fail-closed） |
| reply失敗 | warn（紐付け自体は成立していれば成功扱い） |
| DB失敗 | 500にせず200（LINE再送での多重を避ける）。console.error |
| コード再送（既連携の本人） | reply「すでに連携済みです😊」で冪等 |

## 9. テスト・検証

- `tsc` + `build` + 実機（管理者自身のLINEでコード送信→連携→管理画面確認→取り消し→再連携）
- LINE Developers の Webhook「検証」ボタンでの疎通確認

## 10. 結線手順（ユーザー作業・実装後に案内）

1. Supabase でカラム追加SQL実行
2. Vercel に `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` → Redeploy
3. LINE Developers → Messaging API設定 → Webhook URL に
   `https://my-attendance-rho.vercel.app/api/webhooks/line-userid` を設定 → 検証 → Webhook利用ON
4. 管理画面でコード一括発行 → まず管理者自身で実機テスト → メンバーへ順次案内

---

**2026-08-07 セキュリティレビューにより改訂: コード8文字化・一度きり・オラクル排除・アトミック化・1:1限定**

- コードを `RIM-` + 4桁数字 → `RIM-` + 8文字（30字集合・`crypto.randomInt`）へ（§4）。
  4桁数字＝1万通りは総当たりで他人の紐付け枠を奪えたため
- 紐付け成立時に `line_link_code` をNULLに戻し、コードを一度きりにした（§4・§5）
- 失敗系の返信文言を1種類に統一し、コードの「未発行/使用済み/退職者」を外部に判定させない
  オラクルを塞いだ（§5）。区別は `console.warn` のみに残す
- 冪等チェック（送信者のLINEが既に誰かと紐付いているか）をコード照合より先に行うよう順序変更（§5）
- `linkLineUser` を「`line_user_id IS NULL` の行だけ更新」の条件付きUPDATEにし、同時送信時の
  後勝ち上書きを防止（アトミック化）
- `source.type !== "user"` を除外し、グループ/ルームでの紐付けを禁止（1:1トーク限定）
- 退職者（`is_active = false`）のコードでは紐付けできないようにした
- 連携成功時に管理者へSlack通知（best-effort）を追加。誤紐付けに人間が気付ける最後の砦
- 管理画面に「コード再発行」を追加（§6）。取り消し後・紛失時の再案内に使う
