import type { Member } from "@/lib/attendance";
import { bankByCode, branchByCode } from "@/lib/bank-master";

/**
 * freee の「取引先マスタインポートフォーマット」CSV を生成する（サーバー側のみ。bank-master 経由で全銀マスタを参照）。
 * 列構成・表記はユーザー提供のテンプレートに合わせる:
 * - 銀行番号・支店番号は先頭ゼロなし（例: 0036 → 36、006 → 6）
 * - 銀行名（カナ）・支店名（カナ）は半角カナ・種別語なし（例: ﾗｸﾃﾝ / ﾁｴﾛ）
 * - 支店名は「〇〇支店」表記（営業部・出張所・本店などはそのまま）
 * - 支払条件は全メンバー共通の運用値（末日締め・翌月15日払い・当方負担・GMOあおぞらネット銀行）
 */

export const FREEE_PARTNERS_CSV_HEADERS = [
  "名前（通称）",
  "事業所種別",
  "地域",
  "郵便番号",
  "都道府県",
  "市区町村・番地",
  "建物名・部屋番号など",
  "使用停止・使用再開",
  "銀行名",
  "銀行名（カナ）",
  "銀行番号",
  "支店名",
  "支店名（カナ）",
  "支店番号",
  "口座種別",
  "口座番号",
  "受取人名",
  "受取人名（カナ）",
  "締め日(支払期日設定)",
  "支払月(支払期日設定)",
  "支払日(支払期日設定)",
  "振込手数料負担区分(支払)",
  "支払元口座",
  "適格請求書発行事業者（該当する/該当しない）",
  "適格請求書発行事業者の登録番号",
] as const;

/** 全角カタカナ→半角カナ（濁点・半濁点は分解。freee テンプレートの表記に合わせる） */
export function toHalfWidthKana(full: string): string {
  const map: Record<string, string> = {
    ガ: "ｶﾞ", ギ: "ｷﾞ", グ: "ｸﾞ", ゲ: "ｹﾞ", ゴ: "ｺﾞ",
    ザ: "ｻﾞ", ジ: "ｼﾞ", ズ: "ｽﾞ", ゼ: "ｾﾞ", ゾ: "ｿﾞ",
    ダ: "ﾀﾞ", ヂ: "ﾁﾞ", ヅ: "ﾂﾞ", デ: "ﾃﾞ", ド: "ﾄﾞ",
    バ: "ﾊﾞ", ビ: "ﾋﾞ", ブ: "ﾌﾞ", ベ: "ﾍﾞ", ボ: "ﾎﾞ",
    パ: "ﾊﾟ", ピ: "ﾋﾟ", プ: "ﾌﾟ", ペ: "ﾍﾟ", ポ: "ﾎﾟ", ヴ: "ｳﾞ",
    ア: "ｱ", イ: "ｲ", ウ: "ｳ", エ: "ｴ", オ: "ｵ",
    カ: "ｶ", キ: "ｷ", ク: "ｸ", ケ: "ｹ", コ: "ｺ",
    サ: "ｻ", シ: "ｼ", ス: "ｽ", セ: "ｾ", ソ: "ｿ",
    タ: "ﾀ", チ: "ﾁ", ツ: "ﾂ", テ: "ﾃ", ト: "ﾄ",
    ナ: "ﾅ", ニ: "ﾆ", ヌ: "ﾇ", ネ: "ﾈ", ノ: "ﾉ",
    ハ: "ﾊ", ヒ: "ﾋ", フ: "ﾌ", ヘ: "ﾍ", ホ: "ﾎ",
    マ: "ﾏ", ミ: "ﾐ", ム: "ﾑ", メ: "ﾒ", モ: "ﾓ",
    ヤ: "ﾔ", ユ: "ﾕ", ヨ: "ﾖ",
    ラ: "ﾗ", リ: "ﾘ", ル: "ﾙ", レ: "ﾚ", ロ: "ﾛ",
    ワ: "ﾜ", ヲ: "ｦ", ン: "ﾝ",
    ァ: "ｧ", ィ: "ｨ", ゥ: "ｩ", ェ: "ｪ", ォ: "ｫ",
    ッ: "ｯ", ャ: "ｬ", ュ: "ｭ", ョ: "ｮ",
    ー: "ｰ", "－": "ｰ", "　": " ", "・": "･",
  };
  let out = "";
  for (const ch of full) out += map[ch] ?? ch;
  return out;
}

/** 都道府県と残りに分割（分割できない住所は都道府県を空にして全体を市区町村・番地へ） */
export function splitJpAddress(address: string): { prefecture: string; rest: string } {
  const m = /^(北海道|東京都|京都府|大阪府|.{2,3}県)(.*)$/.exec(address.trim());
  if (!m) return { prefecture: "", rest: address.trim() };
  return { prefecture: m[1], rest: m[2].trim() };
}

/** 支店名を freee 表記に（末尾が支店・営業部・出張所・本店・支所以外なら「支店」を付ける） */
export function branchNameForFreee(branchName: string): string {
  const t = branchName.trim();
  if (t === "") return "";
  return /(支店|営業部|出張所|本店|支所)$/.test(t) ? t : `${t}支店`;
}

/** コード文字列の先頭ゼロを除去（freee テンプレートは 0036 → 36 表記） */
function stripLeadingZeros(code: string): string {
  const t = code.trim();
  if (t === "") return "";
  const n = t.replace(/^0+/, "");
  return n === "" ? "0" : n;
}

function csvEscape(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 対象メンバー（有効・管理者以外）を freee 取引先インポート CSV の本文にする（BOM なし・UTF-8 文字列） */
export function buildFreeePartnersCsv(members: Member[]): string {
  const rows: string[][] = [FREEE_PARTNERS_CSV_HEADERS.slice() as unknown as string[]];
  const targets = members.filter(
    (m) => m.isActive !== false && (m.loginAccount ?? "").trim().toLowerCase() !== "admin"
  );
  for (const m of targets) {
    const { prefecture, rest } = splitJpAddress(m.address ?? "");
    const bankCode = (m.bankCode ?? "").trim();
    const branchCode = (m.branchCode ?? "").trim();
    const bankMaster = bankCode !== "" ? bankByCode(bankCode) : null;
    const branchMaster = bankCode !== "" && branchCode !== "" ? branchByCode(bankCode, branchCode) : null;
    const invReg = (m.invoiceRegistrationNumber ?? "").trim();
    rows.push([
      m.name,
      "個人事業主",
      "国内",
      (m.postalCode ?? "").trim(),
      prefecture,
      rest,
      "", // 建物名は住所から機械分割できないため空（freee 側では市区町村・番地に含めて問題ない）
      "使用する",
      (m.bankName ?? "").trim(),
      bankMaster ? toHalfWidthKana(bankMaster.kana) : "",
      stripLeadingZeros(bankCode),
      branchNameForFreee(m.branchName ?? ""),
      branchMaster ? toHalfWidthKana(branchMaster.kana) : "",
      stripLeadingZeros(branchCode),
      (m.accountType ?? "普通").trim() || "普通",
      (m.accountNumber ?? "").trim(),
      m.name,
      (m.accountHolder ?? "").trim() || (m.furigana ?? "").trim(),
      "末日",
      "1",
      "15",
      "当方",
      "GMOあおぞらネット銀行",
      invReg !== "" ? "該当する" : "該当しない",
      invReg,
    ]);
  }
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}
