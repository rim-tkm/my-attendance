import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-verify";

/**
 * @deprecated KPI 未入力（終了打刻後）の定期 Cron は廃止しました。
 * 判定は「終了打刻から猶予分後の setTimeout」と「KPI タブ表示・KPI 保存時」のサーバーアクションで行います。
 * 手動確認用に 200 を返すだけです（Slack は送りません）。
 */
export async function GET(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;
  return NextResponse.json({
    ok: true,
    deprecated: true,
    message:
      "この Cron エンドポイントは無効化されています。Vercel の crons から /api/cron/kpi-missing-after-punch を削除してください。通知はアプリ内の終了打刻後タイマーおよび KPI タブ表示で実行されます。",
  });
}

export async function POST(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;
  return NextResponse.json({
    ok: true,
    deprecated: true,
    message:
      "この Cron エンドポイントは無効化されています。通知はアプリ内トリガーのみで実行されます。",
  });
}
