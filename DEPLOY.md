# Vercel への本公開手順

このドキュメントでは、稼働管理アプリを Vercel にデプロイして本公開する手順を説明します。

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
git commit -m "Initial commit: 稼働管理アプリ"
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

## 4. デプロイ完了後

- 数分でビルドが終わり、**本公開用のURL**（例: `https://my-attendance-xxxx.vercel.app`）が発行されます。
- このURLを共有すれば、誰でもアプリにアクセスできます。
- **注意**: データはブラウザの localStorage に保存されるため、**端末・ブラウザごと**に別のデータになります。チームで使う場合は「このURLで打刻・シフト・KPIを入力してください」と案内し、管理者は「管理者モード」で一覧を確認する運用になります。

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
