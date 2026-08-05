# お知らせ機能 設計書（2026-08-05）

## 目的

管理者が登録したお知らせを、メンバーのログイン時に必ず表示する。「必読」のお知らせは、
内容を確認・理解したメンバーだけが稼働（稼働開始・シフト提出）できるようにする。
誰がいつどのお知らせを確認したかを記録として残し、確認済みの内容は後からいつでも読み返せる。

## 決定事項（要件確認の結果）

| 項目 | 決定 |
|---|---|
| お知らせの単位 | 複数登録可。メンバーは1件ずつ個別に確認する |
| 宛先 | 全員 ／ 業務委託のみ ／ インターンのみ（既定=全員） |
| 強さ | 必読（既定）／ お知らせのみ を登録時に選択 |
| 未確認時の制限 | モーダルは閉じられる。稼働開始・シフト保存を押すと再表示してブロック |
| 確認操作 | チェックボックス → 「確認しました」ボタンの2段階 |
| 見返し | メンバー画面に「お知らせ」タブを追加（4つ目）。未確認があれば赤い印 |
| 再確認 | 本文編集時に「再確認してもらう」チェック（既定ON）。ONなら全員が未確認に戻る |
| 管理者側 | 管理設定に「お知らせ」カード。作成・編集・公開終了・確認状況の表示 |

## データモデル

新規テーブル2つ。`supabase-migration-announcements.sql` として追加し、Supabase SQL Editor で実行する。

```sql
CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT 'all' CHECK (target IN ('all', 'contractor', 'intern')),
  is_required BOOLEAN NOT NULL DEFAULT true,
  is_published BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_announcements_published
  ON public.announcements(is_published, created_at DESC);

CREATE TABLE IF NOT EXISTS public.announcement_reads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, user_id, version)
);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_user
  ON public.announcement_reads(user_id);

-- RLS は有効化するがポリシーを作らない = 公開 anon キーからは一切アクセス不可。
-- サーバー（service_role）経由のみ。users の RLS 締め（2026-08-05）と同じ方針。
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;
```

### 版数（version）の役割

本文を修正したとき、既に確認したメンバーにもう一度確認してもらうための仕組み。

- 確認記録は `(announcement_id, user_id, version)` の3点で一意
- お知らせの現在の `version` に対する確認記録が無ければ「未確認」
- 編集時に「再確認してもらう」を ON にすると `version` が +1 され、全員が未確認に戻る
- 誤字修正など再確認が不要なときは OFF にすれば `version` は据え置き

### 公開終了（is_published=false）の扱い

- 未確認判定の対象から外れる（ブロックしない）
- メンバーの「お知らせ」タブには「終了」ラベル付きで残り、引き続き読み返せる
- 確認記録は削除しない

## ロジック（`lib/announcements.ts`）

DB アクセスを含まない純粋関数のみ。テストスクリプトから直接呼べるようにする。

```ts
export type AnnouncementTarget = "all" | "contractor" | "intern";

export type Announcement = {
  id: string;
  title: string;
  body: string;
  target: AnnouncementTarget;
  isRequired: boolean;
  isPublished: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** 現在の version に対する本人の確認日時。未確認は null */
  readAt: string | null;
};
```

| 関数 | 役割 |
|---|---|
| `isAnnouncementTargetedAt(a, member)` | 宛先判定。`all`=全員、`contractor`=`isIntern !== true`、`intern`=`isIntern === true`。管理者アカウント（`loginAccount === "admin"`）と無効化メンバー（`isActive === false`）は常に対象外 |
| `isAnnouncementUnread(a)` | `a.readAt == null` |
| `selectUnreadForModal(list)` | モーダルに出す未確認＝`isPublished && readAt == null`（必読・お知らせのみの両方）。**古い順**に返す（出した順に読ませる） |
| `selectBlockingAnnouncements(list)` | 稼働をブロックする対象＝`selectUnreadForModal` の結果のうち `isRequired` のもの。同じく古い順 |
| `sortAnnouncementsNewestFirst(list)` | お知らせタブの表示順 |

## API（すべて認証必須・service_role で DB アクセス）

### メンバー向け

**`GET /api/member/announcements`**
セッション本人が対象のお知らせを、公開中・終了を問わず新しい順で返す。

```
→ { ok: true, announcements: Announcement[] }
```

**`POST /api/member/announcements/read`**

```
← { announcementId: string, version: number }
→ { ok: true }
```

- 本人が対象かをサーバー側で再確認（対象外なら 403）
- 送られた `version` が現在の `version` と一致しない場合は 409（編集直後の競合。クライアントは再取得する）
- 一意制約違反（二重送信）はエラーにせず成功として扱う

### 管理者向け（`loginId === "admin"` のみ）

**`GET /api/admin/announcements`**
全お知らせに確認状況を添えて返す。

```
→ { ok: true, announcements: (Announcement & {
      targetCount: number;            // 対象の有効メンバー数（管理者アカウント・無効化メンバーを除く）
      confirmedCount: number;         // 現 version を確認済みの人数
      unconfirmedMembers: { id: string; name: string }[];
    })[] }
```

**`POST /api/admin/announcements`** — 新規作成

```
← { title, body, target, isRequired }
→ { ok: true, id }
```

**`POST /api/admin/announcements/[id]`** — 編集・公開終了

```
← { title?, body?, target?, isRequired?, isPublished?, requireReconfirm?: boolean }
→ { ok: true, version: number }
```

`requireReconfirm === true` のとき `version` を +1 する。`updated_at` は常に更新。
削除 API は用意しない（公開終了で足りるため）。

## 画面

### メンバー: お知らせモーダル（`app/components/AnnouncementGateModal.tsx`）

ログイン直後、ブロック対象のお知らせを**古い順に1件ずつ**全画面表示する。

- タイトル・本文（改行を保持したプレーンテキスト）・「必読」バッジ
- 「上記の内容を確認し理解しました」チェックボックス → チェックすると「確認しました」ボタンが有効化
- 確認すると次の未確認へ。すべて確認したらモーダルを閉じる
- 「あとで読む」で閉じられる。閉じた後に稼働開始・シフト保存を押すと、
  ブロック対象（必読・未確認）の**先頭の1件**から再び表示する
- 「お知らせのみ」のものは同じモーダルで表示するが、閉じれば稼働できる。
  確認するまでは次回ログイン時にも表示される

**表示の優先順位**（同時に重ねない）:
`押し忘れロック` → `お知らせ` → `月次の登録情報確認`

### メンバー: お知らせタブ（`app/components/AnnouncementsTab.tsx`）

`Tab` 型に `"announcements"` を追加し、4つ目のタブとして表示する。

- 自分が対象のお知らせを新しい順に一覧（公開中・終了の両方）
- 各行に「未確認」赤バッジ ／ 「確認済み（日時）」／ 「終了」ラベル
- 本文はその場で開閉。未確認の必読はここからも同じ2段階操作で確認できる
- 未確認が1件以上あるとき、タブ見出しに赤い印を出す

### 管理者: お知らせカード（`app/components/AdminAnnouncementsCard.tsx`）

管理設定内に「会社休業日」カードと同じ体裁で配置する。

- **新規作成**: タイトル・本文・宛先（プルダウン）・必読/お知らせのみ（ラジオ）
- **一覧**: 新しい順。各行に確認状況「確認済み 32/45名」、未確認者名の折りたたみ
- **編集**: 本文等を修正。「この変更をメンバーに再確認してもらう」チェック（既定ON）
- **公開終了**: 確認ダイアログのうえで `is_published=false`

## エラー処理

| 状況 | 挙動 | 理由 |
|---|---|---|
| お知らせ取得に失敗 | **稼働をブロックしない**（fail-open）。画面には出さない | 一時的な通信障害で全員の稼働が止まる損害の方が大きい |
| 確認の記録に失敗 | モーダルを閉じず、エラーを表示して再試行を促す | 確認したのに記録が残らない事故を防ぐ |
| 版の競合（409） | 一覧を再取得して最新の本文を表示し直す | 編集直後に古い本文へ確認が入るのを防ぐ |
| SQL 未実行 | 取得が失敗し fail-open で従来どおり稼働できる | 段階的リリースの安全性 |

## 検証

- `npx tsc --noEmit` と `npm run build`（必須）
- `lib/announcements.ts` のロジックを scratchpad のスクリプトで検証:
  宛先判定（全員/業務委託/インターン・管理者除外・無効化除外）、未確認判定、
  版が上がったときに確認済みが未確認へ戻ること、ブロック対象の並び順
- 手動確認: 管理設定でお知らせ作成 → メンバーでログイン → モーダル表示 → 確認 →
  稼働開始できる → お知らせタブで読み返せる → 本文編集（再確認ON）で再び未確認になる

## 段階的リリース

1. SQL 実行（`supabase-migration-announcements.sql`）
2. コード反映（main へ push）
3. 管理設定からテスト用のお知らせを1件作成し、実挙動を確認
4. 問題なければ本番のお知らせを登録

SQL 未実行の状態でコードが先に反映されても、fail-open のため既存の稼働フローには影響しない。

## 対象外（今回はやらない）

- 掲載期間の日付指定（公開終了のトグルで足りる）
- リッチテキスト・画像添付（プレーンテキストのみ）
- メンバー個別指定の宛先（区分指定で足りる）
- お知らせの削除（公開終了で足りる）
- Slack への同時通知
