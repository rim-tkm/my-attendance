# COMMANDS — コマンド早見表

> 日常でよく使うコマンド集。作業者は非エンジニアなので、コマンドを渡すときは**コードブロックにコマンドだけ**を入れ、見出しと混ぜない。

## 開発 / 検証（必須ゲート）
```bash
npm run dev            # ローカル開発サーバー（http://localhost:3000）
npx tsc --noEmit       # 型チェック（push前に必須）
npm run build          # 本番ビルド。JSX不整合もここで落ちる（push前に必須）
npm run lint           # Lint（任意 / next lint）
```

## 本番反映（= Vercel 自動デプロイ）
```bash
git add -A && git commit -m "変更内容の説明" && git push origin main
```

## Git 状態確認
```bash
git status --short           # 変更ファイル
git log --oneline -10        # 直近履歴
git log origin/main..HEAD --oneline   # 未pushコミット
git diff                     # 未ステージの差分
git restore <file>           # 変更を破棄（慎重に）
```

## Git 認証復旧（push が 403 のとき）
```bash
gh auth status               # rim-tkm がアクティブか
gh auth login                # rim-tkm でログイン（GitHub.com / HTTPS / web browser）
gh auth setup-git            # credential helper を gh に設定
git push origin main
```
※ gh のパス: `/Users/takuma/.local/bin/gh`（PATHに無いことがある）

## Supabase スキーマ変更（管理画面 SQL Editor で実行してもらう）
例:
```sql
-- 列追加
ALTER TABLE users ADD COLUMN new_col TEXT DEFAULT '';
-- 既存データの確認（件数など）※本番のため実行はユーザー許可のもとで
SELECT count(*) FROM attendance;
```
手順: https://supabase.com → 対象プロジェクト → 左メニュー「SQL Editor」→ 貼付 →「Run」。
マイグレーションは `supabase-migration-*.sql` に倣ってファイルも残す。

## コード調査（把握を速くする）
```bash
grep -n "type AdminSection" app/page.tsx        # 管理画面の全セクション
grep -n "navItems" app/page.tsx                 # サイドバーのメニュー定義
grep -rn "loadRecords\|saveRecords" lib/         # データ経路
wc -l app/page.tsx                               # 規模感
```
