import type { Member } from "@/lib/attendance";
import {
  bankByCode,
  bankMasterDisplayName,
  branchByCode,
  matchBankByName,
  matchBranchByName,
} from "@/lib/bank-master";
import postalPrefecture from "@/lib/postal-prefecture.json";

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

/** JIS都道府県コード（1〜47）→ 名称。postal-prefecture.json の値と対応 */
const JIS_PREFECTURE_NAMES = [
  "", "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

/**
 * 郵便番号から都道府県名を判定（日本郵便データ由来の3桁プレフィックス表＋県境の7桁例外表）。
 * 住所が「厚木市…」のように都道府県なしで登録されていても、freee の都道府県を自動設定するために使う。
 * 7桁として解釈できない場合は空文字。
 */
export function prefectureFromPostalCode(zipRaw: string): string {
  const digits = zipRaw.normalize("NFKC").replace(/\D/g, "");
  if (digits.length !== 7) return "";
  const data = postalPrefecture as { prefixes: Record<string, number>; exceptions: Record<string, number> };
  const code = data.exceptions[digits] ?? data.prefixes[digits.slice(0, 3)];
  return code != null ? (JIS_PREFECTURE_NAMES[code] ?? "") : "";
}

/** 住所の都道府県（先頭にあればそれを、なければ郵便番号から判定）と残りを返す */
export function resolveJpAddress(address: string, postalCode: string): { prefecture: string; rest: string } {
  const { prefecture, rest } = splitJpAddress(address);
  if (prefecture !== "") return { prefecture, rest };
  return { prefecture: prefectureFromPostalCode(postalCode), rest };
}

/**
 * 住所の末尾から建物名・部屋番号を分離する（address2 が未入力の既存データ用のヒューリスティック）。
 * 誤分割を避けるため「番地の数字の後に空白区切りがある」場合のみ分割する
 * （例: 「郡山市喜久田町23-144 サンリット寺久保201」→ 番地=…23-144 / 建物=サンリット寺久保201）。
 * 空白なしで建物名が続く住所はそのまま返す（新規入力は建物名欄が分かれているため今後は発生しない）。
 */
export function splitBuildingFromStreet(street: string): { street: string; building: string } {
  const t = street.trim();
  const m = /^(.*?[0-9０-９][0-9０-９\-−ー－]*(?:号室?|番地?)?)[\s　]+(\S.*)$/.exec(t);
  if (m) return { street: m[1].trim(), building: m[2].trim() };
  return { street: t, building: "" };
}

/** freee 出力用の銀行コード・支店コード。アプリで未確定なら銀行名・支店名からマスタ照合して自動判定する */
export function resolveBankCodesForFreee(member: {
  bankName?: string;
  bankCode?: string;
  branchName?: string;
  branchCode?: string;
}): { bankCode: string; branchCode: string } {
  let bankCode = (member.bankCode ?? "").trim();
  if (bankCode === "" && (member.bankName ?? "").trim() !== "") {
    bankCode = matchBankByName((member.bankName ?? "").trim())?.code ?? "";
  }
  let branchCode = (member.branchCode ?? "").trim();
  if (branchCode === "" && bankCode !== "" && (member.branchName ?? "").trim() !== "") {
    branchCode = matchBranchByName(bankCode, (member.branchName ?? "").trim())?.code ?? "";
  }
  return { bankCode, branchCode };
}

/** 支店名を freee 表記に（末尾が支店・営業部・出張所・本店・支所以外なら「支店」を付ける） */
export function branchNameForFreee(branchName: string): string {
  const t = branchName.trim();
  if (t === "") return "";
  return /(支店|営業部|出張所|本店|支所)$/.test(t) ? t : `${t}支店`;
}

/**
 * 振込用の口座番号に正規化する（freee は7桁まで・半角数字のみ）。
 * - 全角数字は半角化し、数字以外（スペース・ハイフン等）は区切りとして扱い、最後の数字列を採用
 *   （ゆうちょで「記号 番号」を続けて入力しているケースは番号側を取る）
 * - ゆうちょ銀行の通帳の「番号」（2〜8桁・末尾は必ず1）は、公式ルールどおり
 *   末尾の1を除いて7桁になるまで先頭を0埋めした振込用番号に変換する（例: 2345671 → 0234567）。
 *   ちょうど7桁で末尾1の場合のみ「変換済みの振込用番号」の可能性と曖昧なため、そのまま通す。
 */
export function accountNumberForTransfer(accountNumberRaw: string, bankName: string, bankCode: string): string {
  const digitRuns = accountNumberRaw.normalize("NFKC").match(/\d+/g) ?? [];
  if (digitRuns.length === 0) return "";
  let num = digitRuns[digitRuns.length - 1];
  const isYucho = bankCode.trim() === "9900" || bankName.includes("ゆうちょ");
  if (isYucho && num.endsWith("1") && num.length >= 2 && num.length <= 8 && num.length !== 7) {
    num = num.slice(0, -1).padStart(7, "0");
  }
  return num;
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
    const { prefecture, rest } = resolveJpAddress(m.address ?? "", m.postalCode ?? "");
    const address2 = (m.address2 ?? "").trim();
    const split = address2 !== "" ? { street: rest, building: address2 } : splitBuildingFromStreet(rest);
    const { bankCode, branchCode } = resolveBankCodesForFreee(m);
    const bankMaster = bankCode !== "" ? bankByCode(bankCode) : null;
    const branchMaster = bankCode !== "" && branchCode !== "" ? branchByCode(bankCode, branchCode) : null;
    const invReg = (m.invoiceRegistrationNumber ?? "").trim();
    rows.push([
      m.name,
      "個人事業主",
      "国内",
      (m.postalCode ?? "").trim(),
      prefecture,
      split.street,
      split.building,
      "使用する",
      bankMaster ? bankMasterDisplayName(bankMaster.name) : (m.bankName ?? "").trim(),
      bankMaster ? toHalfWidthKana(bankMaster.kana) : "",
      stripLeadingZeros(bankCode),
      branchNameForFreee(branchMaster ? branchMaster.name : (m.branchName ?? "")),
      branchMaster ? toHalfWidthKana(branchMaster.kana) : "",
      stripLeadingZeros(branchCode),
      (m.accountType ?? "普通").trim() || "普通",
      accountNumberForTransfer(m.accountNumber ?? "", (m.bankName ?? "").trim(), bankCode),
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
