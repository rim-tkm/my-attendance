import { NextResponse } from "next/server";
import { runNakanoKnowledgeCapture } from "@/lib/nakano-loop-run";
import { getNakanoSlackChannelId, verifySlackSignature } from "@/lib/slack-bot";

export const dynamic = "force-dynamic";
// runNakanoKnowledgeCapture 内でAI整形とSlack API数回叩くため、slack-events と同じ上限にしておく
export const maxDuration = 60;

/**
 * Slack Interactivity（block_actions）の受け口。
 * エスカレ通知に付けた「📚 知識の文案を作る」ボタンを押すと、この route が呼ばれる。
 *
 * 📚リアクションは「文字で📚を送ってしまう」誤操作が実運用で多いと判明したため追加した経路。
 * リアクション経路（app/api/webhooks/slack-events/route.ts）は残したまま、
 * どちらから来ても同じ lib/nakano-loop-run.ts の処理に合流させる。
 *
 * ボタン押下はSlack側が3秒でタイムアウト表示（「もう一度お試しください」等）を出すことがあるが、
 * 処理はそのまま続き、結果はスレッドに返るので実害はない
 * （waitUntil の新規依存を増やさない設計は slack-events route と同じ判断）。
 *
 * 設計: docs/superpowers/specs/2026-08-07-nakano-knowledge-loop-design.md §6
 */
export async function POST(req: Request) {
  const rawBody = await req.text();

  // 署名検証は slack-events と同一方式。form-encoded の rawBody に対してそのまま検証する
  // （payload= の中身だけを取り出して検証してはいけない。Slackは生ボディ全体に署名している）。
  const signingSecret = (process.env.SLACK_SIGNING_SECRET ?? "").trim();
  if (signingSecret === "") {
    console.warn("[nakano-loop] SLACK_SIGNING_SECRET が未設定です");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  const valid = verifySlackSignature({
    signingSecret,
    timestamp: req.headers.get("x-slack-request-timestamp") ?? "",
    rawBody,
    signature: req.headers.get("x-slack-signature") ?? "",
  });
  if (!valid) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const payloadRaw = new URLSearchParams(rawBody).get("payload");
  if (!payloadRaw) {
    return NextResponse.json({ ok: true });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadRaw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const actions = Array.isArray(payload.actions) ? (payload.actions as Record<string, unknown>[]) : [];
  const isTargetAction =
    payload.type === "block_actions" && actions[0]?.action_id === "nakano_make_knowledge";
  if (!isTargetAction) {
    return NextResponse.json({ ok: true });
  }

  const channelObj = (payload.channel ?? {}) as Record<string, unknown>;
  const messageObj = (payload.message ?? {}) as Record<string, unknown>;
  const channel = channelObj.id;
  const ts = messageObj.ts;
  if (typeof channel !== "string" || typeof ts !== "string") {
    return NextResponse.json({ ok: true });
  }

  // ボタンを設置しているのは中野くん専用チャンネルのみのはずだが、念のため一致チェックする
  const channelId = getNakanoSlackChannelId();
  if (channelId === undefined || channel !== channelId) {
    return NextResponse.json({ ok: true });
  }

  await runNakanoKnowledgeCapture({ channel, ts });
  return NextResponse.json({ ok: true });
}
