import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-verify";
import {
  estimateNakanoYen,
  nakanoCacheHitRate,
  readNakanoDailyYenAlert,
  readNakanoPricing,
} from "@/lib/nakano-cost";
import { loadNakanoDailyUsage } from "@/lib/nakano-data";
import { postSlackIncomingWebhook, resolveSlackWebhookUrl } from "@/lib/slack-webhook";

/**
 * 中野くんのAPI費用の見張り（Vercel Cron）。
 *
 * 「1日◯円までは今のモデル、超えたら下位モデルを試す」という運用ルールを、
 * 毎日画面を見に行かなくても回せるようにするための通知。
 * - 認証: `Authorization: Bearer ${CRON_SECRET}`
 * - Cron: vercel.json で毎日 12:00 UTC（= 日本時間 21:00）
 * - しきい値以下の日は通知しない（毎日鳴ると読まなくなる）
 */
export async function GET(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;

  const limitYen = readNakanoDailyYenAlert();

  try {
    const pricing = readNakanoPricing();
    const daily = await loadNakanoDailyUsage(2);
    const today = daily[0];
    if (!today) return NextResponse.json({ ok: true, skipped: "no_data" });

    const yen = Math.round(estimateNakanoYen(today, pricing));
    if (yen <= limitYen) {
      return NextResponse.json({ ok: true, date: today.date, yen, limitYen, notified: false });
    }

    const hit = nakanoCacheHitRate(today);
    const perQuestion =
      today.aiQuestionCount > 0 ? Math.round((yen / today.aiQuestionCount) * 10) / 10 : 0;

    // キャッシュが効いていない日は、モデルを下げるより先に見るべき原因が別にある。
    // 通知を見た人がどちらに動けばよいか判断できるよう、一言添える。
    const advice =
      hit != null && hit < 0.8
        ? "キャッシュがあまり効いていません。質問が少なく間隔が空いた日は割高になります。件数が少ないだけなら様子見で大丈夫です。"
        : "キャッシュは効いています。この単価のまま件数が増えると比例して増えます。モデルを下げる検討時期です。";

    const url = resolveSlackWebhookUrl("nakano");
    if (url) {
      await postSlackIncomingWebhook(url, {
        text:
          `💰 AIの中野くんの1日の費用が ${limitYen.toLocaleString("ja-JP")}円 を超えました\n` +
          `・対象日: ${today.date}\n` +
          `・概算費用: 約 ${yen.toLocaleString("ja-JP")}円\n` +
          `・AIへの質問: ${today.aiQuestionCount}件（1問あたり約 ${perQuestion}円）\n` +
          `・よくある質問のボタン: ${today.stepUseCount}件（こちらは費用ゼロ）\n` +
          `・キャッシュが効いた割合: ${hit == null ? "—" : `${Math.round(hit * 1000) / 10}%`}\n` +
          `${advice}\n` +
          `詳細は管理画面の「AIの中野くん」→「今月の使用状況」で確認できます。`,
      });
    }

    return NextResponse.json({ ok: true, date: today.date, yen, limitYen, notified: url != null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 見張り自体が黙って壊れると「安全だから鳴らない」と区別が付かないので通知する。
    const url = resolveSlackWebhookUrl("nakano");
    if (url) {
      await postSlackIncomingWebhook(url, {
        text: `⚠️ AIの中野くんの費用チェックが失敗しました: ${msg}`,
      });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
