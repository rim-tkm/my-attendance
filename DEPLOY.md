# Vercel への本公開手順

このドキュメントでは、業務進捗・活動報告アプリを Vercel にデプロイして本公開する手順を説明します。

## 前提

- **Git** がインストールされていること
- **GitHub** アカウント
- **Vercel** アカウント（[vercel.com](https://vercel.com) で無料登録）

---

## 1. プロジェクトを GitHub にプッシュする

### 1-1. リポジトリを初期化（まだの場合）

```bash
cd /Users/takuma/Desktop/my-attendance
git init
```

### 1-2. .gitignore を確認

`.gitignore` に以下が含まれていることを確認してください（Next.js のテンプレートで入っていることが多いです）。

```
.next
node_modules
.env*.local
```

### 1-3. コミットして GitHub にプッシュ

1. GitHub で新しいリポジトリを作成（例: `my-attendance`）
2. ローカルで以下を実行:

```bash
git add .
git commit -m "Initial commit: 業務進捗・活動報告"
git branch -M main
git remote add origin https://github.com/<あなたのユーザー名>/my-attendance.git
git push -u origin main
```

`<あなたのユーザー名>` は実際の GitHub ユーザー名に置き換えてください。

---

## 2. Vercel にプロジェクトをインポート

1. [vercel.com](https://vercel.com) にログイン
2. **「Add New…」→「Project」** をクリック
3. **「Import Git Repository」** で GitHub を選び、`my-attendance` リポジトリを選択
4. **「Import」** をクリック

---

## 3. ビルド設定（そのままでOK）

Vercel が Next.js を自動検出します。次の設定で問題ありません。

| 項目 | 値 |
|------|-----|
| Framework Preset | Next.js |
| Build Command | `npm run build` または `next build` |
| Output Directory | （空のまま） |
| Install Command | `npm install` |

**「Deploy」** をクリックしてデプロイを開始します。

---

## 3-2. Supabase を使う場合：環境変数を設定する

データを Supabase に保存している場合、**Vercel 上でも同じ環境変数**を設定する必要があります。`.env.local` は Git に含まれないため、デプロイ先には反映されません。

1. Vercel のプロジェクト画面を開く（例: `my-attendance-rho`）
2. 上部の **「Settings」** をクリック
3. 左メニューから **「Environment Variables」** を選択
4. 次の2つを追加する（値はローカルの `.env.local` と同じもの）:

   | Name | Value |
   |------|--------|
   | `NEXT_PUBLIC_SUPABASE_URL` | あなたの Supabase プロジェクトの URL（例: `https://xxxxx.supabase.co`） |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | あなたの Supabase の anon（公開）キー |

5. **「Save」** をクリック
6. **「Deployments」** タブに戻り、最新のデプロイの **「⋯」→「Redeploy」** で再デプロイする（環境変数を反映させるため）

再デプロイが完了すると、本番URL（例: `https://my-attendance-rho.vercel.app`）で Supabase に接続できるようになります。

---

## 3-3. Slack 毎朝通知（Cron）を使う場合

プロジェクトルートの `vercel.json` で、次の Cron が設定されています。

| パス | スケジュール | 内容 |
|------|----------------|------|
| `/api/slack-daily` | `0 0 * * *`（UTC 0:00） | 日本時間 **9:00**・当日稼働予定の Slack 通知 |
| `/api/slack-report` | `0 15 * * *`（UTC 15:00） | 日本時間 **0:00**・**前日**実績の Slack 通知 |

1. Vercel の **Environment Variables** に次を追加（`.env.local` と同じ値に揃える）:

   | Name | 説明 |
   |------|------|
   | `SLACK_WEBHOOK_URL` | Slack Incoming Webhook の URL |
   | `CRON_SECRET` | 長いランダム文字列（例: `openssl rand -hex 32` で生成） |

2. **重要**: Vercel に `CRON_SECRET` を設定すると、Cron からのリクエストに自動で  
   `Authorization: Bearer <CRON_SECRET>` が付きます。ローカルの `.env.local` の `CRON_SECRET` と **完全一致**させてください。

3. 再デプロイ後、手動確認例:

   ```bash
   curl -H "Authorization: Bearer <CRON_SECRETの値>" "https://<あなたの本番URL>/api/slack-daily"
   curl -H "Authorization: Bearer <CRON_SECRETの値>" "https://<あなたの本番URL>/api/slack-report"
   ```

---

## 4. デプロイ完了後

- 数分でビルドが終わり、**本公開用のURL**（例: `https://my-attendance-xxxx.vercel.app`）が発行されます。
- このURLを共有すれば、誰でもアプリにアクセスできます。
- **Supabase 利用時**: 上記「3-2. 環境変数を設定する」で `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` を設定し、再デプロイすれば、本番でも同じ Supabase に接続され、全員が同じデータを参照できます。

---

## 5. 修正を反映する（公開後の更新）

コードを直したら、GitHub にプッシュするだけで Vercel が自動で再デプロイします。

```bash
git add .
git commit -m "〇〇を修正"
git push origin main
```

Vercel のダッシュボードで「Deployments」からビルド状況を確認できます。

---

## 6. オプション: 独自ドメインを使う

1. Vercel のプロジェクト画面で **「Settings」→「Domains」**
2. 取得済みのドメイン（例: `kado.example.com`）を追加し、表示されるDNS設定（CNAME など）をドメイン側で設定
3. 反映後、そのドメインでアプリにアクセスできます

---

## トラブルシューティング

### ビルドが失敗する場合

ローカルで以下を実行し、エラーが出ないか確認してください。

```bash
npm install
npm run build
```

エラーが出たら、表示されたメッセージに従ってコードを修正してから再度 `git push` してください。

### 環境変数が必要な場合

現在のアプリは環境変数なしで動作します。将来、APIキーなどを追加した場合は、Vercel の **「Settings」→「Environment Variables」** で設定できます。
