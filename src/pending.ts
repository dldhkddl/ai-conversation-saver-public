import type { RecommendationLevel, StoredRecommendationLevel } from "./domain";

export type PendingSource = "codex" | "claude";

export interface PendingRecommendation {
  id: string;
  source: PendingSource;
  recommendedModel: string;
  recommendationLevel: RecommendationLevel;
  taskExcerpt: string;
  recommendedAt: string;
}

export interface PreviousRecommendationReference {
  recommendationLevel: StoredRecommendationLevel;
  savedAt: string;
}

export interface RecommendationChoices {
  fresh: PendingRecommendation[];
  stale: PendingRecommendation[];
  previous: PreviousRecommendationReference | null;
  defaultPendingId: string | null;
  defaultLevel: StoredRecommendationLevel;
}

const FRESH_MS = 4 * 60 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_PER_SOURCE = 20;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/;
const LEVELS = new Set<RecommendationLevel>(["quick", "writing", "balanced", "advanced", "agentic"]);

const timestamp = (item: PendingRecommendation): number => Date.parse(item.recommendedAt);

export function prunePendingRecommendations(items: PendingRecommendation[], nowMs: number): PendingRecommendation[] {
  return items.filter((item) => {
    const value = timestamp(item);
    const age = nowMs - value;
    return Number.isFinite(value) && age >= 0 && age <= RETENTION_MS;
  });
}

export function isPendingRecommendation(value: unknown): value is PendingRecommendation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PendingRecommendation>;
  return typeof item.id === "string" && item.id.length > 0
    && (item.source === "codex" || item.source === "claude")
    && typeof item.recommendedModel === "string" && SAFE_ID.test(item.recommendedModel)
    && typeof item.recommendationLevel === "string" && LEVELS.has(item.recommendationLevel as RecommendationLevel)
    && typeof item.taskExcerpt === "string"
    && typeof item.recommendedAt === "string" && Number.isFinite(Date.parse(item.recommendedAt));
}

export function sanitizePendingRecommendations(value: unknown, nowMs: number): PendingRecommendation[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isPendingRecommendation)
    .reduce<PendingRecommendation[]>((items, item) => enqueuePendingRecommendation(items, item, nowMs), []);
}

export function enqueuePendingRecommendation(
  items: PendingRecommendation[],
  item: PendingRecommendation,
  nowMs: number
): PendingRecommendation[] {
  const retained = prunePendingRecommendations(items, nowMs).filter((entry) => entry.id !== item.id);
  const age = nowMs - timestamp(item);
  if (!Number.isFinite(timestamp(item)) || age < 0 || age > RETENTION_MS) return retained;
  retained.push(item);
  const sameSource = retained
    .filter((entry) => entry.source === item.source)
    .sort((left, right) => timestamp(right) - timestamp(left));
  const keepIds = new Set(sameSource.slice(0, MAX_PER_SOURCE).map((entry) => entry.id));
  return retained.filter((entry) => entry.source !== item.source || keepIds.has(entry.id));
}

export function consumePendingRecommendation(
  items: PendingRecommendation[],
  id: string | null
): PendingRecommendation[] {
  return id === null ? [...items] : items.filter((item) => item.id !== id);
}

export function recommendationChoices(
  items: PendingRecommendation[],
  source: PendingSource,
  nowMs: number,
  previous: PreviousRecommendationReference | null = null
): RecommendationChoices {
  const candidates = prunePendingRecommendations(items, nowMs)
    .filter((item) => item.source === source)
    .sort((left, right) => timestamp(right) - timestamp(left));
  const fresh = candidates.filter((item) => nowMs - timestamp(item) <= FRESH_MS);
  const stale = candidates.filter((item) => nowMs - timestamp(item) > FRESH_MS);
  const only = fresh.length === 1 ? fresh[0] : undefined;
  return {
    fresh,
    stale,
    previous,
    defaultPendingId: only?.id ?? null,
    defaultLevel: only?.recommendationLevel ?? "unknown"
  };
}

export function createTaskExcerpt(task: string): string {
  const compact = task.replace(/\s+/gu, " ").trim();
  const characters = Array.from(compact);
  return characters.length <= 30 ? compact : `${characters.slice(0, 30).join("")}…`;
}
