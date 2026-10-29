import { computeHash, normalizeLf } from "./codec";
import { SCHEMA_VERSION } from "./domain";
import type { ConversationMetadata, CorrectionAction, StoredOutcome, StoredRecommendationLevel } from "./domain";
import { appendEventBlock, parseEventLog, parseEventLogDetailed, renderCorrectionBlock, renderRevisionBlock, renderSummaryCorrectionBlock } from "./events";
import { deriveMetadata } from "./metadata";

export interface RevisionInput {
  payload: string;
  source: string;
  model: string;
  outcome: StoredOutcome;
  recommendation_level: StoredRecommendationLevel;
  summary: string;
  saved_at: string;
}

export interface CorrectionInput {
  action: CorrectionAction;
  target_rev: number;
  corrected_at: string;
  reason?: string;
}

export interface SummaryCorrectionInput {
  target_rev: number;
  corrected_at: string;
  summary: string;
}

export type PreparedRevision =
  | { changed: false; hash: string; duplicateRev: number; warnings: string[] }
  | { changed: true; hash: string; revision: number; content: string; metadata: ConversationMetadata; warnings: string[] };

export interface PreparedCorrection {
  changed: true;
  content: string;
  metadata: ConversationMetadata;
  warnings: string[];
}

export interface RebuiltConversationNote {
  content: string;
  warnings: string[];
}

export interface SplitNote {
  frontmatter: string;
  body: string;
  type: string | null;
  schemaVersion: number | null;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlStringArray(values: string[]): string {
  return `[${values.map(yamlString).join(", ")}]`;
}

function readFrontmatterString(frontmatter: string, key: string): string | null {
  const keyOccurrences = [...frontmatter.matchAll(new RegExp(`^[ \\t]*${key}[ \\t]*:`, "gm"))];
  if (keyOccurrences.length !== 1) return null;
  const matches = [...frontmatter.matchAll(new RegExp(
    `^[ \\t]*${key}[ \\t]*:[ \\t]*(?:"([^"]*)"|'([^']*)'|([^\\s#]+))[ \\t]*(?:#.*)?$`,
    "gm"
  ))];
  if (matches.length !== 1) return null;
  const match = matches[0];
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

export function splitConversationNote(text: string): SplitNote {
  const match = text.match(FRONTMATTER_PATTERN);
  if (!match || match[1] === undefined) {
    return { frontmatter: "", body: text, type: null, schemaVersion: null };
  }
  const frontmatter = match[1];
  const type = readFrontmatterString(frontmatter, "type");
  const schemaRaw = readFrontmatterString(frontmatter, "schema_version");
  const schemaVersion = schemaRaw !== null && /^\d+$/.test(schemaRaw) ? Number(schemaRaw) : null;
  return {
    frontmatter,
    body: text.slice(match[0].length),
    type,
    schemaVersion
  };
}

export function isSupportedConversationFrontmatter(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const frontmatter = value as { type?: unknown; schema_version?: unknown };
  return frontmatter.type === "ai-conversation" && frontmatter.schema_version === SCHEMA_VERSION;
}

export function serializeFrontmatter(metadata: ConversationMetadata): string {
  const lines = [
    `type: ${yamlString(metadata.type)}`,
    `schema_version: ${metadata.schema_version}`,
    `created_at: ${yamlString(metadata.created_at)}`,
    `last_saved_at: ${yamlString(metadata.last_saved_at)}`,
    `sources: ${yamlStringArray(metadata.sources)}`,
    `models: ${yamlStringArray(metadata.models)}`,
    `recommendation_levels: ${yamlStringArray(metadata.recommendation_levels)}`,
    `last_outcome: ${metadata.last_outcome === null ? "null" : yamlString(metadata.last_outcome)}`,
    `revision_count: ${metadata.revision_count}`,
    `effective_revision_count: ${metadata.effective_revision_count}`,
    "revisions:"
  ];

  for (const revision of metadata.revisions) {
    lines.push(
      `  - rev: ${revision.rev}`,
      `    source: ${yamlString(revision.source)}`,
      `    model: ${yamlString(revision.model)}`,
      `    outcome: ${yamlString(revision.outcome)}`,
      `    recommendation_level: ${yamlString(revision.recommendation_level)}`,
      `    summary: ${yamlString(revision.summary)}`,
      `    saved_at: ${yamlString(revision.saved_at)}`,
      `    dedupe_hash: ${yamlString(revision.dedupe_hash)}`,
      `    voided: ${revision.voided}`
    );
  }

  if (metadata.corrections.length === 0) {
    lines.push("corrections: []");
  } else {
    lines.push("corrections:");
    for (const correction of metadata.corrections) {
      lines.push(
        `  - action: ${yamlString(correction.action)}`,
        `    target_rev: ${correction.target_rev}`,
        `    corrected_at: ${yamlString(correction.corrected_at)}`
      );
      if (correction.action === "summary") {
        lines.push(`    summary: ${yamlString(correction.summary)}`);
      } else if (correction.reason !== undefined) {
        lines.push(`    reason: ${yamlString(correction.reason)}`);
      }
    }
  }
  return lines.join("\n");
}

export function serializeConversationNote(metadata: ConversationMetadata, body: string): string {
  return `---\n${serializeFrontmatter(metadata)}\n---\n${body}`;
}

function assertConversationNoteWritable(split: SplitNote): void {
  if (split.type !== "ai-conversation") {
    throw new Error("대상 노트가 AI 대화 노트가 아닙니다.");
  }
  if (split.schemaVersion === null) {
    throw new Error("schema_version이 없거나 올바르지 않습니다.");
  }
  if (split.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`지원하지 않는 schema_version ${split.schemaVersion}입니다. 쓰기를 거부합니다.`);
  }
}

function assertId(value: string, label: string): void {
  if (!SAFE_ID_PATTERN.test(value)) throw new Error(`${label} ID 형식이 올바르지 않습니다: ${value}`);
}

export async function prepareRevision(text: string, input: RevisionInput): Promise<PreparedRevision> {
  const split = splitConversationNote(text);
  const isNew = text === "";
  if (!isNew) assertConversationNoteWritable(split);
  assertId(input.source, "공급자");
  assertId(input.model, "모델");

  const payload = normalizeLf(input.payload);
  const hash = await computeHash(payload);
  const existingParsed = isNew ? { events: [], warnings: [] } : parseEventLogDetailed(split.body);
  const existingEvents = existingParsed.events;
  const existingRevision = existingEvents.find(
    (event) => event.kind === "revision" && event.dedupe_hash === hash
  );
  if (existingRevision?.kind === "revision") {
    return { changed: false, hash, duplicateRev: existingRevision.rev, warnings: existingParsed.warnings };
  }

  const revision = existingEvents.filter((event) => event.kind === "revision").length + 1;
  const block = renderRevisionBlock({
    rev: revision,
    saved_at: input.saved_at,
    source: input.source,
    model: input.model,
    outcome: input.outcome,
    recommendation_level: input.recommendation_level,
    summary: input.summary,
    dedupe_hash: hash,
    payload
  });
  const body = appendEventBlock(isNew ? "" : split.body, block);
  const parsed = parseEventLogDetailed(body);
  const metadata = await deriveMetadata(parsed.events);
  return {
    changed: true,
    hash,
    revision,
    content: serializeConversationNote(metadata, body),
    metadata,
    warnings: parsed.warnings
  };
}

export async function prepareCorrection(text: string, input: CorrectionInput): Promise<PreparedCorrection> {
  const split = splitConversationNote(text);
  assertConversationNoteWritable(split);
  const block = renderCorrectionBlock(input);
  const body = appendEventBlock(split.body, block);
  const parsed = parseEventLogDetailed(body);
  const metadata = await deriveMetadata(parsed.events);
  return { changed: true, content: serializeConversationNote(metadata, body), metadata, warnings: parsed.warnings };
}

export async function prepareSummaryCorrection(text: string, input: SummaryCorrectionInput): Promise<PreparedCorrection> {
  const split = splitConversationNote(text);
  assertConversationNoteWritable(split);
  const block = renderSummaryCorrectionBlock(input);
  const body = appendEventBlock(split.body, block);
  const parsed = parseEventLogDetailed(body);
  const metadata = await deriveMetadata(parsed.events);
  return { changed: true, content: serializeConversationNote(metadata, body), metadata, warnings: parsed.warnings };
}

export async function rebuildConversationNote(text: string): Promise<string> {
  return (await rebuildConversationNoteDetailed(text)).content;
}

export async function rebuildConversationNoteDetailed(text: string): Promise<RebuiltConversationNote> {
  const split = splitConversationNote(text);
  assertConversationNoteWritable(split);
  const parsed = parseEventLogDetailed(split.body);
  const metadata = await deriveMetadata(parsed.events);
  return { content: serializeConversationNote(metadata, split.body), warnings: parsed.warnings };
}

export async function verifyConversationWrite(
  text: string,
  expectedMetadata: ConversationMetadata,
  expectedHash?: string
): Promise<void> {
  const split = splitConversationNote(text);
  assertConversationNoteWritable(split);
  if (split.frontmatter !== serializeFrontmatter(expectedMetadata)) {
    throw new Error("쓰기 후 frontmatter 검증에 실패했습니다.");
  }
  const events = parseEventLog(split.body);
  const actualMetadata = await deriveMetadata(events);
  if (JSON.stringify(actualMetadata) !== JSON.stringify(expectedMetadata)) {
    throw new Error("쓰기 후 메타데이터 검증에 실패했습니다.");
  }
  if (expectedHash !== undefined) {
    const count = events.filter((event) => event.kind === "revision" && event.dedupe_hash === expectedHash).length;
    if (count !== 1) throw new Error("쓰기 후 원문 해시 검증에 실패했습니다.");
  }
}

const WINDOWS_RESERVED_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const TITLE_MAX_CODE_POINTS = 120;

export function sanitizeTitle(raw: string, suffix = ""): string {
  const cleanEdges = (value: string): string => value.replace(/^[.\s]+/u, "").replace(/[.\s]+$/u, "");
  const suffixCharacters = Array.from(suffix).slice(0, TITLE_MAX_CODE_POINTS);
  const available = Math.max(0, TITLE_MAX_CODE_POINTS - suffixCharacters.length);
  let title = raw
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  title = cleanEdges(title);
  title = cleanEdges(Array.from(title).slice(0, available).join(""));
  const dot = title.indexOf(".");
  const stem = dot === -1 ? title : title.slice(0, dot);
  if (WINDOWS_RESERVED_STEM.test(stem)) {
    title = `${stem}_${dot === -1 ? "" : title.slice(dot)}`;
    title = cleanEdges(Array.from(title).slice(0, available).join(""));
  }
  return `${title}${suffixCharacters.join("")}`;
}

export function suggestTitle(text: string): string {
  const firstLine = normalizeLf(text).split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
  return Array.from(firstLine).slice(0, 40).join("");
}
