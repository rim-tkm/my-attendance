import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-verify";
import { syncAllMembersToFreee } from "@/lib/freee-partner-sync";
import { postSlackIncomingWebhook, resolveSlackWebhookUrl } from "@/lib/slack-webhook";

/**
 * freee 取引先の毎日自動同期（Vercel Cron）。
 * メンバーが振込先・住所などを変更しても、翌朝には freee の取引先へ自動反映される。
 * - 認証: `Authorization: Bearer ${CRON_SECRET}`
 * - Cron: vercel.json で毎日 20:30 UTC（= 日本時間 翌朝 5:30）
 * - freee 未接続・エラーがあった日は Slack（SLACK_WEBHOOK_URL）に通知して管理者が気付けるようにする
 *   （成功時は通知しない。手動確認は管理設定の「取引先をfreeeへ同期」でいつでも可能）
 */
export async function GET(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;

  const result = await syncAllMembersToFreee();

  const notifySlack = async (text: string) => {
    const url = resolveSlackWebhookUrl("daily");
    if (!url) return;
    await postSlackIncomingWebhook(url, { text });
  };

  if (!result.ok) {
    await notifySlack(
      `⚠️ freee取引先の自動同期に失敗しました: ${result.error}\n管理画面の「管理設定 → freee連携」を確認してください。`
    );
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  if (result.errors.length > 0) {
    const lines = result.errors.map((e) => `・${e.name}: ${e.detail ?? "エラー"}`).join("\n");
    await notifySlack(
      `⚠️ freee取引先の自動同期で ${result.errors.length} 名がエラーになりました（登録 ${result.created} 名 / 更新 ${result.updated} 名は成功）。\n${lines}`
    );
  }

  return NextResponse.json({
    ok: true,
    companyName: result.companyName,
    created: result.created,
    updated: result.updated,
    errorCount: result.errors.length,
    errors: result.errors,
  });
}
