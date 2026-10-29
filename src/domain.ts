export const SCHEMA_VERSION = 2;

export type Outcome = "good" | "mixed" | "bad";
export type StoredOutcome = Outcome | "unknown";
export type CorrectionAction = "void" | "restore";
export type RecommendationLevel = "quick" | "writing" | "balanced" | "advanced" | "agentic";
export type StoredRecommendationLevel = RecommendationLevel | "unknown";

// 어떤 "모델"을 쓸지와는 별개로, 어떤 "실행 환경"에서 작업할지에 대한 추천.
// codex 계열: chatgpt-chat(일반 대화) / chatgpt-work(파일 다루는 에이전트) / codex-cli(코드·터미널)
// claude 계열: claude-chat(일반 대화) / claude-cowork(파일 다루는 에이전트) / claude-code(코드·터미널)
export type ExecutionMode =
  | "chatgpt-chat"
  | "chatgpt-work"
  | "codex-cli"
  | "claude-chat"
  | "claude-cowork"
  | "claude-code";
export type StoredExecutionMode = ExecutionMode | "unknown";

export interface ModelDefinition {
  source: string;
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  builtin?: boolean;
}

export interface RevisionMeta {
  rev: number;
  source: string;
  model: string;
  outcome: StoredOutcome;
  recommendation_level: StoredRecommendationLevel;
  summary: string;
  saved_at: string;
  dedupe_hash: string;
  voided: boolean;
}

export interface CorrectionMeta {
  action: CorrectionAction;
  target_rev: number;
  corrected_at: string;
  reason?: string;
}

export interface SummaryCorrectionMeta {
  action: "summary";
  target_rev: number;
  corrected_at: string;
  summary: string;
}

export interface RevisionEvent extends Omit<RevisionMeta, "voided"> {
  kind: "revision";
  payload: string;
}

export interface CorrectionEvent extends CorrectionMeta {
  kind: "correction";
}

export interface SummaryCorrectionEvent {
  kind: "summary-correction";
  target_rev: number;
  corrected_at: string;
  summary: string;
}

// "추천대로 갔는지, 다른 걸 썼는지, 결과가 어땠는지"를 기록하는 이벤트.
// void/restore(정정)와는 목적이 다르다 — 저건 "이 리비전을 무효로 할지"이고,
// 이건 "그때 추천이 실제로 맞았는지"를 나중에 배우기 위한 기록이다.
export interface RecommendationFeedbackMeta {
  target_rev: number;
  recorded_at: string;
  recommended_model: string;
  recommended_mode: ExecutionMode;
  selected_model: string;
  selected_mode: ExecutionMode;
  result: Outcome;
  reason?: string;
}

export interface RecommendationFeedbackEvent extends RecommendationFeedbackMeta {
  kind: "recommendation-feedback";
}

export type ParsedEvent = RevisionEvent | CorrectionEvent | SummaryCorrectionEvent | RecommendationFeedbackEvent;

export interface ConversationMetadata {
  type: "ai-conversation";
  schema_version: number;
  created_at: string;
  last_saved_at: string;
  sources: string[];
  models: string[];
  recommendation_levels: RecommendationLevel[];
  last_outcome: StoredOutcome | null;
  revision_count: number;
  effective_revision_count: number;
  revisions: RevisionMeta[];
  corrections: Array<CorrectionMeta | SummaryCorrectionMeta>;
}

export const DEFAULT_MODELS: ModelDefinition[] = [
  { source: "codex", id: "luna", label: "Luna", description: "빠른 작성·요약·분류·반복 작업", enabled: true, builtin: true },
  { source: "codex", id: "terra", label: "Terra", description: "속도와 성능이 균형 잡힌 일반 작업", enabled: true, builtin: true },
  { source: "codex", id: "sol", label: "Sol", description: "복잡한 설계·코딩·고난도 추론", enabled: true, builtin: true },
  { source: "claude", id: "fable-5", label: "Fable 5", description: "장시간 실행 에이전트와 복합 작업", enabled: true, builtin: true },
  { source: "claude", id: "opus-5", label: "Opus 5", description: "복잡한 에이전트 코딩과 고난도 업무", enabled: true, builtin: true },
  { source: "claude", id: "sonnet-5", label: "Sonnet 5", description: "속도와 지능이 균형 잡힌 일반 작업", enabled: true, builtin: true },
  { source: "claude", id: "haiku-4.5", label: "Haiku 4.5", description: "가장 빠른 응답과 가벼운 작업", enabled: true, builtin: true }
];
