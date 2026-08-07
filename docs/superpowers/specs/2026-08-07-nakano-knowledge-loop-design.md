# 中野くん知識ループ（Slackスレッド返信の知識化） 設計書

- 作成日: 2026-08-07
- ステータス: 承認済み（実装計画へ）
- 前提: `2026-08-06-nakano-bot-design.md`（中野くん本体）

## 1. 目的

エスカレーションされた質問に担当がSlackスレッドで返した回答を、
**中野くんの知識として再利用できる形で蓄積する**。

現状、担当の回答は公式LINEで本人に返して終わりで、どこにも貯まらない。
同じ質問が来るたびに人が答え続けることになり、「質問したのに返ってこない」
体験の母数も減らない。回答を知識に還流させ、**次からは中野くんが即答する**
状態を作るのがこのループの目的。

## 2. 全体フロー

```
メンバーが質問 → 中野くんがエスカレ（SlackへBot投稿）
  → 担当がスレッドで回答（本人へのLINE返信は従来どおり手動）
  → 良い回答に 📚 リアクション
  → Slackイベントを受信 → 質問＋スレッド返信をAIで一般化した知識文案に整形
  → 管理画面「知識の管理」の【承認待ち】に並ぶ
  → 承認 → nakano_knowledge に正式登録（次の質問から中野くんが使う）
  → 却下 → 破棄（本番知識は汚れない）
```

**二重ゲート**が設計の核。
📚を付けた返信だけが対象（ゲート1）、承認するまで本番に出ない（ゲート2）。
スレッド返信の生文は「その人・その場面向け」であることが多く、
そのまま知識に入れると使いものにならないため、AI整形を挟む。

## 3. スコープ

### やること（この版）

- Slackアプリ（Bot）基盤の導入。エスカレ通知をWebhook送信からBot投稿に切替
- 📚リアクションのイベント受信（Events API）
- 質問＋スレッド返信のAI整形（安価なモデル）→ 承認待ちドラフト保存
- 管理画面に【承認待ち】セクション（編集・承認・却下）
- 承認時に既存 `nakano_knowledge` へINSERT

### やらないこと（意図的な見送り）

| 見送るもの | 理由 |
|---|---|
| ✅による未対応リマインド（②） | 同じBot基盤に乗るが別プロジェクト。基盤完成後に着手 |
| Slack返信→LINE自動返信（③） | LINE Messaging API＋本人紐付けが未解決。最難関のため最後 |
| 📚以外の絵文字対応 | まず1つで運用。増やすのは要望が出てから |
| 知識の自動反映（承認スキップ） | 汚染リスク。承認ゲートは外さない |

## 4. Slackアプリ基盤（1回だけの下準備）

ユーザー（管理者）の操作。実装時に1ステップずつ案内する。

1. https://api.slack.com/apps でアプリ作成（無料）
2. Bot Token Scopes: `chat:write`（投稿）, `reactions:read`（📚検知）,
   `channels:history`（スレッド返信の取得）※プライベートチャンネルなら `groups:history`
3. ワークスペースにインストール → Botトークン（`xoxb-...`）を取得
4. `ai-中野くん-溢れた質問` チャンネルにBotを招待
5. Event Subscriptions を有効化し、Request URL に
   `https://my-attendance-rho.vercel.app/api/webhooks/slack-events` を登録。
   購読イベント: `reaction_added`
6. Vercel環境変数: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_NAKANO_CHANNEL_ID`

**エスカレ通知の送信切替**: `notifyNakanoEscalation` を Incoming Webhook から
Bot `chat.postMessage` に切り替える。Bot投稿なら投稿ID（`ts`）が返るため、
「📚が付いた投稿＝どの質問か」をシステムが辿れる（Webhookでは不可能）。
`SLACK_BOT_TOKEN` 未設定時は従来のWebhook送信にフォールバックし、段階移行を可能にする。

## 5. データモデル

### 新テーブル: `nakano_escalations`（Bot投稿と質問の対応表）

| カラム | 型 | 内容 |
|---|---|---|
| id | uuid PK | |
| conversation_id | uuid | nakano_conversations.id |
| user_id | uuid | 質問したメンバー |
| question | text | 質問文 |
| slack_channel_id | text | 投稿先チャンネル |
| slack_ts | text | Bot投稿のts（📚イベントから逆引きするキー。UNIQUE） |
| created_at | timestamptz | |

### 新テーブル: `nakano_knowledge_drafts`（承認待ち置き場）

| カラム | 型 | 内容 |
|---|---|---|
| id | uuid PK | |
| escalation_id | uuid | nakano_escalations.id（NULL可: 逆引き失敗時） |
| question | text | 元の質問 |
| raw_answer | text | スレッド返信の生文（複数返信は連結） |
| draft_title | text | AI整形後のタイトル |
| draft_body | text | AI整形後の本文 |
| status | text | 'pending' / 'approved' / 'rejected' |
| slack_permalink | text | 元スレッドへのリンク |
| approved_knowledge_id | uuid | 承認時に作成した nakano_knowledge.id |
| created_at / updated_at | timestamptz | |

- 同一 `escalation_id` の pending が既にあれば再作成しない（📚の重複押下対策）
- 承認時: `nakano_knowledge` に `show_as_step=false, is_active=true` でINSERT
  （FAQボタンに出すかは既存の知識管理UIで後から変更できる）

## 6. 処理の流れ（イベント受信）

`POST /api/webhooks/slack-events`:

1. **署名検証**（`SLACK_SIGNING_SECRET`。Slack公式の v0 署名方式）。不正は401
2. `url_verification`（初回チャレンジ）に応答
3. `reaction_added` かつ絵文字が `books`（📚）かつ対象チャンネルのみ処理。他は200で無視
4. Slackの3秒タイムアウト対策: 再送リクエスト（`x-slack-retry-num` ヘッダ付き）は即200で無視し、
   初回リクエスト内で同期処理する。3秒を超えてSlackが再送しても、再送側は上記で無視され、
   二重作成は pending 重複チェックでも防がれる（新規ライブラリ `waitUntil` を増やさないため）
5. `item.ts` で `nakano_escalations` を逆引き
   - 見つからない → スレッドに「この投稿は知識化の対象外です」とBotで返信して終了
6. `conversations.replies` でスレッド返信を取得（Bot自身の投稿を除く、時刻順に連結）
   - 返信ゼロ → 「先にスレッドで回答を書いてから📚を付けてください」と返信して終了
7. AI整形: 質問＋返信の生文 → 一般化した知識（タイトル・本文）。モデルは Haiku 系
   （`NAKANO_DRAFT_MODEL` で変更可）。**整形失敗時は生文のままドラフト保存**
   （担当の回答という素材を失うのが最悪。整形は諦めてよい）
8. ドラフト保存 → スレッドに「知識の文案を作りました。管理画面の【承認待ち】から
   確認してください」とBotで返信

## 7. 管理画面の変更

`AdminNakanoSection` の「知識の管理」の直前に【承認待ち ○件】を追加。

- カード表示: 元の質問／担当の返信（原文）／AI整形案（タイトル・本文は編集可）／
  Slackスレッドへのリンク／「承認して知識にする」「却下」
- 承認・却下は `window.confirm` で対象を明示（既存の流儀）。結果はトースト
- 0件のときはセクションごと非表示（画面を汚さない）

## 8. エラー処理

| 事象 | 挙動 |
|---|---|
| 署名検証失敗 | 401。ログに残す |
| ts逆引き失敗（古い投稿・手動投稿） | スレッドにBotで「対象外」と返す |
| スレッド返信ゼロ | 「先に回答を書いてから📚」と返す |
| AI整形失敗 | 生文でドラフト保存（素材を失わない） |
| 📚重複押下 | pending存在チェックで二重作成しない |
| Bot API失敗（投稿・取得） | 既存 `withNetworkRetry` の流儀でリトライ。最終失敗はログ |
| `SLACK_BOT_TOKEN` 未設定 | エスカレ通知は従来Webhookにフォールバック（段階移行） |

## 9. テスト・検証

- 自動テストなし（プロジェクト方針）。`tsc` + `build` + 実機確認
- 実機手順: テスト質問でエスカレ発生 → Bot投稿を確認 → スレッドに回答 → 📚
  → 管理画面に承認待ちが出る → 承認 → 中野くんに同じ質問をして即答を確認
- 署名検証は Slack の Request URL 検証（url_verification）が通ることで確認

## 10. 影響しないこと

- メンバーへのLINE返信は従来どおり担当の手動（③まで）
- 既存の知識67項目・FAQボタン・回数制限・費用集計には触らない
- エスカレ通知の見た目はほぼ従来どおり（送信経路のみBot化）
