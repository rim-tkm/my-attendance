/** フォーム入力の文字列正規化・契約形態変換 */

export type ContractTypeCanonical = "intern" | "contractor";

export function coerceFormText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
}

export function normalizeContractType(raw: string): ContractTypeCanonical {
  const t = raw.trim().toLowerCase();
  if (t === "") return "contractor";
  if (t.includes("インターン") || t === "intern" || t === "internship") return "intern";
  if (
    t.includes("業務委託") ||
    t.includes("一般") ||
    t === "general" ||
    t === "contractor" ||
    t === "hourly"
  ) {
    return "contractor";
  }
  return "contractor";
}

export function contractTypeToIsIntern(type: ContractTypeCanonical): boolean {
  return type === "intern";
}
