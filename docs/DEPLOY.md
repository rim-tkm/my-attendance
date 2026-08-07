# DEPLOY — デプロイと本番運用

> 本番反映の手順・Cron・環境変数・切り戻し。作業者は非エンジニアなので、実作業（commit/push）はAIが代行し、手順を明示する。

---

## 1. デプロイの基本

- **`main` への push = 本番デプロイ**。Vercel が GitHub 連携で自動ビルド＆デプロイする。作業ブランチは基本使わない。
- 本番URL: https://my-attendance-rho.vercel.app/
- 手順:
  ```bash
  npx tsc --noEmit && npm run build      # 事前ゲート（両方緑を確認）
  git add -A && git commit -m "変更内容" && git push origin main
  ```
- 反映確認は数分後。出ない時はブラウザキャッシュ → `Shift+再読み込み`。Vercel ダッシュボードでビルド状況を確認できる。

---

## 2. デプロイ前チェックリスト

- [ ] `npx tsc --noEmit` が通る
- [ ] `npm run build` が通る（JSX不整合はここで出る）
- [ ] 破壊的機能は少数データで挙動確認した
- [ ] スキーマ変更が要るなら、先に（またはセットで）Supabase SQL を実行する手順を用意した
- [ ] コミットメッセージに「何を・なぜ」を書いた

---

## 3. Vercel Cron（vercel.json）

現在有効な cron（UTC）:
| path | schedule (UTC) | 意味 |
|---|---|---|
| `/api/slack-daily` | `0 23 * * *` | JST 翌8:00 前後。当日の稼働予定者を通知（**土日は対象日基準でスキップ**） |
| `/api/slack-report` | `0 15 * * *` | JST 0:00。前日のチーム実績を通知（**対象日が土日ならスキップ**） |
| `/api/cron/missed-punch-start` | `*/5 * * * *` | 5分ごと。未打刻（開始・終了）アラート |

- **時差に注意**: Vercel Cron は UTC。JST = UTC+9。
- 認証は `Authorization: Bearer ${CRON_SECRET}`（`lib/cron-verify.ts`）。
- 一部の cron/webhook は過去に停止済み（`.env.example` のコメント参照。ranking / remind-unsubmitted / weekly-schedule 等）。
- 手動実行（検証）例:
  ```bash
  curl -X POST https://my-attendance-rho.vercel.app/api/slack-report \
    -H "Authorization: Bearer $CRON_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"test": true}'      # test:true で土日でも送信
  ```

---

## 4. 本番で必要な環境変数（Vercel の Project Settings → Environment Variables）

必須:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `AUTH_SECRET`（または `NEXTAUTH_SECRET`）
- **`NEXTAUTH_URL=https://<本番ドメイン>`（本番では必須。未設定だとログイン/管理者判定が壊れる）**
- `CRON_SECRET`
- `SLACK_WEBHOOK_URL`（全通知のデフォルト送信先）

任意（用途別・しきい値）: `SLACK_WEBHOOK_*_URL`, `MISSED_PUNCH_START_GRACE_MINUTES`, `KPI_MISSING_AFTER_PUNCH_MINUTES` 等。詳細は `.env.example` のコメントが最も正確。
※ `.env.local`（ローカル）と Vercel（本番）の両方に設定が要る。シークレットはコミットしない。

---

## 5. 切り戻し（ロールバック）

問題のあるデプロイを戻す方法は2つ:

1. **Vercel ダッシュボードで戻す（推奨・非エンジニア向け）**: Deployments 一覧 → 正常だった過去のデプロイ →「Promote to Production」。
2. **git revert（コードごと戻す）**:
   ```bash
   git revert <戻したいコミットのhash>   # 打ち消しコミットを作る
   git push origin main                  # 再デプロイ
   ```
   ※ `git reset --hard` での歴史書き換えは共有ブランチでは避ける。`revert` を使う。

---

## 6. 中野くん知識ループ（Slack Bot）の本番結線手順

Slackスレッド回答に📚を付けると知識文案が作られ、承認すると本番知識になる機能。コードは既にpush済みでも、以下の結線が終わるまでは**エスカレ通知が従来のWebhook投稿のまま**（知識化は無効）。

1. **コードをpush**（Vercel自動デプロイ）。
2. **Vercelに環境変数3つを設定してRedeploy**（Project Settings → Environment Variables）:
   - `SLACK_BOT_TOKEN`
   - `SLACK_SIGNING_SECRET`
   - `SLACK_NAKANO_CHANNEL_ID`
3. **Slackアプリの Event Subscriptions で Request URL を登録**:
   - Request URL: `https://my-attendance-rho.vercel.app/api/webhooks/slack-events`
   - Verified になることを確認する
   - Subscribe to bot events に `reaction_added` を追加して Save
4. **Botを対象チャンネル（`ai-中野くん-溢れた質問` 等）に招待済みであること**を確認する。
5. **Botに必要なスコープが付与されていること**を確認する: `chat:write` / `reactions:read` / `channels:history`（対象チャンネルがプライベートチャンネルなら `channels:history` の代わりに `groups:history` も必要）。**不足していると📚を押すたびに「知識化の処理に失敗しました」という障害通知がSlackに飛ぶ**（原因が分かりにくいので要注意）。

**順序の注意**: 手順②より先に③（Request URL登録）をやると、`SLACK_SIGNING_SECRET` が無い状態でURL検証を受けるため失敗する。**必ず②→③の順**で進める。

チャンネルIDの調べ方: Slackでチャンネル名を右クリック →「チャンネル詳細を表示」→ 一番下にある `C` から始まるID。

6. **Slackアプリの「Interactivity & Shortcuts」をOnにして Request URL を登録**（📚リアクションの誤操作対策として追加した「📚 知識の文案を作る」ボタン用。Event Subscriptions とは別設定）:
   - 左メニュー → Interactivity & Shortcuts → Interactivity を On
   - Request URL: `https://my-attendance-rho.vercel.app/api/webhooks/slack-interactive`
   - Save。Event Subscriptionsと違い、Onにした時点ではURL検証（`url_verification`）は走らない。ボタンを実際に1回押して動作確認するのが確実。
   - 署名検証は Event Subscriptions と同じ `SLACK_SIGNING_SECRET` を使うので、③まで終わっていれば追加の環境変数は不要。

---

## 7. Supabase（データ）関連

- スキーマ変更は Supabase 管理画面の「SQL Editor」で実行。`supabase-migration-*.sql` にファイルも残す。
- **本番データの直接変更/削除は不可逆**。必ずユーザー確認のもとで。バックアップ/復元用スクリプトは `scripts/` にある。
- メンバーの「無効化」は削除ではなく `is_active=false`（論理削除）。復元は `/admin/members/archived` から。
