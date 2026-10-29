import type { RecommendationSource } from "./recommender";

export function appLaunchUrl(source: RecommendationSource): string {
  if (source === "codex") return "codex://";
  if (source === "claude") return "claude://";
  throw new Error("지원하지 않는 AI 공급자입니다.");
}
