# TROUBLESHOOTING — 症状 → 原因 → 対処

> 実際に踏んだ/踏みやすい問題の対処集。新しく解決した問題は末尾に追記すること。

---

## ビルド / 型エラー

### `Type 'Set<string>' can only be iterated ... downlevelIteration`
- **原因**: `[...someSet]`（Setのスプレッド）が tsconfig の設定で不可。
- **対処**: `Array.from(someSet)` を使う。`for...of` も同様に避け、`.forEach` か `Array.from`。

### `npm run build` が JSX で落ちる（Unexpected token / tag 不整合）
- **原因**: `app/page.tsx` の巨大JSXで open/close タグの対応がずれた（`<div>` を足したのに閉じ忘れ等）。
- **対処**: 変更箇所の前後で開閉タグを数える。`{cond && ( ... )}` や `<>...</>` の対応を確認。`npx tsc --noEmit` はJSX不整合を必ずしも出さないので **`npm run build` まで通す**。

### 「率が 0.50 のように末尾ゼロだけになる／2桁精度が出ない」
- **原因**: `safeRatePercent` は小数第1位で丸めて返す。`.toFixed(2)` しても桁が増えるだけ。
- **対処**: `ratePercent2`（丸めない）で計算し直す。`docs/DECISIONS.md ADR-007`。

---

## 実行時 / データ

### 画面にデータが出ない / 「Supabase の設定を確認」
- **原因**: `.env.local` の `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` 未設定 or 誤り。
- **対処**: `.env.local` を確認。Supabase プロジェクト設定からURL/anon keyを取得。`npm run dev` を再起動。

### アプリが重い / 起動が遅い
- **原因**: attendance/shifts/kpis を全履歴ロードしている（データ増で悪化）。
- **対処**: 短期は「初回二重ロード解消・SELECT列限定」(実施済)。根本はフェーズ2-A（表示ロードの期間制限）。`PROJECT_HANDOVER.md §7`。**取得範囲を狭める時は請求/CSV/予実乖離/カスタム集計が壊れないか必ず確認**。

### 新規メンバーが「休眠」に出てしまう
- **原因/仕様**: 登録日が無いため、打刻ゼロの新人は「未稼働」に分類される（休眠ではない）。休眠は「過去に打刻歴あり」のみ。
- **対処**: 想定どおりの挙動。未稼働は管理番号降順（新しい登録が上）で表示。`docs/DECISIONS.md ADR-004`。

### 土日にSlackの結果通知が来る
- **原因**: `slack-report` に土日スキップが無かった（→対応済み。対象日が土日ならスキップ）。
- **確認**: `lib/slack-report.ts` の `isWeekendYmd(dateStr)` ガード。手動検証は POST `{ "test": true }`。

### 稼働記録の保存が 403 / 拒否される
- **原因**: 土日（JST）の稼働記録は拒否される仕様（`isWeekendYmdJst`）。または連続稼働の上限超過。
- **対処**: 仕様。テスト時は該当ガードのバイパスオプション（`bypassPunchTimeRestrictions` 等）を確認。

---

## 請求書PDF

### PDFの日本語が文字化けする / 文字が欠ける
- **原因**: フォント埋め込み不足、または範囲区切りに非ASCIIハイフンを使用。
- **対処**: サーバー生成経路（フルフォント埋め込み）を使う。区切りはASCIIハイフン。`lib/invoice-pdf-pdflib.ts` / `pdf-fonts/`。

### 契約書PDFに「タブ1」が混入・余白ページが出る
- **原因**: Googleドキュメントのタブ機能を使った（GAS側テンプレ）。
- **対処**: タブ機能を使わない。テンプレIDは固定運用。`PROJECT_HANDOVER.md §8 地雷③`。

### PDFのレイアウトが崩れた
- **原因**: pdf-lib のY座標直書き＋条件付き行push を、前後の計算を確認せず変更した。
- **対処**: 変更箇所の前後のY座標計算を追う。1行の増減が後続すべてに影響する。

---

## Git / 認証 / デプロイ

### `git push` が 403（Permission denied to <別アカウント>）
- **原因**: `gh` のアクティブアカウントが権限の無いアカウントに切り替わっている（osxkeychain のトークンが別人）。
- **対処**:
  ```bash
  gh auth status                 # rim-tkm がアクティブか確認
  gh auth login                  # rim-tkm でログイン（web browser）
  gh auth setup-git              # git credential helper を gh に設定
  git push origin main
  ```
  gh のパスは `/Users/takuma/.local/bin/gh`（PATHに無いことがある）。

### `fatal: not a git repository`
- **原因**: リポジトリ外（ホーム等）でgitコマンドを実行した。
- **対処**: `cd /Users/takuma/Desktop/my-attendance` してから実行。

### 本番に反映されない
- **原因**: push はしたがVercelビルド中／ブラウザキャッシュ。
- **対処**: 数分待つ。`Shift+再読み込み`（スーパーリロード）。Vercel のデプロイ状況も確認。

### `command not found: 【ターミナルにコピペしてエンター】`
- **原因**: 手順書の見出しをそのまま貼った（作業者は非エンジニア）。
- **対処/予防**: コマンドを渡す時は、見出しラベルと実コマンドを明確に分け、コマンドだけをコードブロックにする。

---

<!-- 新しい解決策は上のカテゴリに追記してください -->
