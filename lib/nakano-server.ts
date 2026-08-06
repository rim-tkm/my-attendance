/**
 * 中野くんのサーバー側の共通処理。
 * ルートごとに「本人・当日のシフト・利用可否」を組み立て直すと判定がズレるので、ここに1本化する。
 *
 * 設計: docs/superpowers/specs/2026-08-06-nakano-bot-design.md §5-A
 */

import type { Member, Shift } from "@/lib/attendance";
import { getTodayJstDateString } from "@/lib/export-schedule";
import { evaluateNakanoAiAccess, readNakanoLimitsFromEnv, type NakanoAccess } from "@/lib/nakano-access";
import { loadNakanoAiAskTimesMs } from "@/lib/nakano-data";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { postSlackIncomingWebhook, resolveSlackWebhookUrl } from "@/lib/slack-webhook";

export type NakanoContext = {
  member: Member;
  shift: Shift | undefined;
  access: NakanoAccess;
};

/** 利用可否の判定に必要な最小限だけを users から読む */
type MeRow = {
  id: string;
  name: string | null;
  is_intern: boolean | null;
  is_active: boolean | null;
  login_account: string | null;
};

type ShiftRow = {
  id: string;
  user_id: string;
  date: string;
  start_planned: string | null;
  end_planned: string | null;
  start_planned2: string | null;
  end_planned2: string | null;
};

/**
 * ログイン中メンバーの中野くん利用コンテキストを組み立てる。
 * 見つからない場合は null（呼び出し側で 404）。
 */
export async function loadNakanoContext(userId: string, now: Date = new Date()): Promise<NakanoContext | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("SUPABASE_SERVICE_ROLE_KEY が未設定です");

  const todayYmd = getTodayJstDateString(now);

  const [{ data: meRow, error: meErr }, { data: shiftRows, error: shiftErr }, askTimes] = await Promise.all([
    supabase
      .from("users")
      .select("id, name, is_intern, is_active, login_account")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("shifts")
      .select("id, user_id, date, start_planned, end_planned, start_planned2, end_planned2")
      .eq("user_id", userId)
      .eq("date", todayYmd)
      .limit(1),
    loadNakanoAiAskTimesMs(userId, now),
  ]);

  if (meErr) throw new Error(meErr.message);
  if (shiftErr) throw new Error(shiftErr.message);
  if (!meRow) return null;

  const me = meRow as MeRow;
  const member: Member = {
    id: me.id,
    name: (me.name ?? "").trim(),
    loginAccount: (me.login_account ?? "").trim(),
    isActive: me.is_active !== false,
    isIntern: me.is_intern === true,
  } as Member;

  const row = ((shiftRows ?? []) as ShiftRow[])[0];
  let shift: Shift | undefined;
  if (row && row.start_planned && row.end_planned) {
    shift = {
      id: row.id,
      userId: row.user_id,
      date: row.date,
      startPlanned: row.start_planned,
      endPlanned: row.end_planned,
    };
    if (row.start_planned2 && row.end_planned2) {
      shift.startPlanned2 = row.start_planned2;
      shift.endPlanned2 = row.end_planned2;
    }
  }

  const access = evaluateNakanoAiAccess({
    member,
    shift,
    now,
    aiAskTimesMs: askTimes,
    limits: readNakanoLimitsFromEnv(),
  });

  return { member, shift, access };
}

/**
 * 通知でメンションする Slack ユーザーID。
 * 既定は中野さん・村本さん。担当が変わったら環境変数だけで差し替えられるようにしている
 * （デプロイを待たずに通知先を直せる方が、通知が誰にも届かない時間を短くできる）。
 */
const DEFAULT_NAKANO_MENTION_USER_IDS = ["U0ACA6NNJH3", "U0ACLDAR0HY"];

function buildNakanoMentionPrefix(): string {
  const raw = (process.env.SLACK_NAKANO_MENTION_USER_IDS ?? "").trim();
  const ids =
    raw === ""
      ? DEFAULT_NAKANO_MENTION_USER_IDS
      : raw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== "");
  if (ids.length === 0) return "";
  return `${ids.map((id) => `<@${id}>`).join(" ")}\n`;
}

/**
 * 担当に回す（Slack通知）。
 * 通知の失敗で会話自体を落とさない。ここで throw すると、
 * メンバーには「エラー」としか見えず、質問した事実まで失われてしまう。
 */
export async function notifyNakanoEscalation(params: {
  memberName: string;
  memberAccount: string;
  question: string;
  reason: string;
  summary: string;
}): Promise<void> {
  try {
    const url = resolveSlackWebhookUrl("nakano");
    if (!url) {
      console.warn("[nakano] escalation slack url not configured");
      return;
    }
    // 誰からの質問かが分からないと返信できない。氏名だけだと同姓や表示名の揺れで
    // 特定できないことがあるので、一意に決まるログインアカウント（メール）も必ず載せる。
    const text =
      buildNakanoMentionPrefix() +
      `🙋 中野くんが答えられない質問を受けました\n` +
      `・氏名: ${params.memberName || "（氏名不明）"}\n` +
      `・アカウント: ${params.memberAccount || "（不明）"}\n` +
      `・質問: ${params.question}\n` +
      (params.summary ? `・要約: ${params.summary}\n` : "") +
      (params.reason ? `・理由: ${params.reason}\n` : "") +
      `本人に回答をお願いします。前後のやりとりは管理画面の「中野くん」→「届いた質問」で確認できます。`;
    const r = await postSlackIncomingWebhook(url, { text });
    if (!r.ok) console.warn("[nakano] escalation slack failed:", r.error, r.detail);
  } catch (e) {
    console.warn("[nakano] escalation slack threw:", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Anthropic API の障害を管理者に知らせる。
 * メンバーには公式LINEへの導線を出すだけなので、
 * ここで通知しないと「中野くんが黙って壊れている」ことに誰も気づけない。
 */
export async function notifyNakanoOutage(detail: string): Promise<void> {
  try {
    const url = resolveSlackWebhookUrl("nakano");
    if (!url) return;
    await postSlackIncomingWebhook(url, {
      text:
        buildNakanoMentionPrefix() +
        `⚠️ 中野くんがClaudeに接続できませんでした。\n・詳細: ${detail}\nメンバーには公式LINEへの案内が出ています。`,
    });
  } catch {
    // 障害通知自体の失敗は握りつぶす（元の障害の方が重要）
  }
}
