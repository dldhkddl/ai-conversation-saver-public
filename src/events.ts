import { decodePayload, encodePayload, normalizeLf } from "./codec";
import type {
  CorrectionAction,
  CorrectionEvent,
  ExecutionMode,
  Outcome,
  ParsedEvent,
  RecommendationFeedbackEvent,
  RevisionEvent,
  StoredOutcome,
  StoredRecommendationLevel,
  SummaryCorrectionEvent
} from "./domain";
import { normalizeSummary } from "./summary";

const ID_PATTERN = "[a-z0-9][a-z0-9._-]*";
const ISO_PATTERN = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})";
const JSON_STRING_PATTERN = '"(?:\\\\.|[^"\\\\\\r\\n])*"';
const REVISION_HEADER = new RegExp(
  `^> \\[!note\\]- revision ([1-9]\\d*) · (${ISO_PATTERN}) · (${ID_PATTERN}) · (${ID_PATTERN}) · (good|mixed|bad|unknown) · level:(quick|writing|balanced|advanced|agentic|unknown) · sha256:([0-9a-f]{64}) · summary:(${JSON_STRING_PATTERN})$`
);
const CORRECTION_HEADER = new RegExp(
  `^> \\[!(warning|success)\\]- correction (void|restore) · revision ([1-9]\\d*) · (${ISO_PATTERN})$`
);
const SUMMARY_CORRECTION_HEADER = new RegExp(
  `^> \\[!info\\]- correction summary · revision ([1-9]\\d*) · (${ISO_PATTERN}) · summary:(${JSON_STRING_PATTERN})$`
);
const RECOMMENDATION_FEEDBACK_HEADER = new RegExp(
  `^> \\[!question\\]- recommendation-feedback · revision ([1-9]\\d*) · (${ISO_PATTERN}) · recommended:(${ID_PATTERN})/(${ID_PATTERN}) · selected:(${ID_PATTERN})/(${ID_PATTERN}) · result:(good|mixed|bad)$`
);

export interface RevisionBlockInput {
  rev: number;
  saved_at: string;
  source: string;
  model: string;
  outcome: StoredOutcome;
  recommendation_level: StoredRecommendationLevel;
  summary: string;
  dedupe_hash: string;
  payload: string;
}

export interface CorrectionBlockInput {
  action: CorrectionAction;
  target_rev: number;
  corrected_at: string;
  reason?: string;
}

export interface SummaryCorrectionBlockInput {
  target_rev: number;
  corrected_at: string;
  summary: string;
}

export interface RecommendationFeedbackBlockInput {
  target_rev: number;
  recorded_at: string;
  recommended_model: string;
  recommended_mode: ExecutionMode;
  selected_model: string;
  selected_mode: ExecutionMode;
  result: Outcome;
  reason?: string;
}

export function renderRevisionBlock(input: RevisionBlockInput): string {
  const summary = normalizeSummary(input.summary).value;
  const header = `> [!note]- revision ${input.rev} · ${input.saved_at} · ${input.source} · ${input.model} · ${input.outcome} · level:${input.recommendation_level} · ${input.dedupe_hash} · summary:${JSON.stringify(summary)}`;
  return `${header}\n${encodePayload(input.payload)}`;
}

export function renderCorrectionBlock(input: CorrectionBlockInput): string {
  const callout = input.action === "void" ? "warning" : "success";
  const header = `> [!${callout}]- correction ${input.action} · revision ${input.target_rev} · ${input.corrected_at}`;
  return `${header}\n${encodePayload(input.reason ?? "")}`;
}

export function renderSummaryCorrectionBlock(input: SummaryCorrectionBlockInput): string {
  const summary = normalizeSummary(input.summary).value;
  const header = `> [!info]- correction summary · revision ${input.target_rev} · ${input.corrected_at} · summary:${JSON.stringify(summary)}`;
  return `${header}\n${encodePayload("")}`;
}

export function renderRecommendationFeedbackBlock(input: RecommendationFeedbackBlockInput): string {
  const header = `> [!question]- recommendation-feedback · revision ${input.target_rev} · ${input.recorded_at} · recommended:${input.recommended_model}/${input.recommended_mode} · selected:${input.selected_model}/${input.selected_mode} · result:${input.result}`;
  return `${header}\n${encodePayload(input.reason ?? "")}`;
}

export function appendEventBlock(body: string, block: string): string {
  if (body === "") return `\n${block}\n`;
  if (body.endsWith("\n\n")) return `${body}${block}\n`;
  if (body.endsWith("\n")) return `${body}\n${block}\n`;
  return `${body}\n\n${block}\n`;
}

export interface EventLogParseResult {
  events: ParsedEvent[];
  warnings: string[];
}

export function parseEventLog(body: string): ParsedEvent[] {
  return parseEventLogDetailed(body).events;
}

export function parseEventLogDetailed(body: string): EventLogParseResult {
  const lines = normalizeLf(body).split("\n");
  const events: ParsedEvent[] = [];
  const warnings: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    if (index === 0) {
      if (/^> \[!(?:note|warning|success|info|question)\]- (?:revision|correction|recommendation-feedback) /.test(line)) {
        throw new Error("1행: 이벤트 앞에 실제 빈 줄 경계가 없습니다.");
      }
      continue;
    }
    if (lines[index - 1] !== "") continue;

    const revisionMatch = line.match(REVISION_HEADER);
    const correctionMatch = line.match(CORRECTION_HEADER);
    const summaryCorrectionMatch = line.match(SUMMARY_CORRECTION_HEADER);
    const recommendationFeedbackMatch = line.match(RECOMMENDATION_FEEDBACK_HEADER);
    if (!revisionMatch && line.startsWith("> [!note]- revision ")) {
      throw new Error(`${index + 1}행: 리비전 헤더 형식 또는 summary JSON이 올바르지 않습니다.`);
    }
    if (!correctionMatch && !summaryCorrectionMatch && /^> \[!(?:warning|success|info)\]- correction /.test(line)) {
      throw new Error(`${index + 1}행: 정정 헤더 형식이 올바르지 않습니다.`);
    }
    if (!recommendationFeedbackMatch && line.startsWith("> [!question]- recommendation-feedback ")) {
      throw new Error(`${index + 1}행: 추천 피드백 헤더 형식이 올바르지 않습니다.`);
    }
    if (!revisionMatch && !correctionMatch && !summaryCorrectionMatch && !recommendationFeedbackMatch) continue;

    const payloadLines: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor] !== "") {
      const payloadLine = lines[cursor];
      if (payloadLine !== undefined) payloadLines.push(payloadLine);
      cursor += 1;
    }
    if (payloadLines.length === 0) {
      throw new Error(`${index + 1}행: 이벤트 payload가 없습니다.`);
    }
    const payload = decodePayload(payloadLines);

    if (revisionMatch) {
      const [, rev, savedAt, source, model, outcome, recommendationLevel, hash, summaryJson] = revisionMatch;
      if (!rev || !savedAt || !source || !model || !outcome || !recommendationLevel || !hash || !summaryJson) {
        throw new Error(`${index + 1}행: 리비전 헤더를 해석할 수 없습니다.`);
      }
      if (!isValidIsoTimestamp(savedAt)) throw new Error(`${index + 1}행: 리비전 저장 시각이 올바르지 않습니다.`);
      const event: RevisionEvent = {
        kind: "revision",
        rev: Number(rev),
        saved_at: savedAt,
        source,
        model,
        outcome: outcome as StoredOutcome,
        recommendation_level: recommendationLevel as StoredRecommendationLevel,
        summary: parseSummaryJson(summaryJson, index + 1, `revision ${rev}`, warnings),
        dedupe_hash: `sha256:${hash}`,
        payload
      };
      events.push(event);
    } else if (summaryCorrectionMatch) {
      const [, targetRev, correctedAt, summaryJson] = summaryCorrectionMatch;
      if (!targetRev || !correctedAt || !summaryJson) {
        throw new Error(`${index + 1}행: 메모 정정 헤더를 해석할 수 없습니다.`);
      }
      if (!isValidIsoTimestamp(correctedAt)) throw new Error(`${index + 1}행: 정정 시각이 올바르지 않습니다.`);
      if (payload !== "") throw new Error(`${index + 1}행: 메모 정정 payload는 비어 있어야 합니다.`);
      const event: SummaryCorrectionEvent = {
        kind: "summary-correction",
        target_rev: Number(targetRev),
        corrected_at: correctedAt,
        summary: parseSummaryJson(summaryJson, index + 1, `revision ${targetRev}의 정정`, warnings)
      };
      events.push(event);
    } else if (correctionMatch) {
      const [, callout, action, targetRev, correctedAt] = correctionMatch;
      if (!callout || !action || !targetRev || !correctedAt) {
        throw new Error(`${index + 1}행: 정정 헤더를 해석할 수 없습니다.`);
      }
      if (!isValidIsoTimestamp(correctedAt)) throw new Error(`${index + 1}행: 정정 시각이 올바르지 않습니다.`);
      if ((action === "void" && callout !== "warning") || (action === "restore" && callout !== "success")) {
        throw new Error(`${index + 1}행: 정정 종류와 callout이 일치하지 않습니다.`);
      }
      const event: CorrectionEvent = {
        kind: "correction",
        action: action as CorrectionAction,
        target_rev: Number(targetRev),
        corrected_at: correctedAt,
        ...(payload === "" ? {} : { reason: payload })
      };
      events.push(event);
    } else if (recommendationFeedbackMatch) {
      const [, targetRev, recordedAt, recommendedModel, recommendedMode, selectedModel, selectedMode, result] = recommendationFeedbackMatch;
      if (!targetRev || !recordedAt || !recommendedModel || !recommendedMode || !selectedModel || !selectedMode || !result) {
        throw new Error(`${index + 1}행: 추천 피드백 헤더를 해석할 수 없습니다.`);
      }
      if (!isValidIsoTimestamp(recordedAt)) throw new Error(`${index + 1}행: 추천 피드백 기록 시각이 올바르지 않습니다.`);
      const event: RecommendationFeedbackEvent = {
        kind: "recommendation-feedback",
        target_rev: Number(targetRev),
        recorded_at: recordedAt,
        recommended_model: recommendedModel,
        recommended_mode: recommendedMode as ExecutionMode,
        selected_model: selectedModel,
        selected_mode: selectedMode as ExecutionMode,
        result: result as Outcome,
        ...(payload === "" ? {} : { reason: payload })
      };
      events.push(event);
    }

    index = cursor - 1;
  }

  return { events, warnings };
}

function parseSummaryJson(value: string, line: number, label: string, warnings: string[]): string {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "string") throw new Error();
    const normalized = normalizeSummary(parsed);
    if (normalized.truncated) warnings.push(`${label}의 한 줄 메모가 200자로 축약되었습니다.`);
    return normalized.value;
  } catch {
    throw new Error(`${line}행: summary JSON 문자열이 올바르지 않습니다.`);
  }
}

function isValidIsoTimestamp(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/);
  if (!match) return false;
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, , , , offsetHourRaw, offsetMinuteRaw] = match;
  if (!yearRaw || !monthRaw || !dayRaw || !hourRaw || !minuteRaw || !secondRaw) return false;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return false;
  if (offsetHourRaw !== undefined && offsetMinuteRaw !== undefined) {
    const offsetHour = Number(offsetHourRaw);
    const offsetMinute = Number(offsetMinuteRaw);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }
  return !Number.isNaN(Date.parse(value));
}
