"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NakanoStepNode } from "@/lib/nakano";

/** 初回の注意書きを出したかどうか。端末ごとに1回だけ出せば足りるので localStorage で持つ */
const NOTICE_SEEN_KEY = "nakano-notice-seen";

const FALLBACK_ERROR = "今つながりません。急ぎの用件は公式LINEへお願いします。";

type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  escalated: boolean;
  source: "ai" | "step";
  createdAt: string;
};

type ConversationResponse = {
  available: boolean;
  message: string | null;
  remainingHour: number;
  remainingDay: number;
  messages: ConversationMessage[];
};

/** 画面に出す吹き出し1つ。過去のやりとりも、ステップの回答も、AIの回答もこれに揃える */
type Bubble = {
  key: string;
  role: "user" | "assistant";
  content: string;
  escalated: boolean;
  /** 回答待ちの仮表示。最初の text が届いたら置き換える */
  pending: boolean;
};

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20 12a8 8 0 0 1-8 8H7l-3 2v-4.2A8 8 0 1 1 20 12Z"
      />
      <path strokeLinecap="round" d="M8.5 10.5h7M8.5 14h4.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/**
 * AIアシスタント「中野くん」のメンバー向けチャットUI。
 * インターンと管理画面表示中は親が enabled=false を渡す。
 *
 * 設計: docs/superpowers/specs/2026-08-06-nakano-bot-design.md §5-B / §7
 */
export default function NakanoBotWidget({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [noticeSeen, setNoticeSeen] = useState(true);
  /** 知識が入るまではボタンごと出さない。準備できたら自動的に現れる */
  const [ready, setReady] = useState(false);

  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [available, setAvailable] = useState(false);
  const [unavailableMessage, setUnavailableMessage] = useState<string | null>(null);
  const [remainingHour, setRemainingHour] = useState<number | null>(null);
  const [remainingDay, setRemainingDay] = useState<number | null>(null);

  const [steps, setSteps] = useState<NakanoStepNode[]>([]);
  /** 押してきたノードの連なり。末尾の children が今出すボタン */
  const [stepPath, setStepPath] = useState<NakanoStepNode[]>([]);
  /**
   * よくある質問の開閉。会話の下に固定表示し、開いてもそこだけがスクロールする。
   * 会話と同じスクロール領域に置くと、項目数が多いぶん回答が画面外へ押し上げられてしまう。
   */
  const [stepsOpen, setStepsOpen] = useState(true);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const mountedRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const keySeqRef = useRef(0);

  const nextKey = useCallback(() => {
    keySeqRef.current += 1;
    return `local-${keySeqRef.current}`;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  // マウント時に一度だけ。テーブル未作成・知識ゼロのうちは ready:false が返り、何も表示されない
  useEffect(() => {
    if (!enabled) return;
    let ignore = false;
    void (async () => {
      try {
        const res = await fetch("/api/nakano/status", { credentials: "include" });
        const data = (await res.json().catch(() => null)) as { ready?: boolean } | null;
        if (ignore || !mountedRef.current) return;
        setReady(res.ok && data?.ready === true);
      } catch {
        if (ignore || !mountedRef.current) return;
        setReady(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [enabled]);

  useEffect(() => {
    try {
      setNoticeSeen(window.localStorage.getItem(NOTICE_SEEN_KEY) === "1");
    } catch {
      // プライベートモード等で localStorage が使えない端末では毎回出す（実害がない側に倒す）
      setNoticeSeen(false);
    }
  }, []);

  // パネルを開くたびに取り直す。稼働時間帯と残り回数は時間とともに変わるため
  useEffect(() => {
    if (!enabled || !open) return;
    let ignore = false;
    void (async () => {
      try {
        const res = await fetch("/api/nakano/conversation", { credentials: "include" });
        const data = (await res.json().catch(() => null)) as ConversationResponse | null;
        if (ignore || !mountedRef.current) return;
        if (!res.ok || !data) {
          setAvailable(false);
          setUnavailableMessage(FALLBACK_ERROR);
          return;
        }
        setAvailable(data.available === true);
        setUnavailableMessage(data.message ?? null);
        setRemainingHour(typeof data.remainingHour === "number" ? data.remainingHour : null);
        setRemainingDay(typeof data.remainingDay === "number" ? data.remainingDay : null);
        const restored: Bubble[] = (Array.isArray(data.messages) ? data.messages : [])
          .filter((m) => m != null && typeof m === "object")
          .map((m) => ({
            key: `db-${m.id}`,
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content ?? "",
            escalated: m.escalated === true,
            pending: false,
          }));
        // 開き直しても、この回に増えた吹き出しが消えないよう既存の後ろには積まない
        setBubbles(restored);
      } catch {
        if (ignore || !mountedRef.current) return;
        setAvailable(false);
        setUnavailableMessage(FALLBACK_ERROR);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [enabled, open]);

  // ステップの木は全メンバー共通なので一度だけ取る。以降の遷移はサーバー往復なし
  useEffect(() => {
    if (!enabled || !open || steps.length > 0) return;
    let ignore = false;
    void (async () => {
      try {
        const res = await fetch("/api/nakano/steps", { credentials: "include" });
        const data = (await res.json().catch(() => null)) as { steps?: NakanoStepNode[] } | null;
        if (ignore || !mountedRef.current) return;
        if (!res.ok || !Array.isArray(data?.steps)) return;
        setSteps(data.steps.filter((s) => s != null && typeof s === "object"));
      } catch {
        // よくある質問が出ないだけで、自由入力は使えるので黙って諦める
      }
    })();
    return () => {
      ignore = true;
    };
  }, [enabled, open, steps.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [bubbles, open]);

  const patchBubble = useCallback((key: string, patch: Partial<Bubble>) => {
    setBubbles((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  }, []);

  const closePanel = useCallback(() => {
    // 受信中に閉じても壊れないよう、読みかけのストリームは切る
    abortRef.current?.abort();
    abortRef.current = null;
    setOpen(false);
  }, []);

  const dismissNotice = useCallback(() => {
    setNoticeSeen(true);
    try {
      window.localStorage.setItem(NOTICE_SEEN_KEY, "1");
    } catch {
      // 保存できなくても表示は消す
    }
  }, []);

  const resetSteps = useCallback(() => {
    setStepPath([]);
    setStepsOpen(true);
  }, []);

  const handleStepClick = useCallback(
    (node: NakanoStepNode) => {
      // 記録のためだけの呼び出し。失敗しても画面は何事もなく動かす
      void fetch("/api/nakano/step-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ stepId: node.id, title: node.title }),
      }).catch(() => undefined);

      // 押した項目も残す。サーバー側は質問と回答の両方を記録しているので、
      // ここで回答だけ出すと、開き直した瞬間に履歴の見え方が変わってしまう。
      setBubbles((prev) => [
        ...prev,
        {
          key: nextKey(),
          role: "user",
          content: `［よくある質問］${node.title}`,
          escalated: false,
          pending: false,
        },
        { key: nextKey(), role: "assistant", content: node.body, escalated: false, pending: false },
      ]);
      setStepPath((prev) => [...prev, node]);
    },
    [nextKey]
  );

  const handleUnresolved = useCallback(() => {
    setStepPath([]);
    setStepsOpen(false);
    // 次の操作が自由入力なのは明らかなので、そのまま打ち始められるようにする
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const handleStreamEvent = useCallback(
    (
      raw: string,
      botKey: string,
      state: { started: boolean }
    ) => {
      const line = raw.trim();
      if (!line) return;
      let event: { type?: string; text?: string; message?: string; remainingHour?: number; remainingDay?: number };
      try {
        event = JSON.parse(line);
      } catch {
        // 壊れた1行のために会話全体を落とさない
        return;
      }
      if (event.type === "text") {
        const chunk = typeof event.text === "string" ? event.text : "";
        if (!chunk) return;
        if (!state.started) {
          state.started = true;
          patchBubble(botKey, { content: chunk, pending: false });
          return;
        }
        setBubbles((prev) =>
          prev.map((b) => (b.key === botKey ? { ...b, content: b.content + chunk } : b))
        );
        return;
      }
      if (event.type === "escalated") {
        // 担当に回った時点で「返答があった」扱いにする。
        // これをしないと、本文が短くて text より先にここへ来た場合に
        // 最後のフォールバックがエラー文で上書きしてしまう。
        state.started = true;
        patchBubble(botKey, { escalated: true, pending: false });
        return;
      }
      if (event.type === "done") {
        if (typeof event.remainingHour === "number") setRemainingHour(event.remainingHour);
        if (typeof event.remainingDay === "number") setRemainingDay(event.remainingDay);
        return;
      }
      if (event.type === "error") {
        state.started = true;
        patchBubble(botKey, {
          content: typeof event.message === "string" && event.message ? event.message : FALLBACK_ERROR,
          pending: false,
        });
      }
    },
    [patchBubble]
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || !available) return;

    const botKey = nextKey();
    setBubbles((prev) => [
      ...prev,
      { key: nextKey(), role: "user", content: text, escalated: false, pending: false },
      { key: botKey, role: "assistant", content: "考えています…", escalated: false, pending: true },
    ]);
    setInput("");
    setSending(true);
    // 回答を読むのが目的なので、よくある質問は畳んで会話の表示領域を広げる
    setStepsOpen(false);

    const controller = new AbortController();
    abortRef.current = controller;
    const state = { started: false };

    try {
      const res = await fetch("/api/nakano/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (mountedRef.current) {
          patchBubble(botKey, { content: data.error || FALLBACK_ERROR, pending: false });
        }
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        if (mountedRef.current) patchBubble(botKey, { content: FALLBACK_ERROR, pending: false });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // チャンクの切れ目は行の途中にも来る。最後の不完全な行はバッファに残す
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        if (!mountedRef.current) return;
        for (const line of lines) handleStreamEvent(line, botKey, state);
      }
      buffer += decoder.decode();
      if (!mountedRef.current) return;
      for (const line of buffer.split("\n")) handleStreamEvent(line, botKey, state);

      if (!state.started) patchBubble(botKey, { content: FALLBACK_ERROR, pending: false });
    } catch {
      // 中断はユーザー自身がパネルを閉じた結果なので、エラーとして見せない
      if (!controller.signal.aborted && mountedRef.current) {
        patchBubble(botKey, { content: FALLBACK_ERROR, pending: false });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (mountedRef.current) setSending(false);
    }
  }, [available, handleStreamEvent, input, nextKey, patchBubble, sending]);

  if (!enabled || !ready) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="AIの中野くんに質問する"
        className="fixed bottom-4 left-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-slate-800 text-white shadow-lg hover:bg-slate-700 print:hidden"
      >
        <ChatIcon />
      </button>
    );
  }

  const currentNode = stepPath.length > 0 ? stepPath[stepPath.length - 1] : null;
  const options = currentNode ? currentNode.children : steps;
  const atLeaf = currentNode != null && currentNode.children.length === 0;
  const canSend = available && !sending && input.trim().length > 0;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white shadow-xl print:hidden sm:inset-auto sm:bottom-4 sm:left-4 sm:h-[40rem] sm:max-h-[85vh] sm:w-[28rem] sm:rounded-xl sm:border sm:border-slate-200">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3">
        <span className="text-sm font-semibold text-slate-900">AIの中野くん</span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">AI</span>
        <button
          type="button"
          onClick={closePanel}
          aria-label="閉じる"
          className="ml-auto rounded-lg p-1 text-slate-500 hover:bg-slate-100"
        >
          <CloseIcon />
        </button>
      </div>

      {!noticeSeen && (
        <div className="shrink-0 border-b border-slate-200 bg-amber-50 px-4 py-3">
          <p className="text-[11px] leading-relaxed text-slate-800">
            AIの中野くんです。人ではありません。間違えることもあります。報酬・契約に関することは、必ず担当に直接聞いてください。
          </p>
          <button
            type="button"
            onClick={dismissNotice}
            className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
          >
            わかりました
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {bubbles.map((b) => (
          <div key={b.key} className={b.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className="max-w-[85%]">
              <div
                className={
                  b.role === "user"
                    ? "whitespace-pre-wrap rounded-lg bg-slate-800 px-3 py-2 text-sm leading-relaxed text-white"
                    : `whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-relaxed ${
                        b.pending ? "text-slate-500" : "text-slate-800"
                      }`
                }
              >
                {b.content}
              </div>
              {b.escalated && (
                <p className="mt-1 text-[11px] text-slate-500">担当に届けました</p>
              )}
            </div>
          </div>
        ))}

      </div>

      {steps.length > 0 && (
        <div className="shrink-0 border-t border-slate-200 px-4 py-2">
          <button
            type="button"
            onClick={() => setStepsOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <span>よくある質問から探す</span>
            <span className="text-[10px] text-slate-400">{stepsOpen ? "閉じる" : "開く"}</span>
          </button>

          {stepsOpen && (
            <div className="mt-1 max-h-52 space-y-1.5 overflow-y-auto pr-1">
              {options.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => handleStepClick(node)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  {node.title}
                </button>
              ))}

              {atLeaf && (
                <div className="flex flex-col gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={resetSteps}
                    className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                  >
                    これで解決しました
                  </button>
                  <button
                    type="button"
                    onClick={handleUnresolved}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    解決しなかった・別のことを聞く
                  </button>
                </div>
              )}

              {stepPath.length > 0 && !atLeaf && (
                <button
                  type="button"
                  onClick={resetSteps}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  最初に戻る
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="shrink-0 border-t border-slate-200 px-4 py-3">
        {!available && unavailableMessage && (
          <p className="mb-2 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600">
            {unavailableMessage}
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            rows={2}
            value={input}
            disabled={!available || sending}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enterで送信・Shift+Enterで改行。変換確定のEnterで送ってしまわないよう除く
              if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
              e.preventDefault();
              void send();
            }}
            placeholder={available ? "質問を入力（Shift+Enterで改行）" : "今は質問できません"}
            className="min-h-[3rem] flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60"
          />
          <button
            type="button"
            disabled={!canSend}
            onClick={() => void send()}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "送信中…" : "送信"}
          </button>
        </div>
        {available && remainingHour != null && remainingDay != null && (
          <p className="mt-1.5 text-[10px] text-slate-500">
            残り 1時間あたり {remainingHour} 回 ／ 今日 {remainingDay} 回
          </p>
        )}
      </div>
    </div>
  );
}
