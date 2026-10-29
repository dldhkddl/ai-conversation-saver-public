export const SUMMARY_MAX_CODE_POINTS = 200;

export interface NormalizedSummary {
  value: string;
  truncated: boolean;
}

export function normalizeSummary(raw: string): NormalizedSummary {
  const compact = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const characters = Array.from(compact);
  return {
    value: characters.slice(0, SUMMARY_MAX_CODE_POINTS).join("").trim(),
    truncated: characters.length > SUMMARY_MAX_CODE_POINTS
  };
}

export function saveButtonLabel(outcome: "good" | "mixed" | "bad", summary: string): string {
  const outcomeLabel = outcome === "good" ? "좋음" : outcome === "mixed" ? "보통" : "나쁨";
  return normalizeSummary(summary).value === ""
    ? `메모 없이 ${outcomeLabel}으로 저장`
    : `${outcomeLabel}으로 저장`;
}
