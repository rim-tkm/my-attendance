/** 業務委託（時給制）メンバーの組織上区分。インターン（成果報酬）とは別軸。 */
export type MemberContractorCategory = "general" | "sv" | "fulltime_candidate";

export const MEMBER_CONTRACTOR_CATEGORY_DEFAULT: MemberContractorCategory = "general";

export const MEMBER_CONTRACTOR_CATEGORY_OPTIONS: {
  value: MemberContractorCategory;
  label: string;
}[] = [
  { value: "general", label: "一般（業務委託）" },
  { value: "sv", label: "SV（業務委託）" },
  { value: "fulltime_candidate", label: "正社員候補（業務委託）" },
];

export function normalizeMemberContractorCategory(
  raw: string | null | undefined
): MemberContractorCategory {
  const s = String(raw ?? "").trim();
  if (s === "sv" || s === "fulltime_candidate") return s;
  return MEMBER_CONTRACTOR_CATEGORY_DEFAULT;
}

export function memberContractorCategoryLabel(category: MemberContractorCategory | undefined): string {
  const found = MEMBER_CONTRACTOR_CATEGORY_OPTIONS.find((o) => o.value === category);
  return found?.label ?? MEMBER_CONTRACTOR_CATEGORY_OPTIONS[0].label;
}

/** 一覧バッジ用の短い表示名 */
export function memberContractorCategoryShortLabel(category: MemberContractorCategory | undefined): string {
  switch (normalizeMemberContractorCategory(category)) {
    case "sv":
      return "SV";
    case "fulltime_candidate":
      return "正社員候補";
    default:
      return "";
  }
}

export function memberContractorCategoryBadgeClass(category: MemberContractorCategory | undefined): string {
  switch (normalizeMemberContractorCategory(category)) {
    case "sv":
      return "bg-sky-100 text-sky-900";
    case "fulltime_candidate":
      return "bg-amber-100 text-amber-900";
    default:
      return "";
  }
}
