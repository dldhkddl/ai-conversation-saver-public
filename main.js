"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => AIConversationSaverPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/codec.ts
function normalizeLf(text) {
  return text.replace(/\r\n?/g, "\n");
}
function encodePayload(text) {
  return normalizeLf(text).split("\n").map((line) => line === "" ? ">" : `> ${line}`).join("\n");
}
function decodePayload(lines) {
  return lines.map((line) => {
    if (line === ">") return "";
    if (line.startsWith("> ")) return line.slice(2);
    throw new Error(`\uC798\uBABB\uB41C payload \uC778\uCF54\uB529 \uC904: ${line}`);
  }).join("\n");
}
async function computeHash(text) {
  const bytes = new TextEncoder().encode(normalizeLf(text));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

// src/summary.ts
var SUMMARY_MAX_CODE_POINTS = 200;
function normalizeSummary(raw) {
  const compact = raw.replace(/\r\n?/g, "\n").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/gu, " ").trim();
  const characters = Array.from(compact);
  return {
    value: characters.slice(0, SUMMARY_MAX_CODE_POINTS).join("").trim(),
    truncated: characters.length > SUMMARY_MAX_CODE_POINTS
  };
}
function saveButtonLabel(outcome, summary) {
  const outcomeLabel = outcome === "good" ? "\uC88B\uC74C" : outcome === "mixed" ? "\uBCF4\uD1B5" : "\uB098\uC068";
  return normalizeSummary(summary).value === "" ? `\uBA54\uBAA8 \uC5C6\uC774 ${outcomeLabel}\uC73C\uB85C \uC800\uC7A5` : `${outcomeLabel}\uC73C\uB85C \uC800\uC7A5`;
}

// src/events.ts
var ID_PATTERN = "[a-z0-9][a-z0-9._-]*";
var ISO_PATTERN = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})";
var JSON_STRING_PATTERN = '"(?:\\\\.|[^"\\\\\\r\\n])*"';
var REVISION_HEADER = new RegExp(
  `^> \\[!note\\]- revision ([1-9]\\d*) \xB7 (${ISO_PATTERN}) \xB7 (${ID_PATTERN}) \xB7 (${ID_PATTERN}) \xB7 (good|mixed|bad|unknown) \xB7 level:(quick|writing|balanced|advanced|agentic|unknown) \xB7 sha256:([0-9a-f]{64}) \xB7 summary:(${JSON_STRING_PATTERN})$`
);
var CORRECTION_HEADER = new RegExp(
  `^> \\[!(warning|success)\\]- correction (void|restore) \xB7 revision ([1-9]\\d*) \xB7 (${ISO_PATTERN})$`
);
var SUMMARY_CORRECTION_HEADER = new RegExp(
  `^> \\[!info\\]- correction summary \xB7 revision ([1-9]\\d*) \xB7 (${ISO_PATTERN}) \xB7 summary:(${JSON_STRING_PATTERN})$`
);
var RECOMMENDATION_FEEDBACK_HEADER = new RegExp(
  `^> \\[!question\\]- recommendation-feedback \xB7 revision ([1-9]\\d*) \xB7 (${ISO_PATTERN}) \xB7 recommended:(${ID_PATTERN})/(${ID_PATTERN}) \xB7 selected:(${ID_PATTERN})/(${ID_PATTERN}) \xB7 result:(good|mixed|bad)$`
);
function renderRevisionBlock(input) {
  const summary = normalizeSummary(input.summary).value;
  const header = `> [!note]- revision ${input.rev} \xB7 ${input.saved_at} \xB7 ${input.source} \xB7 ${input.model} \xB7 ${input.outcome} \xB7 level:${input.recommendation_level} \xB7 ${input.dedupe_hash} \xB7 summary:${JSON.stringify(summary)}`;
  return `${header}
${encodePayload(input.payload)}`;
}
function renderCorrectionBlock(input) {
  var _a;
  const callout = input.action === "void" ? "warning" : "success";
  const header = `> [!${callout}]- correction ${input.action} \xB7 revision ${input.target_rev} \xB7 ${input.corrected_at}`;
  return `${header}
${encodePayload((_a = input.reason) != null ? _a : "")}`;
}
function renderSummaryCorrectionBlock(input) {
  const summary = normalizeSummary(input.summary).value;
  const header = `> [!info]- correction summary \xB7 revision ${input.target_rev} \xB7 ${input.corrected_at} \xB7 summary:${JSON.stringify(summary)}`;
  return `${header}
${encodePayload("")}`;
}
function appendEventBlock(body, block) {
  if (body === "") return `
${block}
`;
  if (body.endsWith("\n\n")) return `${body}${block}
`;
  if (body.endsWith("\n")) return `${body}
${block}
`;
  return `${body}

${block}
`;
}
function parseEventLog(body) {
  return parseEventLogDetailed(body).events;
}
function parseEventLogDetailed(body) {
  const lines = normalizeLf(body).split("\n");
  const events = [];
  const warnings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === void 0) continue;
    if (index === 0) {
      if (/^> \[!(?:note|warning|success|info|question)\]- (?:revision|correction|recommendation-feedback) /.test(line)) {
        throw new Error("1\uD589: \uC774\uBCA4\uD2B8 \uC55E\uC5D0 \uC2E4\uC81C \uBE48 \uC904 \uACBD\uACC4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
      }
      continue;
    }
    if (lines[index - 1] !== "") continue;
    const revisionMatch = line.match(REVISION_HEADER);
    const correctionMatch = line.match(CORRECTION_HEADER);
    const summaryCorrectionMatch = line.match(SUMMARY_CORRECTION_HEADER);
    const recommendationFeedbackMatch = line.match(RECOMMENDATION_FEEDBACK_HEADER);
    if (!revisionMatch && line.startsWith("> [!note]- revision ")) {
      throw new Error(`${index + 1}\uD589: \uB9AC\uBE44\uC804 \uD5E4\uB354 \uD615\uC2DD \uB610\uB294 summary JSON\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`);
    }
    if (!correctionMatch && !summaryCorrectionMatch && /^> \[!(?:warning|success|info)\]- correction /.test(line)) {
      throw new Error(`${index + 1}\uD589: \uC815\uC815 \uD5E4\uB354 \uD615\uC2DD\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`);
    }
    if (!recommendationFeedbackMatch && line.startsWith("> [!question]- recommendation-feedback ")) {
      throw new Error(`${index + 1}\uD589: \uCD94\uCC9C \uD53C\uB4DC\uBC31 \uD5E4\uB354 \uD615\uC2DD\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`);
    }
    if (!revisionMatch && !correctionMatch && !summaryCorrectionMatch && !recommendationFeedbackMatch) continue;
    const payloadLines = [];
    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor] !== "") {
      const payloadLine = lines[cursor];
      if (payloadLine !== void 0) payloadLines.push(payloadLine);
      cursor += 1;
    }
    if (payloadLines.length === 0) {
      throw new Error(`${index + 1}\uD589: \uC774\uBCA4\uD2B8 payload\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.`);
    }
    const payload = decodePayload(payloadLines);
    if (revisionMatch) {
      const [, rev, savedAt, source, model, outcome, recommendationLevel, hash, summaryJson] = revisionMatch;
      if (!rev || !savedAt || !source || !model || !outcome || !recommendationLevel || !hash || !summaryJson) {
        throw new Error(`${index + 1}\uD589: \uB9AC\uBE44\uC804 \uD5E4\uB354\uB97C \uD574\uC11D\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.`);
      }
      if (!isValidIsoTimestamp(savedAt)) throw new Error(`${index + 1}\uD589: \uB9AC\uBE44\uC804 \uC800\uC7A5 \uC2DC\uAC01\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`);
      const event = {
        kind: "revision",
        rev: Number(rev),
        saved_at: savedAt,
        source,
        model,
        outcome,
        recommendation_level: recommendationLevel,
        summary: parseSummaryJson(summaryJson, index + 1, `revision ${rev}`, warnings),
        dedupe_hash: `sha256:${hash}`,
        payload
      };
      events.push(event);
    } else if (summaryCorrectionMatch) {
      const [, targetRev, correctedAt, summaryJson] = summaryCorrectionMatch;
      if (!targetRev || !correctedAt || !summaryJson) {
        throw new Error(`${index + 1}\uD589: \uBA54\uBAA8 \uC815\uC815 \uD5E4\uB354\uB97C \uD574\uC11D\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.`);
      }
      if (!isValidIsoTimestamp(correctedAt)) throw new Error(`${index + 1}\uD589: \uC815\uC815 \uC2DC\uAC01\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`);
      if (payload !== "") throw new Error(`${index + 1}\uD589: \uBA54\uBAA8 \uC815\uC815 payload\uB294 \uBE44\uC5B4 \uC788\uC5B4\uC57C \uD569\uB2C8\uB2E4.`);
      const event = {
        kind: "summary-correction",
        target_rev: Number(targetRev),
        corrected_at: correctedAt,
        summary: parseSummaryJson(summaryJson, index + 1, `revision ${targetRev}\uC758 \uC815\uC815`, warnings)
      };
      events.push(event);
    } else if (correctionMatch) {
      const [, callout, action, targetRev, correctedAt] = correctionMatch;
      if (!callout || !action || !targetRev || !correctedAt) {
        throw new Error(`${index + 1}\uD589: \uC815\uC815 \uD5E4\uB354\uB97C \uD574\uC11D\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.`);
      }
      if (!isValidIsoTimestamp(correctedAt)) throw new Error(`${index + 1}\uD589: \uC815\uC815 \uC2DC\uAC01\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`);
      if (action === "void" && callout !== "warning" || action === "restore" && callout !== "success") {
        throw new Error(`${index + 1}\uD589: \uC815\uC815 \uC885\uB958\uC640 callout\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`);
      }
      const event = {
        kind: "correction",
        action,
        target_rev: Number(targetRev),
        corrected_at: correctedAt,
        ...payload === "" ? {} : { reason: payload }
      };
      events.push(event);
    } else if (recommendationFeedbackMatch) {
      const [, targetRev, recordedAt, recommendedModel, recommendedMode, selectedModel, selectedMode, result] = recommendationFeedbackMatch;
      if (!targetRev || !recordedAt || !recommendedModel || !recommendedMode || !selectedModel || !selectedMode || !result) {
        throw new Error(`${index + 1}\uD589: \uCD94\uCC9C \uD53C\uB4DC\uBC31 \uD5E4\uB354\uB97C \uD574\uC11D\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.`);
      }
      if (!isValidIsoTimestamp(recordedAt)) throw new Error(`${index + 1}\uD589: \uCD94\uCC9C \uD53C\uB4DC\uBC31 \uAE30\uB85D \uC2DC\uAC01\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`);
      const event = {
        kind: "recommendation-feedback",
        target_rev: Number(targetRev),
        recorded_at: recordedAt,
        recommended_model: recommendedModel,
        recommended_mode: recommendedMode,
        selected_model: selectedModel,
        selected_mode: selectedMode,
        result,
        ...payload === "" ? {} : { reason: payload }
      };
      events.push(event);
    }
    index = cursor - 1;
  }
  return { events, warnings };
}
function parseSummaryJson(value, line, label, warnings) {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "string") throw new Error();
    const normalized = normalizeSummary(parsed);
    if (normalized.truncated) warnings.push(`${label}\uC758 \uD55C \uC904 \uBA54\uBAA8\uAC00 200\uC790\uB85C \uCD95\uC57D\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`);
    return normalized.value;
  } catch (e) {
    throw new Error(`${line}\uD589: summary JSON \uBB38\uC790\uC5F4\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.`);
  }
}
function isValidIsoTimestamp(value) {
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
  if (offsetHourRaw !== void 0 && offsetMinuteRaw !== void 0) {
    const offsetHour = Number(offsetHourRaw);
    const offsetMinute = Number(offsetMinuteRaw);
    if (offsetHour > 14 || offsetMinute > 59 || offsetHour === 14 && offsetMinute !== 0) return false;
  }
  return !Number.isNaN(Date.parse(value));
}

// src/launcher.ts
function appLaunchUrl(source) {
  if (source === "codex") return "codex://";
  if (source === "claude") return "claude://";
  throw new Error("\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 AI \uACF5\uAE09\uC790\uC785\uB2C8\uB2E4.");
}

// src/domain.ts
var SCHEMA_VERSION = 2;
var DEFAULT_MODELS = [
  { source: "codex", id: "luna", label: "Luna", description: "\uBE60\uB978 \uC791\uC131\xB7\uC694\uC57D\xB7\uBD84\uB958\xB7\uBC18\uBCF5 \uC791\uC5C5", enabled: true, builtin: true },
  { source: "codex", id: "terra", label: "Terra", description: "\uC18D\uB3C4\uC640 \uC131\uB2A5\uC774 \uADE0\uD615 \uC7A1\uD78C \uC77C\uBC18 \uC791\uC5C5", enabled: true, builtin: true },
  { source: "codex", id: "sol", label: "Sol", description: "\uBCF5\uC7A1\uD55C \uC124\uACC4\xB7\uCF54\uB529\xB7\uACE0\uB09C\uB3C4 \uCD94\uB860", enabled: true, builtin: true },
  { source: "claude", id: "fable-5", label: "Fable 5", description: "\uC7A5\uC2DC\uAC04 \uC2E4\uD589 \uC5D0\uC774\uC804\uD2B8\uC640 \uBCF5\uD569 \uC791\uC5C5", enabled: true, builtin: true },
  { source: "claude", id: "opus-5", label: "Opus 5", description: "\uBCF5\uC7A1\uD55C \uC5D0\uC774\uC804\uD2B8 \uCF54\uB529\uACFC \uACE0\uB09C\uB3C4 \uC5C5\uBB34", enabled: true, builtin: true },
  { source: "claude", id: "sonnet-5", label: "Sonnet 5", description: "\uC18D\uB3C4\uC640 \uC9C0\uB2A5\uC774 \uADE0\uD615 \uC7A1\uD78C \uC77C\uBC18 \uC791\uC5C5", enabled: true, builtin: true },
  { source: "claude", id: "haiku-4.5", label: "Haiku 4.5", description: "\uAC00\uC7A5 \uBE60\uB978 \uC751\uB2F5\uACFC \uAC00\uBCBC\uC6B4 \uC791\uC5C5", enabled: true, builtin: true }
];

// src/metadata.ts
async function deriveMetadata(events) {
  var _a;
  const revisions = [];
  const corrections = [];
  const byRevision = /* @__PURE__ */ new Map();
  for (const event of events) {
    if (event.kind === "revision") {
      const expectedRevision = revisions.length + 1;
      if (event.rev !== expectedRevision) {
        throw new Error(`\uB9AC\uBE44\uC804 \uBC88\uD638 \uC624\uB958: ${expectedRevision}\uC774 \uD544\uC694\uD558\uC9C0\uB9CC ${event.rev}\uC744 \uCC3E\uC558\uC2B5\uB2C8\uB2E4.`);
      }
      const actualHash = await computeHash(event.payload);
      if (actualHash !== event.dedupe_hash) {
        throw new Error(`\uB9AC\uBE44\uC804 ${event.rev} \uD574\uC2DC \uBD88\uC77C\uCE58: \uC6D0\uBB38\uC774 \uBCC0\uACBD\uB418\uC5C8\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4.`);
      }
      const revision = {
        rev: event.rev,
        source: event.source,
        model: event.model,
        outcome: event.outcome,
        recommendation_level: event.recommendation_level,
        summary: event.summary,
        saved_at: event.saved_at,
        dedupe_hash: event.dedupe_hash,
        voided: false
      };
      revisions.push(revision);
      byRevision.set(revision.rev, revision);
      continue;
    }
    const target = byRevision.get(event.target_rev);
    if (!target) {
      throw new Error(`\uC874\uC7AC\uD558\uC9C0 \uC54A\uB294 \uB9AC\uBE44\uC804 ${event.target_rev}\uC758 \uC774\uBCA4\uD2B8\uC785\uB2C8\uB2E4.`);
    }
    if (event.kind === "recommendation-feedback") {
      continue;
    }
    if (event.kind === "summary-correction") {
      target.summary = event.summary;
      corrections.push({
        action: "summary",
        target_rev: event.target_rev,
        corrected_at: event.corrected_at,
        summary: event.summary
      });
    } else {
      target.voided = event.action === "void";
      corrections.push({
        action: event.action,
        target_rev: event.target_rev,
        corrected_at: event.corrected_at,
        ...event.reason === void 0 ? {} : { reason: event.reason }
      });
    }
  }
  if (revisions.length === 0) {
    throw new Error("\uB9AC\uBE44\uC804\uC774 \uD558\uB098\uB3C4 \uC5C6\uC2B5\uB2C8\uB2E4.");
  }
  const effective = revisions.filter((revision) => !revision.voided);
  const uniqueInOrder = (values) => [...new Set(values)];
  const lastEffective = effective.at(-1);
  const firstRevision = revisions[0];
  const lastRevision = revisions.at(-1);
  if (!firstRevision || !lastRevision) throw new Error("\uB9AC\uBE44\uC804 \uBA54\uD0C0\uB370\uC774\uD130\uB97C \uB9CC\uB4E4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
  return {
    type: "ai-conversation",
    schema_version: SCHEMA_VERSION,
    created_at: firstRevision.saved_at,
    last_saved_at: lastRevision.saved_at,
    sources: uniqueInOrder(effective.map((revision) => revision.source)),
    models: uniqueInOrder(effective.map((revision) => revision.model)),
    recommendation_levels: uniqueInOrder(effective.map((revision) => revision.recommendation_level).filter((level) => level !== "unknown")),
    last_outcome: (_a = lastEffective == null ? void 0 : lastEffective.outcome) != null ? _a : null,
    revision_count: revisions.length,
    effective_revision_count: effective.length,
    revisions,
    corrections
  };
}

// src/modals.ts
var import_obsidian = require("obsidian");

// src/pending.ts
var FRESH_MS = 4 * 60 * 60 * 1e3;
var RETENTION_MS = 24 * 60 * 60 * 1e3;
var MAX_PER_SOURCE = 20;
var SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/;
var LEVELS = /* @__PURE__ */ new Set(["quick", "writing", "balanced", "advanced", "agentic"]);
var timestamp = (item) => Date.parse(item.recommendedAt);
function prunePendingRecommendations(items, nowMs) {
  return items.filter((item) => {
    const value = timestamp(item);
    const age = nowMs - value;
    return Number.isFinite(value) && age >= 0 && age <= RETENTION_MS;
  });
}
function isPendingRecommendation(value) {
  if (!value || typeof value !== "object") return false;
  const item = value;
  return typeof item.id === "string" && item.id.length > 0 && (item.source === "codex" || item.source === "claude") && typeof item.recommendedModel === "string" && SAFE_ID.test(item.recommendedModel) && typeof item.recommendationLevel === "string" && LEVELS.has(item.recommendationLevel) && typeof item.taskExcerpt === "string" && typeof item.recommendedAt === "string" && Number.isFinite(Date.parse(item.recommendedAt));
}
function sanitizePendingRecommendations(value, nowMs) {
  if (!Array.isArray(value)) return [];
  return value.filter(isPendingRecommendation).reduce((items, item) => enqueuePendingRecommendation(items, item, nowMs), []);
}
function enqueuePendingRecommendation(items, item, nowMs) {
  const retained = prunePendingRecommendations(items, nowMs).filter((entry) => entry.id !== item.id);
  const age = nowMs - timestamp(item);
  if (!Number.isFinite(timestamp(item)) || age < 0 || age > RETENTION_MS) return retained;
  retained.push(item);
  const sameSource = retained.filter((entry) => entry.source === item.source).sort((left, right) => timestamp(right) - timestamp(left));
  const keepIds = new Set(sameSource.slice(0, MAX_PER_SOURCE).map((entry) => entry.id));
  return retained.filter((entry) => entry.source !== item.source || keepIds.has(entry.id));
}
function consumePendingRecommendation(items, id) {
  return id === null ? [...items] : items.filter((item) => item.id !== id);
}
function recommendationChoices(items, source, nowMs, previous = null) {
  var _a, _b;
  const candidates = prunePendingRecommendations(items, nowMs).filter((item) => item.source === source).sort((left, right) => timestamp(right) - timestamp(left));
  const fresh = candidates.filter((item) => nowMs - timestamp(item) <= FRESH_MS);
  const stale = candidates.filter((item) => nowMs - timestamp(item) > FRESH_MS);
  const only = fresh.length === 1 ? fresh[0] : void 0;
  return {
    fresh,
    stale,
    previous,
    defaultPendingId: (_a = only == null ? void 0 : only.id) != null ? _a : null,
    defaultLevel: (_b = only == null ? void 0 : only.recommendationLevel) != null ? _b : "unknown"
  };
}
function createTaskExcerpt(task) {
  const compact = task.replace(/\s+/gu, " ").trim();
  const characters = Array.from(compact);
  return characters.length <= 30 ? compact : `${characters.slice(0, 30).join("")}\u2026`;
}

// src/recommender.ts
var AGENTIC_TERMS = [
  /장시간/i,
  /자율\s*에이전트/i,
  /에이전트\s*실행/i,
  /밤새/i,
  /백그라운드/i,
  /전체\s*(이전|마이그레이션)/i,
  /대규모\s*(이전|마이그레이션)/i,
  /long[- ]?running/i,
  /autonomous\s+agent/i,
  /migration/i
];
var ADVANCED_TERMS = [
  /복잡/i,
  /고난도/i,
  /여러\s*파일/i,
  /다중\s*파일/i,
  /아키텍처/i,
  /리팩터링/i,
  /디버그/i,
  /버그/i,
  /보안/i,
  /성능\s*최적화/i,
  /자동화/i,
  /설계/i,
  /코드/i,
  /코딩/i,
  /구현/i,
  /개발/i,
  /architecture/i,
  /refactor/i,
  /debug/i,
  /security/i,
  /multi[- ]?file/i,
  /implement/i
];
var QUICK_TERMS = [
  /요약/i,
  /번역/i,
  /교정/i,
  /분류/i,
  /짧은/i,
  /간단/i,
  /빠르게/i,
  /문장/i,
  /이름\s*짓/i,
  /키워드/i,
  /summari[sz]e/i,
  /translate/i,
  /proofread/i,
  /classif/i
];
var FILE_AGENT_TERMS = [
  /파일\s*(정리|찾|검색|여러|여러개)/i,
  /폴더\s*(정리|찾|검색)/i,
  /(엑셀|스프레드시트|xlsx|csv|워드|word|pdf|ppt|슬라이드|문서)\s*(정리|만들|생성|작성|추출|편집)/i,
  /여러\s*(파일|문서|폴더)/i,
  /스캔|업로드된|첨부된/i
];
var CODE_SIGNAL_TERMS = [
  /코드|코딩|구현|개발|디버그|버그|리팩터링|터미널|스크립트|커밋|깃|git|배포|서버/i,
  /code|debug|refactor|terminal|script|commit|deploy|server/i
];
var WRITING_TERMS = [
  /(블로그|콘텐츠|카피|광고\s*문구|상세\s*페이지|이메일|보도\s*자료|게시글|보고서|기획안).{0,15}(작성|써|쓰|초안|만들)/i,
  /(글|문서|메일|편지|대본|스토리).{0,10}(작성|써|쓰|다듬|초안)/i
];
var STRONG_ADVANCED_TERMS = [
  /자동화.{0,15}(만들|구현|구축|개발)/i,
  /(앱|웹\s*사이트|웹앱|프로그램|플러그인|시스템).{0,15}(만들|구현|구축|개발)/i,
  /(리팩터링|디버그|보안\s*(감사|검토|점검)|성능\s*최적화|아키텍처)/i,
  /(refactor|debug|security\s*(audit|review)|performance\s*optimi[sz]ation|architecture)/i
];
var LEVEL_COPY = {
  quick: { label: "\uBE60\uB978 \uC791\uC5C5", summary: "\uC9E7\uACE0 \uBA85\uD655\uD55C \uC791\uC5C5\uC774\uB77C \uC18D\uB3C4\uAC00 \uBE60\uB978 \uBAA8\uB378\uC774 \uC801\uD569\uD569\uB2C8\uB2E4." },
  writing: { label: "\uAE00\uC791\uC131", summary: "\uAE00\uC758 \uCD08\uC548\uACFC \uD45C\uD604\uC744 \uB9CC\uB4DC\uB294 \uC791\uC5C5\uC774\uB77C \uC791\uC131 \uC18D\uB3C4\uC640 \uBB38\uC7A5\uB825\uC744 \uAC01\uAC01 \uACE0\uB824\uD588\uC2B5\uB2C8\uB2E4." },
  balanced: { label: "\uADE0\uD615 \uC791\uC5C5", summary: "\uD2B9\uBCC4\uD788 \uBB34\uAC81\uC9C0 \uC54A\uC740 \uC77C\uBC18 \uC791\uC5C5\uC774\uB77C \uADE0\uD615\uD615 \uBAA8\uB378\uC774 \uC801\uD569\uD569\uB2C8\uB2E4." },
  advanced: { label: "\uACE0\uB09C\uB3C4 \uC791\uC5C5", summary: "\uBCF5\uC7A1\uD55C \uCF54\uB529\xB7\uC124\uACC4\xB7\uBB38\uC81C \uD574\uACB0 \uC2E0\uD638\uAC00 \uC788\uC5B4 \uACE0\uC131\uB2A5 \uBAA8\uB378\uC774 \uC801\uD569\uD569\uB2C8\uB2E4." },
  agentic: { label: "\uC7A5\uC2DC\uAC04 \uC5D0\uC774\uC804\uD2B8", summary: "\uC5EC\uB7EC \uB2E8\uACC4\uB97C \uC624\uB798 \uC218\uD589\uD558\uB294 \uC791\uC5C5\uC774\uB77C \uC5D0\uC774\uC804\uD2B8 \uC218\uD589\uC5D0 \uAC15\uD55C \uBAA8\uB378\uC774 \uC801\uD569\uD569\uB2C8\uB2E4." }
};
var MODEL_ORDER = {
  quick: { codex: ["luna", "terra", "sol"], claude: ["haiku-4.5", "sonnet-5", "opus-5", "fable-5"] },
  writing: { codex: ["luna", "terra", "sol"], claude: ["sonnet-5", "haiku-4.5", "opus-5", "fable-5"] },
  balanced: { codex: ["terra", "luna", "sol"], claude: ["sonnet-5", "haiku-4.5", "opus-5", "fable-5"] },
  advanced: { codex: ["sol", "terra", "luna"], claude: ["opus-5", "sonnet-5", "fable-5", "haiku-4.5"] },
  agentic: { codex: ["sol", "terra", "luna"], claude: ["fable-5", "opus-5", "sonnet-5", "haiku-4.5"] }
};
var REASONS = {
  quick: { codex: "\uC694\uC57D\xB7\uBC88\uC5ED\xB7\uAC00\uBCBC\uC6B4 \uC791\uC131\uC744 \uBE60\uB974\uAC8C \uCC98\uB9AC\uD558\uAE30 \uC88B\uC2B5\uB2C8\uB2E4.", claude: "\uC751\uB2F5 \uC18D\uB3C4\uAC00 \uC911\uC694\uD55C \uAC00\uBCBC\uC6B4 \uC791\uC5C5\uC5D0 \uC798 \uB9DE\uC2B5\uB2C8\uB2E4." },
  writing: { codex: "\uAE00 \uCD08\uC548\xB7\uBB38\uAD6C\xB7\uBC18\uBCF5 \uC791\uC131\uC744 \uBE60\uB974\uAC8C \uB9CC\uB4E4\uAE30 \uC88B\uC2B5\uB2C8\uB2E4.", claude: "\uBB38\uC7A5\uB825\uACFC \uC18D\uB3C4\uC758 \uADE0\uD615\uC774 \uC88B\uC544 \uC644\uC131\uB3C4 \uC788\uB294 \uAE00\uC791\uC131\uC5D0 \uC801\uD569\uD569\uB2C8\uB2E4." },
  balanced: { codex: "\uC77C\uBC18 \uCF54\uB529\uACFC \uBB38\uC11C \uC791\uC5C5\uC5D0\uC11C \uC18D\uB3C4\uC640 \uC131\uB2A5\uC758 \uADE0\uD615\uC774 \uC88B\uC2B5\uB2C8\uB2E4.", claude: "\uAE00\uC4F0\uAE30\xB7\uBD84\uC11D\xB7\uC77C\uBC18 \uC5C5\uBB34\uB97C \uADE0\uD615 \uC788\uAC8C \uCC98\uB9AC\uD569\uB2C8\uB2E4." },
  advanced: { codex: "\uBCF5\uC7A1\uD55C \uCF54\uB4DC \uC218\uC815\xB7\uC124\uACC4\xB7\uB514\uBC84\uAE45\uC5D0 \uAC00\uC7A5 \uC801\uD569\uD569\uB2C8\uB2E4.", claude: "\uACE0\uB09C\uB3C4 \uCF54\uB529\uACFC \uAE4A\uC740 \uBD84\uC11D\uC774 \uD544\uC694\uD55C \uC791\uC5C5\uC5D0 \uC801\uD569\uD569\uB2C8\uB2E4." },
  agentic: { codex: "\uBCF5\uC7A1\uD55C \uB2E4\uB2E8\uACC4 \uC2E4\uD589\uACFC \uACE0\uB09C\uB3C4 \uD310\uB2E8\uC5D0 \uC801\uD569\uD569\uB2C8\uB2E4.", claude: "\uC7A5\uC2DC\uAC04 \uC2E4\uD589\uD558\uB294 \uC5D0\uC774\uC804\uD2B8\uC640 \uBCF5\uD569 \uC791\uC5C5\uC5D0 \uC801\uD569\uD569\uB2C8\uB2E4." }
};
function countMatches(task, terms) {
  return terms.reduce((count, term) => count + (term.test(task) ? 1 : 0), 0);
}
function comparisonSignals(task) {
  const hasFileContext = /(파일|문서|pdf|보고서|기획안|기획서|제안서|자료)/i.test(task);
  const hasComparison = /(비교|대조)/i.test(task);
  const hasMultiplicity = /(두\s*개|두개|2\s*개|여러\s*개|여러개)/i.test(task);
  const hasJudgment = /(더\s*좋|어떤\s*게|어느\s*(것|쪽|게)|우수|선정|평가|장단점|낫(은|다)|추천)/i.test(task);
  const isSimple = /(단순|차이만|변경\s*사항|달라진\s*점)/i.test(task);
  return {
    hasContext: hasFileContext,
    hasComparison,
    hasMultiplicity,
    hasJudgment,
    isSimple
  };
}
var EXECUTION_MODE_LABEL = {
  "chatgpt-chat": "ChatGPT \uCC44\uD305",
  "chatgpt-work": "ChatGPT Work(\uD30C\uC77C \uB2E4\uB8E8\uB294 \uC5D0\uC774\uC804\uD2B8)",
  "codex-cli": "Codex CLI(\uD130\uBBF8\uB110)",
  "claude-chat": "Claude \uCC44\uD305",
  "claude-cowork": "Cowork(\uD30C\uC77C \uB2E4\uB8E8\uB294 \uC5D0\uC774\uC804\uD2B8)",
  "claude-code": "Claude Code(\uD130\uBBF8\uB110)"
};
function determineExecutionMode(task, level) {
  const isCode = countMatches(task, CODE_SIGNAL_TERMS) > 0 || level === "advanced" || level === "agentic";
  if (isCode) return { codex: "codex-cli", claude: "claude-code" };
  const isFileAgent = countMatches(task, FILE_AGENT_TERMS) > 0;
  if (isFileAgent) return { codex: "chatgpt-work", claude: "claude-cowork" };
  return { codex: "chatgpt-chat", claude: "claude-chat" };
}
function resolved(level) {
  return { level, needsClarification: false, kind: null, question: null, options: [] };
}
function analyzeTask(task, selectedLevel) {
  if (selectedLevel) return resolved(selectedLevel);
  const normalized = task.trim();
  if (countMatches(normalized, AGENTIC_TERMS) > 0) return resolved("agentic");
  const comparison = comparisonSignals(normalized);
  const isComparisonTask = comparison.hasContext && (comparison.hasComparison || comparison.hasJudgment);
  if (isComparisonTask && comparison.hasJudgment) return resolved("advanced");
  if (isComparisonTask && comparison.isSimple) return resolved("balanced");
  if (isComparisonTask) {
    return {
      level: "balanced",
      needsClarification: true,
      kind: "comparison-depth",
      question: "\uC5B4\uB290 \uC218\uC900\uC73C\uB85C \uBE44\uAD50\uD560\uAE4C\uC694?",
      options: [
        { level: "balanced", label: "\uB2E8\uC21C \uCC28\uC774 \uD655\uC778", description: "\uBCC0\uACBD\uC810\uACFC \uCC28\uC774\uB97C \uBE60\uB974\uAC8C \uC815\uB9AC\uD569\uB2C8\uB2E4." },
        { level: "advanced", label: "\uC7A5\uB2E8\uC810\xB7\uC6B0\uC218\uC548 \uC120\uC815", description: "\uAE30\uC900\uC744 \uC138\uC6CC \uAE4A\uAC8C \uBD84\uC11D\uD558\uACE0 \uB354 \uC88B\uC740 \uC548\uC744 \uACE0\uB985\uB2C8\uB2E4." },
        { level: "agentic", label: "\uB300\uB7C9\xB7\uC7A5\uC2DC\uAC04 \uCC98\uB9AC", description: "\uB9CE\uC740 \uD30C\uC77C\uC744 \uC624\uB798 \uBC18\uBCF5 \uBD84\uC11D\uD569\uB2C8\uB2E4." }
      ]
    };
  }
  if (countMatches(normalized, STRONG_ADVANCED_TERMS) > 0) return resolved("advanced");
  const advanced = countMatches(task, ADVANCED_TERMS);
  const quick = countMatches(task, QUICK_TERMS);
  if (advanced >= 2) return resolved("advanced");
  if (countMatches(normalized, WRITING_TERMS) > 0) return resolved("writing");
  if (quick > 0 && advanced === 0) return resolved("quick");
  return {
    level: "balanced",
    needsClarification: true,
    kind: "depth",
    question: "\uC5B4\uB5A4 \uC218\uC900\uC73C\uB85C \uC9C4\uD589\uD560\uAE4C\uC694?",
    options: [
      { level: "quick", label: "\uBE60\uB974\uAC8C", description: "\uAC00\uBCBC\uC6B4 \uCD08\uC548\uACFC \uD575\uC2EC\uB9CC \uBC1B\uC2B5\uB2C8\uB2E4." },
      { level: "balanced", label: "\uADE0\uD615 \uC788\uAC8C", description: "\uC18D\uB3C4\uC640 \uD488\uC9C8\uC744 \uADE0\uD615 \uC788\uAC8C \uAC00\uC838\uAC11\uB2C8\uB2E4." },
      { level: "advanced", label: "\uAE4A\uACE0 \uC815\uD655\uD558\uAC8C", description: "\uB354 \uAE4A\uC740 \uBD84\uC11D\uACFC \uACE0\uD488\uC9C8 \uACB0\uACFC\uB97C \uC6B0\uC120\uD569\uB2C8\uB2E4." },
      { level: "agentic", label: "\uC7A5\uC2DC\uAC04 \uB9E1\uAE30\uAE30", description: "\uC5EC\uB7EC \uB2E8\uACC4\uB97C \uC624\uB798 \uC218\uD589\uD558\uB294 \uC791\uC5C5\uC785\uB2C8\uB2E4." }
    ]
  };
}
function recommendModels(task, models = DEFAULT_MODELS, selectedLevel) {
  var _a;
  const level = selectedLevel != null ? selectedLevel : analyzeTask(task).level;
  const enabled = models.filter((model) => model.enabled);
  const recommendations = [];
  const unavailableSources = [];
  const executionModes = determineExecutionMode(task, level);
  for (const source of ["codex", "claude"]) {
    const order = MODEL_ORDER[level][source];
    const model = (_a = order.map((id) => enabled.find((candidate) => candidate.source === source && candidate.id === id)).find((candidate) => Boolean(candidate))) != null ? _a : enabled.find((candidate) => candidate.source === source);
    if (!model) {
      unavailableSources.push(source);
      continue;
    }
    const executionMode = executionModes[source];
    recommendations.push({
      source,
      model: model.id,
      label: model.label,
      description: model.description,
      reason: REASONS[level][source],
      executionMode,
      executionModeLabel: EXECUTION_MODE_LABEL[executionMode]
    });
  }
  return {
    level,
    levelLabel: LEVEL_COPY[level].label,
    summary: LEVEL_COPY[level].summary,
    recommendations,
    unavailableSources
  };
}

// src/modals.ts
var sourceLabel = (source) => source === "codex" ? "Codex" : source === "claude" ? "Claude" : source;
var SaveConversationModal = class extends import_obsidian.Modal {
  constructor(app, options) {
    super(app);
    __publicField(this, "options", options);
    __publicField(this, "targetSelect");
    __publicField(this, "titleInput");
    __publicField(this, "titleSetting");
    __publicField(this, "sourceSelect");
    __publicField(this, "modelSelect");
    __publicField(this, "modelDescription");
    __publicField(this, "recommendationSelect");
    __publicField(this, "summaryInput");
    __publicField(this, "errorEl");
    __publicField(this, "outcomeButtons", []);
    __publicField(this, "busy", false);
  }
  onOpen() {
    this.modalEl.addClass("ai-saver-modal");
    this.titleEl.setText("AI \uB300\uD654 \uC800\uC7A5");
    this.contentEl.createEl("p", {
      text: "\uD074\uB9BD\uBCF4\uB4DC \uC6D0\uBB38\uC740 \uAD50\uCCB4\uD558\uC9C0 \uC54A\uACE0 \uC0C8 \uB9AC\uBE44\uC804\uC73C\uB85C \uCD94\uAC00\uD569\uB2C8\uB2E4.",
      cls: "ai-saver-lead"
    });
    new import_obsidian.Setting(this.contentEl).setName("\uB300\uD654 \uB178\uD2B8 \uCC3E\uAE30").setDesc("\uD604\uC7AC \uB178\uD2B8\uC640 \uCD5C\uADFC 24\uC2DC\uAC04 \uB178\uD2B8\uAC00 \uBA3C\uC800 \uD45C\uC2DC\uB429\uB2C8\uB2E4.").addSearch((search) => search.setPlaceholder("\uC81C\uBAA9 \uAC80\uC0C9").onChange((query) => this.renderCandidates(query)));
    new import_obsidian.Setting(this.contentEl).setName("\uC800\uC7A5 \uB300\uC0C1").addDropdown((dropdown) => {
      this.targetSelect = dropdown.selectEl;
      dropdown.onChange(() => this.updateTargetMode());
    });
    this.titleSetting = new import_obsidian.Setting(this.contentEl).setName("\uC0C8 \uB178\uD2B8 \uC81C\uBAA9").setDesc("\uB0A0\uC9DC \uC811\uB450\uC0AC\uB294 \uBD99\uC9C0 \uC54A\uC73C\uBA70 \uC800\uC7A5 \uC804\uC5D0 \uC9C1\uC811 \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.").addText((text) => {
      this.titleInput = text.inputEl;
      text.setValue(this.options.suggestedTitle).setPlaceholder("\uB300\uD654 \uC81C\uBAA9");
    });
    new import_obsidian.Setting(this.contentEl).setName("\uACF5\uAE09\uC790").addDropdown((dropdown) => {
      var _a;
      this.sourceSelect = dropdown.selectEl;
      dropdown.addOption("", "\uC120\uD0DD\uD558\uC138\uC694");
      for (const source of [...new Set(this.options.models.filter((model) => model.enabled).map((model) => model.source))]) {
        dropdown.addOption(source, sourceLabel(source));
      }
      dropdown.setValue((_a = this.options.lastSource) != null ? _a : "");
      dropdown.onChange(() => {
        this.renderModels();
        this.renderRecommendationOptions();
      });
    });
    const modelSetting = new import_obsidian.Setting(this.contentEl).setName("\uC0AC\uC6A9 \uBAA8\uB378").addDropdown((dropdown) => {
      this.modelSelect = dropdown.selectEl;
      dropdown.onChange(() => this.updateModelDescription());
    });
    this.modelDescription = modelSetting.descEl;
    new import_obsidian.Setting(this.contentEl).setName("\uCD94\uCC9C \uB2E8\uACC4").setDesc("\uCD94\uCC9C \uCD9C\uCC98\uB97C \uD655\uC778\uD558\uACE0 \uC2E4\uC81C \uC791\uC5C5\uC5D0 \uB9DE\uAC8C \uBC14\uAFC0 \uC218 \uC788\uC2B5\uB2C8\uB2E4.").addDropdown((dropdown) => {
      this.recommendationSelect = dropdown.selectEl;
      dropdown.onChange(() => this.applyRecommendationModel());
    });
    new import_obsidian.Setting(this.contentEl).setName("\uD55C \uC904 \uBA54\uBAA8").setDesc("\uC774\uBC88 \uB300\uD654\uC5D0\uC11C \uC5BB\uC740 \uACB0\uB860\uC774\uB098 \uB2E4\uC74C \uD589\uB3D9\uC744 200\uC790 \uC548\uC73C\uB85C \uC801\uC2B5\uB2C8\uB2E4.").addText((text) => {
      this.summaryInput = text.inputEl;
      text.setPlaceholder("\uC608: \uBC30\uC1A1\uBE44 \uD45C\uC2DC \uC2DC\uC810\uC744 \uACB0\uC81C \uB2E8\uACC4\uB85C \uC62E\uAE30\uAE30\uB85C \uD568").onChange(() => this.updateOutcomeLabels());
    });
    this.errorEl = this.contentEl.createDiv({ cls: "ai-saver-error" });
    this.errorEl.setAttr("aria-live", "assertive");
    const actions = this.contentEl.createDiv({ cls: "ai-saver-outcomes" });
    const outcomes = [
      ["good", "\uC88B\uC74C\uC73C\uB85C \uC800\uC7A5", "Alt+1"],
      ["mixed", "\uBCF4\uD1B5\uC73C\uB85C \uC800\uC7A5", "Alt+2"],
      ["bad", "\uB098\uC068\uC73C\uB85C \uC800\uC7A5", "Alt+3"]
    ];
    for (const [outcome, label, shortcut] of outcomes) {
      const button = actions.createEl("button", { text: label, cls: `ai-saver-outcome ai-saver-${outcome}` });
      button.setAttr("type", "button");
      button.setAttr("aria-keyshortcuts", shortcut);
      button.addEventListener("click", () => void this.submit(outcome));
      this.outcomeButtons.push({ button, outcome });
    }
    this.contentEl.addEventListener("keydown", (event) => {
      if (!event.altKey || this.busy) return;
      const outcome = event.key === "1" ? "good" : event.key === "2" ? "mixed" : event.key === "3" ? "bad" : null;
      if (outcome) {
        event.preventDefault();
        void this.submit(outcome);
      }
    });
    this.renderCandidates("");
    this.renderModels();
    this.updateTargetMode();
    this.updateOutcomeLabels();
    window.setTimeout(() => this.summaryInput.focus(), 0);
  }
  renderCandidates(query) {
    var _a, _b;
    const previous = this.targetSelect.value;
    this.targetSelect.empty();
    const normalized = query.trim().toLocaleLowerCase();
    const filtered = this.options.candidates.filter((candidate) => candidate.basename.toLocaleLowerCase().includes(normalized));
    for (const candidate of filtered) {
      const prefix = candidate.group === "current" ? "\uD604\uC7AC \xB7 " : candidate.group === "recent" ? "\uCD5C\uADFC \xB7 " : "";
      this.targetSelect.add(new Option(`${prefix}${candidate.basename}`, candidate.path));
    }
    this.targetSelect.add(new Option("\uFF0B \uC0C8 \uB178\uD2B8 \uB9CC\uB4E4\uAE30", "__new__"));
    const canRestore = Array.from(this.targetSelect.options).some((option) => option.value === previous);
    this.targetSelect.value = canRestore ? previous : (_b = (_a = filtered[0]) == null ? void 0 : _a.path) != null ? _b : "__new__";
    this.updateTargetMode();
  }
  updateTargetMode() {
    if (!this.titleSetting) return;
    const isNew = this.targetSelect.value === "__new__";
    this.titleSetting.settingEl.toggleClass("ai-saver-hidden", !isNew);
    this.renderRecommendationOptions();
  }
  renderModels() {
    var _a;
    if (!this.modelSelect || !this.sourceSelect) return;
    const source = this.sourceSelect.value;
    this.modelSelect.empty();
    this.modelSelect.add(new Option("\uC120\uD0DD\uD558\uC138\uC694", ""));
    for (const model of this.options.models.filter((item) => item.enabled && item.source === source)) {
      this.modelSelect.add(new Option(model.label, model.id));
    }
    const previous = (_a = this.options.lastModel[source]) != null ? _a : "";
    if (Array.from(this.modelSelect.options).some((option) => option.value === previous)) this.modelSelect.value = previous;
    this.updateModelDescription();
  }
  updateModelDescription() {
    var _a;
    if (!this.modelDescription || !this.modelSelect || !this.sourceSelect) return;
    const model = this.options.models.find((item) => item.source === this.sourceSelect.value && item.id === this.modelSelect.value);
    this.modelDescription.setText((_a = model == null ? void 0 : model.description) != null ? _a : "\uBC29\uAE08 \uC0AC\uC6A9\uD55C \uBAA8\uB378\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
  }
  renderRecommendationOptions() {
    if (!this.recommendationSelect || !this.sourceSelect || !this.targetSelect) return;
    const source = this.sourceSelect.value;
    this.recommendationSelect.empty();
    this.recommendationSelect.add(new Option("unknown \xB7 \uCD94\uCC9C \uAE30\uB85D \uC0AC\uC6A9 \uC548 \uD568", "unknown"));
    if (source !== "codex" && source !== "claude") {
      this.recommendationSelect.value = "unknown";
      return;
    }
    const target = this.options.candidates.find((candidate) => candidate.path === this.targetSelect.value);
    const previous = (target == null ? void 0 : target.lastSource) === source && target.lastRecommendationLevel && target.lastSavedAt ? { recommendationLevel: target.lastRecommendationLevel, savedAt: target.lastSavedAt } : null;
    const choices = recommendationChoices(this.options.pendingRecommendations, source, Date.now(), previous);
    for (const item of choices.fresh) {
      this.recommendationSelect.add(new Option(
        `${item.recommendationLevel} \xB7 ${item.recommendedModel} \xB7 ${this.ageLabel(item.recommendedAt)} \xB7 ${item.taskExcerpt}`,
        `pending:${item.id}`
      ));
    }
    for (const item of choices.stale) {
      this.recommendationSelect.add(new Option(
        `${item.recommendationLevel} \xB7 \uC9C0\uB09C \uCD94\uCC9C \xB7 ${this.ageLabel(item.recommendedAt)} \xB7 ${item.taskExcerpt}`,
        `pending:${item.id}`
      ));
    }
    if (previous) {
      this.recommendationSelect.add(new Option(
        `${previous.recommendationLevel} \xB7 \uC9C1\uC804 \uB9AC\uBE44\uC804\uC5D0\uC11C \uAC00\uC838\uC634 \xB7 ${previous.savedAt.slice(0, 10)} \uC800\uC7A5`,
        "previous"
      ));
    }
    this.recommendationSelect.value = choices.defaultPendingId ? `pending:${choices.defaultPendingId}` : "unknown";
    this.applyRecommendationModel();
  }
  applyRecommendationModel() {
    var _a, _b;
    const value = (_b = (_a = this.recommendationSelect) == null ? void 0 : _a.value) != null ? _b : "unknown";
    if (!value.startsWith("pending:")) return;
    const item = this.options.pendingRecommendations.find((candidate) => candidate.id === value.slice(8));
    if (!item || item.source !== this.sourceSelect.value) return;
    if (Array.from(this.modelSelect.options).some((option) => option.value === item.recommendedModel)) {
      this.modelSelect.value = item.recommendedModel;
      this.updateModelDescription();
    }
  }
  selectedRecommendation() {
    var _a;
    const value = this.recommendationSelect.value;
    if (value.startsWith("pending:")) {
      const pendingId = value.slice(8);
      const item = this.options.pendingRecommendations.find((candidate) => candidate.id === pendingId);
      if (item) return { level: item.recommendationLevel, pendingId };
    }
    if (value === "previous") {
      const target = this.options.candidates.find((candidate) => candidate.path === this.targetSelect.value);
      return { level: (_a = target == null ? void 0 : target.lastRecommendationLevel) != null ? _a : "unknown", pendingId: null };
    }
    return { level: "unknown", pendingId: null };
  }
  ageLabel(iso) {
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 6e4));
    if (minutes < 60) return `${minutes}\uBD84 \uC804`;
    return `${Math.floor(minutes / 60)}\uC2DC\uAC04 \uC804`;
  }
  updateOutcomeLabels() {
    var _a, _b;
    const summary = (_b = (_a = this.summaryInput) == null ? void 0 : _a.value) != null ? _b : "";
    for (const entry of this.outcomeButtons) entry.button.setText(saveButtonLabel(entry.outcome, summary));
  }
  async submit(outcome) {
    if (this.busy) return;
    const source = this.sourceSelect.value;
    const model = this.modelSelect.value;
    const targetPath = this.targetSelect.value === "__new__" ? null : this.targetSelect.value;
    const title = this.titleInput.value;
    const recommendation = this.selectedRecommendation();
    const summary = normalizeSummary(this.summaryInput.value).value;
    if (!source) return this.showError("\uACF5\uAE09\uC790\uB97C \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
    if (!model) return this.showError("\uC0AC\uC6A9\uD55C \uBAA8\uB378\uC744 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
    if (targetPath === null && title.trim() === "") return this.showError("\uC0C8 \uB178\uD2B8 \uC81C\uBAA9\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694.");
    this.busy = true;
    this.setButtonsDisabled(true);
    this.showError("");
    try {
      await this.options.onSave({
        targetPath,
        title,
        source,
        model,
        outcome,
        recommendationLevel: recommendation.level,
        summary,
        pendingRecommendationId: recommendation.pendingId
      });
      this.close();
    } catch (error) {
      this.showError(error instanceof Error ? error.message : "\uC800\uC7A5 \uC911 \uC54C \uC218 \uC5C6\uB294 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.");
    } finally {
      this.busy = false;
      this.setButtonsDisabled(false);
    }
  }
  setButtonsDisabled(disabled) {
    for (const entry of this.outcomeButtons) entry.button.disabled = disabled;
  }
  showError(message) {
    this.errorEl.setText(message);
    this.errorEl.toggleClass("is-visible", message !== "");
  }
};
var TaskRecommendationModal = class extends import_obsidian.Modal {
  constructor(app, models, onOpenApp) {
    super(app);
    __publicField(this, "models", models);
    __publicField(this, "onOpenApp", onOpenApp);
    __publicField(this, "selectedLevel", null);
    __publicField(this, "task", "");
    __publicField(this, "errorEl");
    __publicField(this, "resultEl");
  }
  onOpen() {
    this.modalEl.addClass("ai-saver-modal", "ai-recommender-modal");
    this.titleEl.setText("AI \uC791\uC5C5 \uBAA8\uB378 \uCD94\uCC9C");
    this.contentEl.createEl("p", {
      text: "\uD558\uB824\uB294 \uC77C\uC744 \uC801\uC73C\uBA74 API \uBE44\uC6A9 \uC5C6\uC774 Codex\uC640 Claude \uBAA8\uB378\uC744 \uCD94\uCC9C\uD569\uB2C8\uB2E4.",
      cls: "ai-saver-lead"
    });
    new import_obsidian.Setting(this.contentEl).setName("\uBB34\uC5C7\uC744 \uD558\uB824 \uD558\uB098\uC694?").setDesc("\uBAA9\uD45C\xB7\uB09C\uC774\uB3C4\xB7\uC791\uC5C5 \uBC94\uC704\uB97C \uAD6C\uCCB4\uC801\uC73C\uB85C \uC801\uC73C\uBA74 \uCD94\uCC9C\uC774 \uB354 \uC815\uD655\uD569\uB2C8\uB2E4.").addTextArea((text) => {
      text.inputEl.rows = 5;
      text.inputEl.addClass("ai-recommender-input");
      text.setPlaceholder("\uC608: \uC5EC\uB7EC \uD30C\uC77C\uC758 \uACB0\uC81C \uCF54\uB4DC\uB97C \uB9AC\uD329\uD130\uB9C1\uD558\uACE0 \uBC84\uADF8\uB97C \uCC3E\uC544\uC918").onChange((value) => {
        this.task = value;
        this.selectedLevel = null;
        if (value.trim()) this.showError("");
        if (this.resultEl) {
          this.resultEl.empty();
          this.resultEl.addClass("ai-saver-hidden");
        }
      });
      window.setTimeout(() => text.inputEl.focus(), 0);
    });
    this.errorEl = this.contentEl.createDiv({ cls: "ai-saver-error" });
    this.errorEl.setAttr("aria-live", "assertive");
    this.resultEl = this.contentEl.createDiv({ cls: "ai-recommender-results ai-saver-hidden" });
    this.resultEl.setAttr("aria-live", "polite");
    const actions = this.contentEl.createDiv({ cls: "ai-saver-dialog-actions" });
    const closeButton = actions.createEl("button", { text: "\uB2EB\uAE30" });
    closeButton.setAttr("type", "button");
    closeButton.addEventListener("click", () => this.close());
    const recommendButton = actions.createEl("button", { text: "\uBAA8\uB378 \uCD94\uCC9C\uBC1B\uAE30", cls: "mod-cta" });
    recommendButton.setAttr("type", "button");
    recommendButton.addEventListener("click", () => this.renderRecommendation());
    this.contentEl.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        this.renderRecommendation();
      }
    });
  }
  renderRecommendation() {
    var _a;
    if (!this.task.trim()) {
      this.showError("\uD558\uB824\uB294 \uC77C\uC744 \uBA3C\uC800 \uC801\uC5B4 \uC8FC\uC138\uC694.");
      return;
    }
    const analysis = analyzeTask(this.task, (_a = this.selectedLevel) != null ? _a : void 0);
    if (analysis.needsClarification) {
      this.renderClarification(analysis);
      return;
    }
    this.renderRecommendationResult(analysis.level);
  }
  renderClarification(analysis) {
    var _a;
    this.showError("");
    this.resultEl.empty();
    this.resultEl.removeClass("ai-saver-hidden");
    this.resultEl.createEl("h3", { text: (_a = analysis.question) != null ? _a : "\uC791\uC5C5 \uC218\uC900\uC744 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.", cls: "ai-recommender-question" });
    this.resultEl.createEl("p", {
      text: "\uD55C \uBC88\uB9CC \uC120\uD0DD\uD558\uBA74 \uC801\uD569\uD55C Codex\xB7Claude \uBAA8\uB378\uC744 \uBC14\uB85C \uBCF4\uC5EC\uC90D\uB2C8\uB2E4.",
      cls: "ai-saver-lead"
    });
    const choices = this.resultEl.createDiv({ cls: "ai-recommender-choices" });
    for (const option of analysis.options) {
      const button = choices.createEl("button", { cls: "ai-recommender-choice" });
      button.setAttr("type", "button");
      button.createEl("strong", { text: option.label });
      button.createEl("span", { text: option.description });
      button.addEventListener("click", () => {
        this.selectedLevel = option.level;
        this.renderRecommendationResult(option.level);
      });
    }
  }
  renderRecommendationResult(level) {
    const result = recommendModels(this.task, this.models, level);
    if (result.unavailableSources.length > 0) {
      const providers = result.unavailableSources.map((source) => source === "codex" ? "Codex" : "Claude").join("\xB7");
      this.resultEl.empty();
      this.resultEl.addClass("ai-saver-hidden");
      this.showError(`${providers}\uC5D0\uC11C \uD65C\uC131\uD654\uB41C \uBAA8\uB378\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uD50C\uB7EC\uADF8\uC778 \uC124\uC815\uC5D0\uC11C \uBAA8\uB378\uC744 \uCF1C \uC8FC\uC138\uC694.`);
      return;
    }
    this.showError("");
    this.resultEl.empty();
    this.resultEl.removeClass("ai-saver-hidden");
    const heading = this.resultEl.createDiv({ cls: "ai-recommender-heading" });
    heading.createSpan({ text: result.levelLabel, cls: `ai-recommender-level is-${result.level}` });
    heading.createEl("p", { text: result.summary });
    const cards = this.resultEl.createDiv({ cls: "ai-recommender-cards" });
    for (const recommendation of result.recommendations) {
      const card = cards.createDiv({ cls: "ai-recommender-card" });
      card.createDiv({
        text: recommendation.source === "codex" ? "Codex \uCD94\uCC9C" : "Claude \uCD94\uCC9C",
        cls: "ai-recommender-source"
      });
      card.createEl("h3", { text: recommendation.label });
      card.createDiv({ text: recommendation.executionModeLabel, cls: "ai-recommender-execution-mode" });
      card.createEl("p", { text: recommendation.reason, cls: "ai-recommender-reason" });
      card.createEl("p", { text: recommendation.description, cls: "setting-item-description" });
      const openButton = card.createEl("button", {
        text: recommendation.source === "codex" ? "Codex \uC5F4\uAE30" : "Claude \uC5F4\uAE30",
        cls: "ai-recommender-open"
      });
      openButton.setAttr("type", "button");
      openButton.addEventListener("click", () => void this.openApp(
        recommendation.source,
        recommendation.model,
        level,
        openButton
      ));
    }
  }
  async openApp(source, model, level, button) {
    button.disabled = true;
    this.showError("");
    try {
      await this.onOpenApp({ source, model, level, task: this.task });
    } catch (error) {
      this.showError(error instanceof Error ? error.message : "AI \uC571\uC744 \uC5F4\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    } finally {
      button.disabled = false;
    }
  }
  showError(message) {
    this.errorEl.setText(message);
    this.errorEl.toggleClass("is-visible", message !== "");
  }
};
var CollisionModal = class extends import_obsidian.Modal {
  constructor(app, title, canAppend, resolveChoice) {
    super(app);
    __publicField(this, "title", title);
    __publicField(this, "canAppend", canAppend);
    __publicField(this, "resolveChoice", resolveChoice);
    __publicField(this, "settled", false);
  }
  onOpen() {
    this.titleEl.setText("\uAC19\uC740 \uC81C\uBAA9\uC758 \uB178\uD2B8\uAC00 \uC788\uC2B5\uB2C8\uB2E4");
    this.contentEl.createEl("p", { text: `\u201C${this.title}\u201D \uD30C\uC77C\uC774 \uC774\uBBF8 \uC874\uC7AC\uD569\uB2C8\uB2E4.` });
    const actions = this.contentEl.createDiv({ cls: "ai-saver-dialog-actions" });
    if (this.canAppend) this.addButton(actions, "\uAE30\uC874 \uB178\uD2B8\uC5D0 \uCD94\uAC00", "append", true);
    this.addButton(actions, "\uC22B\uC790 \uC811\uBBF8\uC0AC\uB85C \uC0C8 \uB178\uD2B8", "suffix", !this.canAppend);
    this.addButton(actions, "\uCDE8\uC18C", "cancel", false);
  }
  onClose() {
    if (!this.settled) this.resolveChoice("cancel");
    this.contentEl.empty();
  }
  addButton(container, label, choice, primary) {
    const button = container.createEl("button", { text: label, cls: primary ? "mod-cta" : "" });
    button.addEventListener("click", () => {
      this.settled = true;
      this.resolveChoice(choice);
      this.close();
    });
  }
};
var CorrectionModal = class extends import_obsidian.Modal {
  constructor(app, revisions, onApply) {
    super(app);
    __publicField(this, "revisions", revisions);
    __publicField(this, "onApply", onApply);
  }
  onOpen() {
    this.titleEl.setText("\uB9AC\uBE44\uC804 \uC720\uD6A8\uC131 \uBCC0\uACBD");
    let selected = this.revisions.at(-1);
    let reason = "";
    const state = this.contentEl.createEl("p", { cls: "setting-item-description" });
    const updateState = () => state.setText((selected == null ? void 0 : selected.voided) ? "\uD604\uC7AC \uBB34\uD6A8 \xB7 \uBCF5\uC6D0 \uC774\uBCA4\uD2B8\uB97C \uCD94\uAC00\uD569\uB2C8\uB2E4." : "\uD604\uC7AC \uC720\uD6A8 \xB7 \uBB34\uD6A8 \uC774\uBCA4\uD2B8\uB97C \uCD94\uAC00\uD569\uB2C8\uB2E4.");
    new import_obsidian.Setting(this.contentEl).setName("\uB300\uC0C1 \uB9AC\uBE44\uC804").addDropdown((dropdown) => {
      for (const revision of this.revisions) {
        dropdown.addOption(String(revision.rev), `revision ${revision.rev} \xB7 ${revision.model} \xB7 ${revision.outcome}${revision.voided ? " \xB7 \uBB34\uD6A8" : ""}`);
      }
      if (selected) dropdown.setValue(String(selected.rev));
      dropdown.onChange((value) => {
        selected = this.revisions.find((revision) => revision.rev === Number(value));
        updateState();
      });
    });
    new import_obsidian.Setting(this.contentEl).setName("\uC0AC\uC720 (\uC120\uD0DD)").addText((text) => text.onChange((value) => {
      reason = value;
    }));
    updateState();
    const button = this.contentEl.createEl("button", { text: "\uC815\uC815 \uC774\uBCA4\uD2B8 \uCD94\uAC00", cls: "mod-cta" });
    button.addEventListener("click", async () => {
      if (!selected) return;
      button.disabled = true;
      try {
        await this.onApply({ targetRev: selected.rev, action: selected.voided ? "restore" : "void", reason });
        this.close();
      } finally {
        button.disabled = false;
      }
    });
  }
};
var SummaryCorrectionModal = class extends import_obsidian.Modal {
  constructor(app, revisions, onApply) {
    super(app);
    __publicField(this, "revisions", revisions);
    __publicField(this, "onApply", onApply);
  }
  onOpen() {
    var _a;
    this.titleEl.setText("\uD55C \uC904 \uBA54\uBAA8 \uBCF4\uC644");
    const ordered = [...this.revisions].sort((left, right) => Number(left.voided) - Number(right.voided) || Number(left.summary !== "") - Number(right.summary !== "") || right.rev - left.rev);
    let selected = ordered[0];
    let summary = (_a = selected == null ? void 0 : selected.summary) != null ? _a : "";
    let summaryInput = null;
    new import_obsidian.Setting(this.contentEl).setName("\uB300\uC0C1 \uB9AC\uBE44\uC804").addDropdown((dropdown) => {
      for (const revision of ordered) {
        dropdown.addOption(
          String(revision.rev),
          `revision ${revision.rev} \xB7 ${revision.model} \xB7 ${revision.summary === "" ? "\uBA54\uBAA8 \uC5C6\uC74C" : revision.summary}`
        );
      }
      if (selected) dropdown.setValue(String(selected.rev));
      dropdown.onChange((value) => {
        var _a2;
        selected = ordered.find((revision) => revision.rev === Number(value));
        summary = (_a2 = selected == null ? void 0 : selected.summary) != null ? _a2 : "";
        if (summaryInput) summaryInput.value = summary;
      });
    });
    new import_obsidian.Setting(this.contentEl).setName("\uD55C \uC904 \uBA54\uBAA8").addText((text) => {
      summaryInput = text.inputEl;
      text.setValue(summary).setPlaceholder("\uC774\uBC88 \uB9AC\uBE44\uC804\uC758 \uACB0\uB860\uC774\uB098 \uB2E4\uC74C \uD589\uB3D9").onChange((value) => {
        summary = value;
      });
      window.setTimeout(() => text.inputEl.focus(), 0);
    });
    const errorEl = this.contentEl.createDiv({ cls: "ai-saver-error" });
    errorEl.setAttr("aria-live", "assertive");
    const button = this.contentEl.createEl("button", { text: "\uBA54\uBAA8 \uC815\uC815 \uC774\uBCA4\uD2B8 \uCD94\uAC00", cls: "mod-cta" });
    button.addEventListener("click", async () => {
      if (!selected) return;
      button.disabled = true;
      try {
        await this.onApply({ targetRev: selected.rev, summary });
        this.close();
      } catch (error) {
        errorEl.setText(error instanceof Error ? error.message : "\uD55C \uC904 \uBA54\uBAA8\uB97C \uBCF4\uC644\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
        errorEl.addClass("is-visible");
      } finally {
        button.disabled = false;
      }
    });
  }
};
var RecoveryModal = class extends import_obsidian.Modal {
  constructor(app, message, actions) {
    super(app);
    __publicField(this, "message", message);
    __publicField(this, "actions", actions);
  }
  onOpen() {
    this.titleEl.setText("\uC6D0\uBB38\uC744 \uC800\uC7A5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4");
    this.contentEl.createEl("p", { text: this.message });
    this.contentEl.createEl("p", { text: "\uC6D0\uBB38\uC740 \uC774 \uCC3D\uC774 \uC5F4\uB824 \uC788\uB294 \uB3D9\uC548 \uBA54\uBAA8\uB9AC\uC5D0 \uC720\uC9C0\uB429\uB2C8\uB2E4.", cls: "setting-item-description" });
    const actions = this.contentEl.createDiv({ cls: "ai-saver-dialog-actions" });
    this.addAsyncButton(actions, "\uB2E4\uC2DC \uC2DC\uB3C4", async () => {
      await this.actions.retry();
      this.close();
    }, true);
    this.addAsyncButton(actions, "\uC6D0\uBB38 \uBCF5\uC0AC", () => this.actions.copy(), false);
    this.addAsyncButton(actions, "\uBCF5\uAD6C \uD30C\uC77C\uB85C \uB0B4\uBCF4\uB0B4\uAE30", () => this.actions.export(), false);
    const cancel = actions.createEl("button", { text: "\uCDE8\uC18C" });
    cancel.addEventListener("click", () => this.close());
  }
  addAsyncButton(container, label, action, primary) {
    const button = container.createEl("button", { text: label, cls: primary ? "mod-cta" : "" });
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await action();
      } finally {
        button.disabled = false;
      }
    });
  }
};
var ImportModal = class extends import_obsidian.Modal {
  constructor(app, onSubmit) {
    super(app);
    __publicField(this, "onSubmit", onSubmit);
    __publicField(this, "provider", "claude");
    __publicField(this, "path", "");
  }
  onOpen() {
    this.titleEl.setText("\uACFC\uAC70 \uB300\uD654 \uAC00\uC838\uC624\uAE30");
    this.contentEl.createEl("p", {
      text: "Claude \uB610\uB294 ChatGPT \uACC4\uC815 \uC124\uC815\uC5D0\uC11C \uBC1B\uC740 \uACF5\uC2DD \uB370\uC774\uD130 \uB0B4\uBCF4\uB0B4\uAE30\uC758 conversations.json \uD30C\uC77C\uC744 \uBCFC\uD2B8 \uC548\uC5D0 \uBA3C\uC800 \uC62E\uACA8 \uB450\uC138\uC694.",
      cls: "setting-item-description"
    });
    new import_obsidian.Setting(this.contentEl).setName("\uC5B4\uB290 \uC11C\uBE44\uC2A4\uC758 \uB0B4\uBCF4\uB0B4\uAE30\uC778\uAC00\uC694").addDropdown((dropdown) => dropdown.addOption("claude", "Claude").addOption("chatgpt", "ChatGPT (Codex)").setValue(this.provider).onChange((value) => {
      this.provider = value === "chatgpt" ? "chatgpt" : "claude";
    }));
    new import_obsidian.Setting(this.contentEl).setName("\uBCFC\uD2B8 \uC548 conversations.json \uACBD\uB85C").setDesc("\uC608: 99-\uAC00\uC838\uC624\uAE30/conversations.json").addText((text) => text.setPlaceholder("99-\uAC00\uC838\uC624\uAE30/conversations.json").onChange((value) => {
      this.path = value.trim();
    }));
    const actions = this.contentEl.createDiv({ cls: "ai-saver-dialog-actions" });
    const submit = actions.createEl("button", { text: "\uAC00\uC838\uC624\uAE30 \uC2DC\uC791", cls: "mod-cta" });
    submit.addEventListener("click", () => {
      if (this.path === "") return;
      this.onSubmit({ provider: this.provider, vaultPath: this.path });
      this.close();
    });
    const cancel = actions.createEl("button", { text: "\uCDE8\uC18C" });
    cancel.addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/importers/claude-export.ts
var ROLE_LABEL = {
  human: "\uC0AC\uC6A9\uC790",
  assistant: "AI"
};
function parseClaudeExport(raw) {
  const conversations = [];
  const errors = [];
  const list = Array.isArray(raw) ? raw : null;
  if (!list) {
    errors.push("\uCD5C\uC0C1\uC704\uAC00 \uBC30\uC5F4\uC774 \uC544\uB2D9\uB2C8\uB2E4. Claude \uACF5\uC2DD \uB0B4\uBCF4\uB0B4\uAE30\uC758 conversations.json \uD615\uC2DD\uC774 \uC544\uB2D0 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
    return { conversations, errors };
  }
  list.forEach((entry, index) => {
    var _a, _b;
    const label = `\uB300\uD654 ${index + 1}`;
    try {
      const conv = entry;
      const messages = Array.isArray(conv.chat_messages) ? conv.chat_messages : null;
      if (!messages) throw new Error("chat_messages \uBC30\uC5F4\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
      const lines = [];
      let firstHumanText = "";
      for (const rawMessage of messages) {
        const message = rawMessage;
        const role = typeof message.sender === "string" ? message.sender : "";
        const text = extractText(message);
        if (text === "") continue;
        if (role === "human" && firstHumanText === "") firstHumanText = text;
        const roleLabel = (_a = ROLE_LABEL[role]) != null ? _a : role || "\uC54C \uC218 \uC5C6\uC74C";
        lines.push(`${roleLabel}: ${text}`);
      }
      if (lines.length === 0) throw new Error("\uCD94\uCD9C\uB41C \uBA54\uC2DC\uC9C0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
      const rawTitle = typeof conv.name === "string" ? conv.name.trim() : "";
      const title = rawTitle !== "" && rawTitle.toLowerCase() !== "untitled" ? rawTitle : Array.from(firstHumanText).slice(0, 40).join("") || `\uAC00\uC838\uC628 \uB300\uD654 ${index + 1}`;
      const savedAt = (_b = normalizeTimestamp(conv.created_at)) != null ? _b : normalizeTimestamp(conv.updated_at);
      if (!savedAt) throw new Error("\uC800\uC7A5 \uC2DC\uAC01\uC744 \uD574\uC11D\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
      conversations.push({ source: "claude", title, savedAt, transcript: lines.join("\n\n") });
    } catch (error) {
      errors.push(`${label}: ${error instanceof Error ? error.message : "\uC54C \uC218 \uC5C6\uB294 \uC624\uB958\uB85C \uAC74\uB108\uB700"}`);
    }
  });
  return { conversations, errors };
}
function extractText(message) {
  if (typeof message.text === "string" && message.text.trim() !== "") return message.text.trim();
  if (Array.isArray(message.content)) {
    const parts = message.content.map((block) => {
      const b = block;
      return typeof b.text === "string" ? b.text : "";
    }).filter((part) => part !== "");
    if (parts.length > 0) return parts.join("\n\n").trim();
  }
  return "";
}
function normalizeTimestamp(value) {
  if (typeof value !== "string") return null;
  const truncated = value.replace(/(\.\d{3})\d+/, "$1");
  const date = new Date(truncated);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

// src/importers/chatgpt-export.ts
var ROLE_LABEL2 = {
  user: "\uC0AC\uC6A9\uC790",
  assistant: "AI"
};
var SKIP_ROLES = /* @__PURE__ */ new Set(["system", "tool"]);
function parseChatGptExport(raw) {
  const conversations = [];
  const errors = [];
  const list = Array.isArray(raw) ? raw : null;
  if (!list) {
    errors.push("\uCD5C\uC0C1\uC704\uAC00 \uBC30\uC5F4\uC774 \uC544\uB2D9\uB2C8\uB2E4. ChatGPT \uACF5\uC2DD \uB0B4\uBCF4\uB0B4\uAE30\uC758 conversations.json \uD615\uC2DD\uC774 \uC544\uB2D0 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
    return { conversations, errors };
  }
  list.forEach((entry, index) => {
    var _a, _b;
    const label = `\uB300\uD654 ${index + 1}`;
    try {
      const conv = entry;
      if (!conv.mapping || typeof conv.mapping !== "object") throw new Error("mapping \uD2B8\uB9AC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
      const mapping = conv.mapping;
      const chain = resolveActiveChain(mapping, conv.current_node);
      const lines = [];
      let firstUserText = "";
      let lastCreateTime = null;
      for (const node of chain) {
        const message = node.message;
        if (!message) continue;
        const author = message.author;
        const role = typeof (author == null ? void 0 : author.role) === "string" ? author.role : "";
        if (SKIP_ROLES.has(role)) continue;
        const text = extractParts(message.content);
        if (text === "") continue;
        if (role === "user" && firstUserText === "") firstUserText = text;
        if (typeof message.create_time === "number") lastCreateTime = message.create_time;
        const roleLabel = (_a = ROLE_LABEL2[role]) != null ? _a : role || "\uC54C \uC218 \uC5C6\uC74C";
        lines.push(`${roleLabel}: ${text}`);
      }
      if (lines.length === 0) throw new Error("\uCD94\uCD9C\uB41C \uBA54\uC2DC\uC9C0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
      const rawTitle = typeof conv.title === "string" ? conv.title.trim() : "";
      const title = rawTitle !== "" && rawTitle.toLowerCase() !== "new chat" ? rawTitle : Array.from(firstUserText).slice(0, 40).join("") || `\uAC00\uC838\uC628 \uB300\uD654 ${index + 1}`;
      const seconds = (_b = lastCreateTime != null ? lastCreateTime : asNumber(conv.update_time)) != null ? _b : asNumber(conv.create_time);
      if (seconds === null) throw new Error("\uC800\uC7A5 \uC2DC\uAC01\uC744 \uD574\uC11D\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
      const savedAt = new Date(seconds * 1e3).toISOString();
      conversations.push({ source: "codex", title, savedAt, transcript: lines.join("\n\n") });
    } catch (error) {
      errors.push(`${label}: ${error instanceof Error ? error.message : "\uC54C \uC218 \uC5C6\uB294 \uC624\uB958\uB85C \uAC74\uB108\uB700"}`);
    }
  });
  return { conversations, errors };
}
function resolveActiveChain(mapping, currentNode) {
  var _a;
  const ids = Object.keys(mapping);
  let leafId = typeof currentNode === "string" && mapping[currentNode] ? currentNode : null;
  if (leafId === null) {
    const leaves = ids.filter((id) => {
      var _a2;
      const children = (_a2 = mapping[id]) == null ? void 0 : _a2.children;
      return !Array.isArray(children) || children.length === 0;
    });
    let bestTime = -Infinity;
    for (const id of leaves) {
      const message = (_a = mapping[id]) == null ? void 0 : _a.message;
      const time = typeof (message == null ? void 0 : message.create_time) === "number" ? message.create_time : -Infinity;
      if (time > bestTime) {
        bestTime = time;
        leafId = id;
      }
    }
  }
  if (leafId === null) return [];
  const chain = [];
  const seen = /* @__PURE__ */ new Set();
  let cursor = leafId;
  while (cursor !== null && mapping[cursor] !== void 0 && !seen.has(cursor)) {
    seen.add(cursor);
    const node = mapping[cursor];
    if (node) chain.push(node);
    const parent = node == null ? void 0 : node.parent;
    cursor = typeof parent === "string" ? parent : null;
  }
  return chain.reverse();
}
function extractParts(content) {
  const c = content;
  if (!c || !Array.isArray(c.parts)) return "";
  return c.parts.filter((part) => typeof part === "string" && part.trim() !== "").join("\n\n").trim();
}
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// src/note.ts
var FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
var SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
function yamlString(value) {
  return JSON.stringify(value);
}
function yamlStringArray(values) {
  return `[${values.map(yamlString).join(", ")}]`;
}
function readFrontmatterString(frontmatter, key) {
  var _a, _b, _c;
  const keyOccurrences = [...frontmatter.matchAll(new RegExp(`^[ \\t]*${key}[ \\t]*:`, "gm"))];
  if (keyOccurrences.length !== 1) return null;
  const matches = [...frontmatter.matchAll(new RegExp(
    `^[ \\t]*${key}[ \\t]*:[ \\t]*(?:"([^"]*)"|'([^']*)'|([^\\s#]+))[ \\t]*(?:#.*)?$`,
    "gm"
  ))];
  if (matches.length !== 1) return null;
  const match = matches[0];
  return (_c = (_b = (_a = match == null ? void 0 : match[1]) != null ? _a : match == null ? void 0 : match[2]) != null ? _b : match == null ? void 0 : match[3]) != null ? _c : null;
}
function splitConversationNote(text) {
  const match = text.match(FRONTMATTER_PATTERN);
  if (!match || match[1] === void 0) {
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
function isSupportedConversationFrontmatter(value) {
  if (!value || typeof value !== "object") return false;
  const frontmatter = value;
  return frontmatter.type === "ai-conversation" && frontmatter.schema_version === SCHEMA_VERSION;
}
function serializeFrontmatter(metadata) {
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
      } else if (correction.reason !== void 0) {
        lines.push(`    reason: ${yamlString(correction.reason)}`);
      }
    }
  }
  return lines.join("\n");
}
function serializeConversationNote(metadata, body) {
  return `---
${serializeFrontmatter(metadata)}
---
${body}`;
}
function assertConversationNoteWritable(split) {
  if (split.type !== "ai-conversation") {
    throw new Error("\uB300\uC0C1 \uB178\uD2B8\uAC00 AI \uB300\uD654 \uB178\uD2B8\uAC00 \uC544\uB2D9\uB2C8\uB2E4.");
  }
  if (split.schemaVersion === null) {
    throw new Error("schema_version\uC774 \uC5C6\uAC70\uB098 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
  }
  if (split.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 schema_version ${split.schemaVersion}\uC785\uB2C8\uB2E4. \uC4F0\uAE30\uB97C \uAC70\uBD80\uD569\uB2C8\uB2E4.`);
  }
}
function assertId(value, label) {
  if (!SAFE_ID_PATTERN.test(value)) throw new Error(`${label} ID \uD615\uC2DD\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4: ${value}`);
}
async function prepareRevision(text, input) {
  const split = splitConversationNote(text);
  const isNew = text === "";
  if (!isNew) assertConversationNoteWritable(split);
  assertId(input.source, "\uACF5\uAE09\uC790");
  assertId(input.model, "\uBAA8\uB378");
  const payload = normalizeLf(input.payload);
  const hash = await computeHash(payload);
  const existingParsed = isNew ? { events: [], warnings: [] } : parseEventLogDetailed(split.body);
  const existingEvents = existingParsed.events;
  const existingRevision = existingEvents.find(
    (event) => event.kind === "revision" && event.dedupe_hash === hash
  );
  if ((existingRevision == null ? void 0 : existingRevision.kind) === "revision") {
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
async function prepareCorrection(text, input) {
  const split = splitConversationNote(text);
  assertConversationNoteWritable(split);
  const block = renderCorrectionBlock(input);
  const body = appendEventBlock(split.body, block);
  const parsed = parseEventLogDetailed(body);
  const metadata = await deriveMetadata(parsed.events);
  return { changed: true, content: serializeConversationNote(metadata, body), metadata, warnings: parsed.warnings };
}
async function prepareSummaryCorrection(text, input) {
  const split = splitConversationNote(text);
  assertConversationNoteWritable(split);
  const block = renderSummaryCorrectionBlock(input);
  const body = appendEventBlock(split.body, block);
  const parsed = parseEventLogDetailed(body);
  const metadata = await deriveMetadata(parsed.events);
  return { changed: true, content: serializeConversationNote(metadata, body), metadata, warnings: parsed.warnings };
}
async function rebuildConversationNoteDetailed(text) {
  const split = splitConversationNote(text);
  assertConversationNoteWritable(split);
  const parsed = parseEventLogDetailed(split.body);
  const metadata = await deriveMetadata(parsed.events);
  return { content: serializeConversationNote(metadata, split.body), warnings: parsed.warnings };
}
async function verifyConversationWrite(text, expectedMetadata, expectedHash) {
  const split = splitConversationNote(text);
  assertConversationNoteWritable(split);
  if (split.frontmatter !== serializeFrontmatter(expectedMetadata)) {
    throw new Error("\uC4F0\uAE30 \uD6C4 frontmatter \uAC80\uC99D\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
  }
  const events = parseEventLog(split.body);
  const actualMetadata = await deriveMetadata(events);
  if (JSON.stringify(actualMetadata) !== JSON.stringify(expectedMetadata)) {
    throw new Error("\uC4F0\uAE30 \uD6C4 \uBA54\uD0C0\uB370\uC774\uD130 \uAC80\uC99D\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
  }
  if (expectedHash !== void 0) {
    const count = events.filter((event) => event.kind === "revision" && event.dedupe_hash === expectedHash).length;
    if (count !== 1) throw new Error("\uC4F0\uAE30 \uD6C4 \uC6D0\uBB38 \uD574\uC2DC \uAC80\uC99D\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
  }
}
var WINDOWS_RESERVED_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
var TITLE_MAX_CODE_POINTS = 120;
function sanitizeTitle(raw, suffix = "") {
  const cleanEdges = (value) => value.replace(/^[.\s]+/u, "").replace(/[.\s]+$/u, "");
  const suffixCharacters = Array.from(suffix).slice(0, TITLE_MAX_CODE_POINTS);
  const available = Math.max(0, TITLE_MAX_CODE_POINTS - suffixCharacters.length);
  let title = raw.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
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
function suggestTitle(text) {
  var _a, _b;
  const firstLine = (_b = (_a = normalizeLf(text).split("\n").find((line) => line.trim() !== "")) == null ? void 0 : _a.trim()) != null ? _b : "";
  return Array.from(firstLine).slice(0, 40).join("");
}

// src/settings.ts
var import_obsidian2 = require("obsidian");
var DEFAULT_SETTINGS = {
  conversationFolder: "01-\uB300\uD654 \uC6D0\uBCF8",
  knowledgeFolder: "02-\uC9C0\uC2DD",
  sizeWarnMB: 1,
  lastSource: null,
  lastModel: {},
  pendingRecommendations: [],
  models: DEFAULT_MODELS.map((model) => ({ ...model }))
};
function validModel(value) {
  if (!value || typeof value !== "object") return false;
  const model = value;
  return typeof model.source === "string" && typeof model.id === "string" && typeof model.label === "string" && typeof model.description === "string" && typeof model.enabled === "boolean";
}
function loadSettings(value) {
  const saved = value && typeof value === "object" ? value : {};
  const savedModels = Array.isArray(saved.models) ? saved.models.filter(validModel) : [];
  const models = DEFAULT_MODELS.map((builtin) => {
    var _a;
    const previous = savedModels.find((model) => model.source === builtin.source && model.id === builtin.id);
    return { ...builtin, enabled: (_a = previous == null ? void 0 : previous.enabled) != null ? _a : builtin.enabled };
  });
  for (const custom of savedModels.filter((model) => !model.builtin)) {
    if (!models.some((model) => model.source === custom.source && model.id === custom.id)) {
      models.push({ ...custom, builtin: false });
    }
  }
  return {
    conversationFolder: typeof saved.conversationFolder === "string" ? saved.conversationFolder : DEFAULT_SETTINGS.conversationFolder,
    knowledgeFolder: typeof saved.knowledgeFolder === "string" ? saved.knowledgeFolder : DEFAULT_SETTINGS.knowledgeFolder,
    sizeWarnMB: typeof saved.sizeWarnMB === "number" && saved.sizeWarnMB > 0 ? saved.sizeWarnMB : DEFAULT_SETTINGS.sizeWarnMB,
    lastSource: typeof saved.lastSource === "string" ? saved.lastSource : null,
    lastModel: saved.lastModel && typeof saved.lastModel === "object" ? { ...saved.lastModel } : {},
    pendingRecommendations: sanitizePendingRecommendations(saved.pendingRecommendations, Date.now()),
    models
  };
}
var SaverSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, host) {
    super(app, host);
    __publicField(this, "host", host);
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "AI \uB300\uD654 \uC800\uC7A5" });
    containerEl.createEl("p", {
      text: "\uB300\uD654\uB294 \uB85C\uCEEC \uBCFC\uD2B8\uC5D0\uB9CC \uC800\uC7A5\uB418\uBA70 \uC678\uBD80 API\uB098 \uB124\uD2B8\uC6CC\uD06C\uB97C \uC0AC\uC6A9\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
      cls: "setting-item-description"
    });
    new import_obsidian2.Setting(containerEl).setName("\uB300\uD654 \uC6D0\uBCF8 \uD3F4\uB354").setDesc("\uACF5\uAE09\uC790\xB7\uBAA8\uB378\xB7\uC5F0\uB3C4 \uD558\uC704 \uD3F4\uB354 \uC5C6\uC774 \uD3C9\uD3C9\uD558\uAC8C \uC800\uC7A5\uD569\uB2C8\uB2E4.").addText((text) => text.setPlaceholder("01-\uB300\uD654 \uC6D0\uBCF8").setValue(this.host.settings.conversationFolder).onChange(async (value) => {
      this.host.settings.conversationFolder = value.trim() || DEFAULT_SETTINGS.conversationFolder;
      await this.host.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("\uC9C0\uC2DD \uB178\uD2B8 \uD3F4\uB354").setDesc("\uBA85\uB839\uC744 \uC2E4\uD589\uD588\uC744 \uB54C\uB9CC \uC9C0\uC2DD \uB178\uD2B8\uB97C \uB9CC\uB4ED\uB2C8\uB2E4.").addText((text) => text.setPlaceholder("02-\uC9C0\uC2DD").setValue(this.host.settings.knowledgeFolder).onChange(async (value) => {
      this.host.settings.knowledgeFolder = value.trim() || DEFAULT_SETTINGS.knowledgeFolder;
      await this.host.saveSettings();
    }));
    new import_obsidian2.Setting(containerEl).setName("\uD30C\uC77C \uD06C\uAE30 \uACBD\uACE0").setDesc("\uC800\uC7A5\uC740 \uB9C9\uC9C0 \uC54A\uACE0 \uC774 \uD06C\uAE30(MB)\uB97C \uB118\uC73C\uBA74 \uC54C\uB9BD\uB2C8\uB2E4.").addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "0.1";
      text.inputEl.step = "0.1";
      text.setValue(String(this.host.settings.sizeWarnMB)).onChange(async (value) => {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) {
          this.host.settings.sizeWarnMB = number;
          await this.host.saveSettings();
        }
      });
    });
    containerEl.createEl("h3", { text: "\uAE30\uBCF8 \uBAA8\uB378" });
    for (const model of this.host.settings.models.filter((item) => item.builtin)) {
      new import_obsidian2.Setting(containerEl).setName(`${model.label} \xB7 ${model.source}`).setDesc(model.description).addToggle((toggle) => toggle.setValue(model.enabled).onChange(async (enabled) => {
        model.enabled = enabled;
        await this.host.saveSettings();
      }));
    }
    containerEl.createEl("h3", { text: "\uC0AC\uC6A9\uC790 \uC815\uC758 \uBAA8\uB378" });
    const help = containerEl.createEl("p", {
      text: "\uD55C \uC904\uC5D0 \uACF5\uAE09\uC790|\uC800\uC7A5 ID|\uD45C\uC2DC \uC774\uB984|\uC124\uBA85\uC744 \uC785\uB825\uD569\uB2C8\uB2E4. \uC608: codex|my-model|\uB0B4 \uBAA8\uB378|\uC0AC\uB0B4\uC6A9 \uBAA8\uB378",
      cls: "setting-item-description"
    });
    help.setAttr("aria-live", "polite");
    new import_obsidian2.Setting(containerEl).setName("\uBAA8\uB378 \uBAA9\uB85D").addTextArea((area) => {
      const custom = this.host.settings.models.filter((model) => !model.builtin);
      area.setValue(custom.map((model) => [model.source, model.id, model.label, model.description].join("|")).join("\n"));
      area.inputEl.rows = 6;
      area.inputEl.addClass("ai-saver-settings-textarea");
      area.onChange(async (value) => {
        const parsed = [];
        for (const [index, line] of value.split("\n").entries()) {
          if (line.trim() === "") continue;
          const [source, id, label, ...descriptionParts] = line.split("|").map((part) => part.trim());
          const description = descriptionParts.join("|");
          if (!source || !id || !label || !description || !/^[a-z0-9][a-z0-9._-]*$/.test(source) || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
            help.setText(`${index + 1}\uBC88\uC9F8 \uC904 \uD615\uC2DD\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC544 \uC800\uC7A5\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.`);
            return;
          }
          if (parsed.some((model) => model.source === source && model.id === id)) {
            help.setText(`${index + 1}\uBC88\uC9F8 \uC904\uC758 \uC800\uC7A5 ID\uAC00 \uC911\uBCF5\uB429\uB2C8\uB2E4.`);
            return;
          }
          parsed.push({ source, id, label, description, enabled: true, builtin: false });
        }
        const builtin = this.host.settings.models.filter((model) => model.builtin);
        this.host.settings.models = [...builtin, ...parsed];
        help.setText("\uC0AC\uC6A9\uC790 \uC815\uC758 \uBAA8\uB378\uC744 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.");
        await this.host.saveSettings();
      });
    });
  }
};

// src/main.ts
var ConcurrentEditError = class extends Error {
};
var UserInputError = class extends Error {
};
var AIConversationSaverPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    __publicField(this, "settings", {
      ...DEFAULT_SETTINGS,
      lastModel: {},
      pendingRecommendations: [],
      models: DEFAULT_SETTINGS.models.map((model) => ({ ...model }))
    });
  }
  async onload() {
    this.settings = loadSettings(await this.loadData());
    this.addSettingTab(new SaverSettingTab(this.app, this));
    this.addRibbonIcon("save", "AI \uB300\uD654 \uC800\uC7A5", () => void this.openSaveModal());
    this.addRibbonIcon("sparkles", "AI \uC791\uC5C5 \uBAA8\uB378 \uCD94\uCC9C", () => this.openRecommendationModal());
    this.addRibbonIcon("book-open", "\uD604\uC7AC \uB300\uD654\uC5D0\uC11C \uC9C0\uC2DD \uB178\uD2B8 \uB9CC\uB4E4\uAE30", () => void this.createKnowledgeNote());
    this.addCommand({
      id: "recommend-ai-model",
      name: "AI \uC791\uC5C5 \uBAA8\uB378 \uCD94\uCC9C",
      callback: () => this.openRecommendationModal()
    });
    this.addCommand({
      id: "save-ai-conversation",
      name: "AI \uB300\uD654 \uC800\uC7A5",
      callback: () => void this.openSaveModal()
    });
    this.addCommand({
      id: "toggle-revision-validity",
      name: "\uB9AC\uBE44\uC804 \uC720\uD6A8\uC131 \uBCC0\uACBD",
      checkCallback: (checking) => {
        const file = this.getActiveAiFile();
        if (!file) return false;
        if (!checking) void this.openCorrectionModal(file);
        return true;
      }
    });
    this.addCommand({
      id: "rebuild-ai-conversation-metadata",
      name: "AI \uB300\uD654 \uBA54\uD0C0\uB370\uC774\uD130 \uC7AC\uAD6C\uCD95",
      checkCallback: (checking) => {
        const file = this.getActiveAiFile();
        if (!file) return false;
        if (!checking) void this.rebuildMetadata(file);
        return true;
      }
    });
    this.addCommand({
      id: "complete-revision-summary",
      name: "\uD604\uC7AC \uB178\uD2B8\uC758 \uD55C \uC904 \uBA54\uBAA8 \uBCF4\uC644",
      checkCallback: (checking) => {
        const file = this.getActiveSupportedAiFile();
        if (!file) return false;
        if (!checking) void this.openSummaryCorrectionModal(file);
        return true;
      }
    });
    this.addCommand({
      id: "create-knowledge-note",
      name: "\uD604\uC7AC \uB300\uD654\uC5D0\uC11C \uC9C0\uC2DD \uB178\uD2B8 \uB9CC\uB4E4\uAE30",
      checkCallback: (checking) => {
        if (!this.getActiveAiFile()) return false;
        if (!checking) void this.createKnowledgeNote();
        return true;
      }
    });
    this.addCommand({
      id: "create-model-mapping-note",
      name: "\uBAA8\uB378 \uB9E4\uD551 \uB178\uD2B8 \uB9CC\uB4E4\uAE30",
      callback: () => void this.createModelMappingNote()
    });
    this.addCommand({
      id: "import-ai-conversations",
      name: "\uACFC\uAC70 \uB300\uD654 \uAC00\uC838\uC624\uAE30 (Claude / ChatGPT \uB0B4\uBCF4\uB0B4\uAE30)",
      callback: () => this.openImportModal()
    });
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof import_obsidian3.TFile) || !this.isAiConversation(file)) return;
      menu.addItem((item) => item.setTitle("\uD604\uC7AC \uB300\uD654\uC5D0\uC11C \uC9C0\uC2DD \uB178\uD2B8 \uB9CC\uB4E4\uAE30").setIcon("book-open").onClick(() => void this.createKnowledgeNote(file)));
      menu.addItem((item) => item.setTitle("\uB9AC\uBE44\uC804 \uC720\uD6A8\uC131 \uBCC0\uACBD").setIcon("rotate-ccw").onClick(() => void this.openCorrectionModal(file)));
      if (this.isSupportedAiConversation(file)) {
        menu.addItem((item) => item.setTitle("\uD55C \uC904 \uBA54\uBAA8 \uBCF4\uC644").setIcon("message-square-plus").onClick(() => void this.openSummaryCorrectionModal(file)));
      }
    }));
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  openRecommendationModal() {
    new TaskRecommendationModal(
      this.app,
      this.settings.models,
      (request) => this.openRecommendedApp(request)
    ).open();
  }
  async openRecommendedApp(request) {
    const dynamicRequire = window.require;
    if (!dynamicRequire) throw new Error("Windows \uC571 \uC2E4\uD589 \uAE30\uB2A5\uC744 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    const electron = dynamicRequire("electron");
    if (!electron.shell) throw new Error("Windows \uC571 \uC2E4\uD589 \uAE30\uB2A5\uC744 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    await electron.shell.openExternal(appLaunchUrl(request.source));
    this.settings.pendingRecommendations = enqueuePendingRecommendation(
      this.settings.pendingRecommendations,
      {
        id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        source: request.source,
        recommendedModel: request.model,
        recommendationLevel: request.level,
        taskExcerpt: createTaskExcerpt(request.task),
        recommendedAt: (/* @__PURE__ */ new Date()).toISOString()
      },
      Date.now()
    );
    await this.saveSettings();
  }
  async openSaveModal() {
    try {
      const payload = await this.readClipboardText();
      if (payload.trim() === "") {
        new import_obsidian3.Notice("\uD074\uB9BD\uBCF4\uB4DC\uAC00 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
        return;
      }
      const candidates = this.getNoteCandidates();
      new SaveConversationModal(this.app, {
        candidates,
        suggestedTitle: suggestTitle(payload),
        models: this.settings.models,
        lastSource: this.settings.lastSource,
        lastModel: this.settings.lastModel,
        pendingRecommendations: this.settings.pendingRecommendations,
        onSave: (request) => this.saveConversation(request, payload)
      }).open();
    } catch (error) {
      new import_obsidian3.Notice(error instanceof Error ? error.message : "\uD074\uB9BD\uBCF4\uB4DC\uB97C \uC77D\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    }
  }
  async readClipboardText() {
    var _a;
    const dynamicRequire = window.require;
    if (dynamicRequire) {
      try {
        const electron = dynamicRequire("electron");
        const text = (_a = electron.clipboard) == null ? void 0 : _a.readText();
        if (typeof text === "string") return text;
      } catch (e) {
      }
    }
    try {
      return await navigator.clipboard.readText();
    } catch (e) {
      throw new Error("\uD074\uB9BD\uBCF4\uB4DC\uB97C \uC77D\uC744 \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uB300\uD654\uB97C \uB2E4\uC2DC \uBCF5\uC0AC\uD55C \uB4A4 \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.");
    }
  }
  getNoteCandidates() {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1e3;
    const current = this.app.workspace.getActiveFile();
    const all = this.app.vault.getMarkdownFiles().filter((file) => this.isAiConversation(file));
    const unique = /* @__PURE__ */ new Map();
    if (current && this.isAiConversation(current)) {
      unique.set(current.path, this.noteCandidate(current, "current"));
    }
    const candidates = all.map((file) => this.noteCandidate(file, "other")).sort((left, right) => right.modified - left.modified);
    for (const candidate of candidates) {
      if (unique.has(candidate.path)) continue;
      candidate.group = now - candidate.modified <= day ? "recent" : "other";
      unique.set(candidate.path, candidate);
    }
    return [...unique.values()];
  }
  noteCandidate(file, group) {
    var _a;
    const frontmatter = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
    const revisions = frontmatter == null ? void 0 : frontmatter.revisions;
    const last = Array.isArray(revisions) ? [...revisions].reverse().find((value) => value && typeof value === "object" && value.voided !== true) : void 0;
    const level = last == null ? void 0 : last.recommendation_level;
    const storedLevel = typeof level === "string" && ["quick", "writing", "balanced", "advanced", "agentic", "unknown"].includes(level) ? level : null;
    const lastSavedAt = typeof (frontmatter == null ? void 0 : frontmatter.last_saved_at) === "string" ? frontmatter.last_saved_at : null;
    const activity = lastSavedAt === null ? file.stat.mtime : Date.parse(lastSavedAt);
    return {
      path: file.path,
      basename: file.basename,
      group,
      modified: Number.isFinite(activity) ? activity : file.stat.mtime,
      lastSource: typeof (last == null ? void 0 : last.source) === "string" ? last.source : null,
      lastRecommendationLevel: storedLevel,
      lastSavedAt: typeof (last == null ? void 0 : last.saved_at) === "string" ? last.saved_at : null
    };
  }
  isAiConversation(file) {
    var _a, _b;
    return ((_b = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter) == null ? void 0 : _b.type) === "ai-conversation";
  }
  getActiveAiFile() {
    const file = this.app.workspace.getActiveFile();
    return file && this.isAiConversation(file) ? file : null;
  }
  isSupportedAiConversation(file) {
    var _a;
    return isSupportedConversationFrontmatter((_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter);
  }
  getActiveSupportedAiFile() {
    const file = this.app.workspace.getActiveFile();
    return file && this.isSupportedAiConversation(file) ? file : null;
  }
  async saveConversation(request, payload) {
    try {
      await this.performSave(request, payload);
    } catch (error) {
      if (error instanceof UserInputError) throw error;
      const message = error instanceof Error ? error.message : "\uD30C\uC77C \uC4F0\uAE30\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.";
      new RecoveryModal(this.app, message, {
        retry: () => this.saveConversation(request, payload),
        copy: () => this.copyText(payload),
        export: () => this.exportRecoveryFile(payload)
      }).open();
    }
  }
  async performSave(request, payload) {
    const input = {
      payload,
      source: request.source,
      model: request.model,
      outcome: request.outcome,
      recommendation_level: request.recommendationLevel,
      summary: request.summary,
      saved_at: localIsoTimestamp(/* @__PURE__ */ new Date())
    };
    let file;
    let prepared;
    if (request.targetPath) {
      const target = this.app.vault.getAbstractFileByPath((0, import_obsidian3.normalizePath)(request.targetPath));
      if (!(target instanceof import_obsidian3.TFile) || !this.isAiConversation(target)) {
        throw new UserInputError("\uC120\uD0DD\uD55C \uB300\uC0C1\uC774 AI \uB300\uD654 \uB178\uD2B8\uAC00 \uC544\uB2D9\uB2C8\uB2E4.");
      }
      ({ file, prepared } = await this.appendToExisting(target, input));
    } else {
      const title = sanitizeTitle(request.title);
      if (!title) throw new UserInputError("\uD30C\uC77C\uBA85\uC73C\uB85C \uC0AC\uC6A9\uD560 \uC218 \uC788\uB294 \uC81C\uBAA9\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694.");
      await this.ensureFolder(this.settings.conversationFolder);
      const desiredPath = (0, import_obsidian3.normalizePath)(`${this.settings.conversationFolder}/${title}.md`);
      const existing = this.app.vault.getAbstractFileByPath(desiredPath);
      if (existing) {
        const canAppend = existing instanceof import_obsidian3.TFile && this.isAiConversation(existing);
        const choice = await this.chooseCollision(title, canAppend);
        if (choice === "cancel") throw new UserInputError("\uC800\uC7A5\uC744 \uCDE8\uC18C\uD588\uC2B5\uB2C8\uB2E4.");
        if (choice === "append" && existing instanceof import_obsidian3.TFile) {
          ({ file, prepared } = await this.appendToExisting(existing, input));
        } else {
          const path = this.nextAvailablePath(this.settings.conversationFolder, title);
          ({ file, prepared } = await this.createNew(path, input));
        }
      } else {
        ({ file, prepared } = await this.createNew(desiredPath, input));
      }
    }
    if (!prepared.changed) {
      new import_obsidian3.Notice(`\uC774\uBBF8 revision ${prepared.duplicateRev}\uC5D0 \uC800\uC7A5\uB41C \uB0B4\uC6A9\uC785\uB2C8\uB2E4.`);
      this.showParseWarnings(prepared.warnings);
      return;
    }
    await this.verifyWrittenConversation(file, prepared.metadata, prepared.hash);
    this.settings.lastSource = request.source;
    this.settings.lastModel[request.source] = request.model;
    this.settings.pendingRecommendations = consumePendingRecommendation(
      this.settings.pendingRecommendations,
      request.pendingRecommendationId
    );
    await this.saveSettings();
    const megabytes = file.stat.size / (1024 * 1024);
    const sizeMessage = megabytes > this.settings.sizeWarnMB ? ` \uD30C\uC77C \uD06C\uAE30\uAC00 ${megabytes.toFixed(2)}MB\uB85C \uACBD\uACE0 \uAE30\uC900\uC744 \uB118\uC5C8\uC2B5\uB2C8\uB2E4.` : "";
    const summaryMessage = request.summary === "" ? " \uBA54\uBAA8 \uC5C6\uC774 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4. \uCEE4\uB9E8\uB4DC \uD314\uB808\uD2B8\uC5D0\uC11C \uB098\uC911\uC5D0 \uBCF4\uC644\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." : "";
    new import_obsidian3.Notice(`revision ${prepared.revision}\uC744 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.${summaryMessage}${sizeMessage}`);
    this.showParseWarnings(prepared.warnings);
    await this.app.workspace.getLeaf(false).openFile(file);
  }
  async appendToExisting(file, input) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await this.app.vault.read(file);
      let prepared;
      try {
        prepared = await prepareRevision(before, input);
      } catch (error) {
        throw new UserInputError(error instanceof Error ? error.message : "\uB300\uD654 \uB178\uD2B8\uB97C \uD574\uC11D\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
      }
      if (!prepared.changed) return { file, prepared };
      try {
        await this.app.vault.process(file, (current) => {
          if (current !== before) throw new ConcurrentEditError("\uC800\uC7A5 \uC911 \uB178\uD2B8\uAC00 \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
          return prepared.content;
        });
        return { file, prepared };
      } catch (error) {
        if (error instanceof ConcurrentEditError) continue;
        try {
          await this.verifyWrittenConversation(file, prepared.metadata, prepared.hash);
          return { file, prepared };
        } catch (e) {
        }
        throw error;
      }
    }
    throw new Error("\uB178\uD2B8\uAC00 \uACC4\uC18D \uBCC0\uACBD\uB418\uC5B4 \uC800\uC7A5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.");
  }
  async createNew(path, input) {
    let prepared;
    try {
      prepared = await prepareRevision("", input);
    } catch (error) {
      throw new UserInputError(error instanceof Error ? error.message : "\uC0C8 \uB300\uD654 \uB178\uD2B8\uB97C \uC900\uBE44\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    }
    if (!prepared.changed) throw new Error("\uC0C8 \uB178\uD2B8 \uC900\uBE44 \uC911 \uC608\uC0C1\uD558\uC9C0 \uBABB\uD55C \uC911\uBCF5\uC774 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.");
    try {
      const file = await this.app.vault.create(path, prepared.content);
      return { file, prepared };
    } catch (error) {
      const possibleFile = this.app.vault.getAbstractFileByPath(path);
      if (possibleFile instanceof import_obsidian3.TFile) {
        try {
          await this.verifyWrittenConversation(possibleFile, prepared.metadata, prepared.hash);
          return { file: possibleFile, prepared };
        } catch (e) {
        }
      }
      throw error;
    }
  }
  async verifyWrittenConversation(file, metadata, hash) {
    const current = await this.app.vault.read(file);
    await verifyConversationWrite(current, metadata, hash);
  }
  chooseCollision(title, canAppend) {
    return new Promise((resolve) => new CollisionModal(this.app, title, canAppend, resolve).open());
  }
  nextAvailablePath(folder, title) {
    let suffix = 2;
    while (true) {
      const path = (0, import_obsidian3.normalizePath)(`${folder}/${sanitizeTitle(title, ` (${suffix})`)}.md`);
      if (!this.app.vault.getAbstractFileByPath(path)) return path;
      suffix += 1;
    }
  }
  async openCorrectionModal(file) {
    try {
      const text = await this.app.vault.read(file);
      const metadata = await deriveMetadata(parseEventLog(splitConversationNote(text).body));
      new CorrectionModal(this.app, metadata.revisions, async (choice) => {
        await this.appendCorrection(file, choice.targetRev, choice.action, choice.reason);
      }).open();
    } catch (error) {
      new import_obsidian3.Notice(error instanceof Error ? error.message : "\uB9AC\uBE44\uC804\uC744 \uC77D\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    }
  }
  async appendCorrection(file, targetRev, action, reason) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await this.app.vault.read(file);
      const prepared = await prepareCorrection(before, {
        action,
        target_rev: targetRev,
        corrected_at: localIsoTimestamp(/* @__PURE__ */ new Date()),
        ...reason.trim() === "" ? {} : { reason: reason.trim() }
      });
      try {
        await this.app.vault.process(file, (current) => {
          if (current !== before) throw new ConcurrentEditError();
          return prepared.content;
        });
        await this.verifyWrittenConversation(file, prepared.metadata);
        new import_obsidian3.Notice(`revision ${targetRev}\uC5D0 ${action === "void" ? "\uBB34\uD6A8" : "\uBCF5\uC6D0"} \uC774\uBCA4\uD2B8\uB97C \uCD94\uAC00\uD588\uC2B5\uB2C8\uB2E4.`);
        this.showParseWarnings(prepared.warnings);
        return;
      } catch (error) {
        if (error instanceof ConcurrentEditError) continue;
        try {
          await this.verifyWrittenConversation(file, prepared.metadata);
          new import_obsidian3.Notice(`revision ${targetRev}\uC5D0 ${action === "void" ? "\uBB34\uD6A8" : "\uBCF5\uC6D0"} \uC774\uBCA4\uD2B8\uB97C \uCD94\uAC00\uD588\uC2B5\uB2C8\uB2E4.`);
          this.showParseWarnings(prepared.warnings);
          return;
        } catch (e) {
        }
        throw error;
      }
    }
    throw new Error("\uB178\uD2B8\uAC00 \uACC4\uC18D \uBCC0\uACBD\uB418\uC5B4 \uC815\uC815 \uC774\uBCA4\uD2B8\uB97C \uCD94\uAC00\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
  }
  async openSummaryCorrectionModal(file) {
    try {
      const text = await this.app.vault.read(file);
      const metadata = await deriveMetadata(parseEventLog(splitConversationNote(text).body));
      new SummaryCorrectionModal(this.app, metadata.revisions, async (choice) => {
        await this.appendSummaryCorrection(file, choice.targetRev, choice.summary);
      }).open();
    } catch (error) {
      new import_obsidian3.Notice(error instanceof Error ? error.message : "\uB9AC\uBE44\uC804 \uBA54\uBAA8\uB97C \uC77D\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    }
  }
  async appendSummaryCorrection(file, targetRev, summary) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await this.app.vault.read(file);
      const prepared = await prepareSummaryCorrection(before, {
        target_rev: targetRev,
        corrected_at: localIsoTimestamp(/* @__PURE__ */ new Date()),
        summary
      });
      try {
        await this.app.vault.process(file, (current) => {
          if (current !== before) throw new ConcurrentEditError();
          return prepared.content;
        });
        await this.verifyWrittenConversation(file, prepared.metadata);
        new import_obsidian3.Notice(`revision ${targetRev}\uC758 \uD55C \uC904 \uBA54\uBAA8\uB97C \uBCF4\uC644\uD588\uC2B5\uB2C8\uB2E4.`);
        this.showParseWarnings(prepared.warnings);
        return;
      } catch (error) {
        if (error instanceof ConcurrentEditError) continue;
        try {
          await this.verifyWrittenConversation(file, prepared.metadata);
          new import_obsidian3.Notice(`revision ${targetRev}\uC758 \uD55C \uC904 \uBA54\uBAA8\uB97C \uBCF4\uC644\uD588\uC2B5\uB2C8\uB2E4.`);
          this.showParseWarnings(prepared.warnings);
          return;
        } catch (e) {
        }
        throw error;
      }
    }
    throw new Error("\uB178\uD2B8\uAC00 \uACC4\uC18D \uBCC0\uACBD\uB418\uC5B4 \uD55C \uC904 \uBA54\uBAA8\uB97C \uBCF4\uC644\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
  }
  async rebuildMetadata(file) {
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const before = await this.app.vault.read(file);
        const rebuiltResult = await rebuildConversationNoteDetailed(before);
        const rebuilt = rebuiltResult.content;
        try {
          await this.app.vault.process(file, (current) => {
            if (current !== before) throw new ConcurrentEditError();
            return rebuilt;
          });
          if (await this.app.vault.read(file) !== rebuilt) {
            throw new Error("\uC7AC\uAD6C\uCD95 \uD6C4 \uD30C\uC77C \uAC80\uC99D\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
          }
          new import_obsidian3.Notice("\uBCF8\uBB38 \uC774\uBCA4\uD2B8\uC5D0\uC11C \uBA54\uD0C0\uB370\uC774\uD130\uB97C \uC7AC\uAD6C\uCD95\uD588\uC2B5\uB2C8\uB2E4.");
          this.showParseWarnings(rebuiltResult.warnings);
          return;
        } catch (error) {
          if (error instanceof ConcurrentEditError) continue;
          if (await this.app.vault.read(file) === rebuilt) {
            new import_obsidian3.Notice("\uBCF8\uBB38 \uC774\uBCA4\uD2B8\uC5D0\uC11C \uBA54\uD0C0\uB370\uC774\uD130\uB97C \uC7AC\uAD6C\uCD95\uD588\uC2B5\uB2C8\uB2E4.");
            this.showParseWarnings(rebuiltResult.warnings);
            return;
          }
          throw error;
        }
      }
      throw new Error("\uB178\uD2B8\uAC00 \uACC4\uC18D \uBCC0\uACBD\uB418\uC5B4 \uC7AC\uAD6C\uCD95\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    } catch (error) {
      new import_obsidian3.Notice(error instanceof Error ? error.message : "\uBA54\uD0C0\uB370\uC774\uD130 \uC7AC\uAD6C\uCD95\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
    }
  }
  showParseWarnings(warnings) {
    if (warnings.length > 0) new import_obsidian3.Notice([...new Set(warnings)].join("\n"));
  }
  async createKnowledgeNote(sourceFile) {
    const file = sourceFile != null ? sourceFile : this.getActiveAiFile();
    if (!file) {
      new import_obsidian3.Notice("AI \uB300\uD654 \uB178\uD2B8\uB97C \uBA3C\uC800 \uC5F4\uC5B4 \uC8FC\uC138\uC694.");
      return;
    }
    try {
      await this.ensureFolder(this.settings.knowledgeFolder);
      const path = this.nextAvailableKnowledgePath(file.basename);
      const content = [
        `# ${file.basename}`,
        "",
        `\uC6D0\uBB38: [[${file.path}|${file.basename}]]`,
        "",
        "## \uD575\uC2EC \uC694\uC57D",
        "",
        "## \uACB0\uC815",
        "",
        "## \uD560 \uC77C",
        "",
        "## \uB2E4\uC74C \uD589\uB3D9",
        ""
      ].join("\n");
      const created = await this.app.vault.create(path, content);
      await this.app.workspace.getLeaf(false).openFile(created);
      new import_obsidian3.Notice("\uC9C0\uC2DD \uB178\uD2B8\uB97C \uB9CC\uB4E4\uC5C8\uC2B5\uB2C8\uB2E4.");
    } catch (error) {
      new import_obsidian3.Notice(error instanceof Error ? error.message : "\uC9C0\uC2DD \uB178\uD2B8\uB97C \uB9CC\uB4E4\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    }
  }
  nextAvailableKnowledgePath(title) {
    const first = (0, import_obsidian3.normalizePath)(`${this.settings.knowledgeFolder}/${title}.md`);
    if (!this.app.vault.getAbstractFileByPath(first)) return first;
    let suffix = 2;
    while (true) {
      const path = (0, import_obsidian3.normalizePath)(`${this.settings.knowledgeFolder}/${title} ${suffix}.md`);
      if (!this.app.vault.getAbstractFileByPath(path)) return path;
      suffix += 1;
    }
  }
  async createModelMappingNote() {
    const folder = "99-\uC124\uC815";
    const path = (0, import_obsidian3.normalizePath)(`${folder}/\uBAA8\uB378-\uB9E4\uD551.md`);
    await this.ensureFolder(folder);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof import_obsidian3.TFile) {
      await this.app.workspace.getLeaf(false).openFile(existing);
      new import_obsidian3.Notice("\uAE30\uC874 \uBAA8\uB378 \uB9E4\uD551 \uB178\uD2B8\uB97C \uC5F4\uC5C8\uC2B5\uB2C8\uB2E4. \uB36E\uC5B4\uC4F0\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.");
      return;
    }
    const rows = this.settings.models.map(
      (model) => `| ${model.source} | ${model.id} | ${model.label} | ${model.description} | 2026-08-07 |  | \uACF5\uAC1C\uB418\uC9C0 \uC54A\uC74C |`
    );
    const content = [
      "# AI \uBAA8\uB378 \uB9E4\uD551 \uC774\uB825",
      "",
      "\uACF5\uC2DD\uC801\uC73C\uB85C \uD655\uC778\uB41C \uD654\uBA74 \uD45C\uC2DC \uC815\uBCF4\uB9CC \uAE30\uB85D\uD569\uB2C8\uB2E4. \uB0B4\uBD80 \uAE30\uBC18 \uBAA8\uB378\uC740 \uCD94\uCE21\uD558\uC9C0 \uC54A\uC73C\uBA70 \uAE30\uC874 \uAE30\uAC04\uC744 \uB36E\uC5B4\uC4F0\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
      "",
      "| \uACF5\uAE09\uC790 | \uC800\uC7A5 ID | \uD654\uBA74 \uD45C\uC2DC \uC774\uB984 | \uB2F9\uC2DC \uACF5\uC2DD \uC124\uBA85 | \uC801\uC6A9 \uC2DC\uC791\uC77C | \uC801\uC6A9 \uC885\uB8CC\uC77C | \uB0B4\uBD80 \uAE30\uBC18 \uBAA8\uB378 |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...rows,
      ""
    ].join("\n");
    const created = await this.app.vault.create(path, content);
    await this.app.workspace.getLeaf(false).openFile(created);
  }
  openImportModal() {
    new ImportModal(this.app, (request) => void this.runImport(request)).open();
  }
  async runImport(request) {
    const path = (0, import_obsidian3.normalizePath)(request.vaultPath);
    if (!await this.app.vault.adapter.exists(path)) {
      new import_obsidian3.Notice(`\uBCFC\uD2B8 \uC548\uC5D0\uC11C "${path}" \uD30C\uC77C\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uB0B4\uBCF4\uB0B4\uAE30 \uD30C\uC77C\uC744 \uBCFC\uD2B8\uB85C \uC62E\uAE34 \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.`);
      return;
    }
    let raw;
    try {
      const text = await this.app.vault.adapter.read(path);
      raw = JSON.parse(text);
    } catch (error) {
      new import_obsidian3.Notice(`\uD30C\uC77C\uC744 \uC77D\uAC70\uB098 \uD574\uC11D\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const result = request.provider === "claude" ? parseClaudeExport(raw) : parseChatGptExport(raw);
    if (result.conversations.length === 0) {
      new import_obsidian3.Notice(`\uAC00\uC838\uC62C \uB300\uD654\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. ${result.errors.length}\uAC1C \uD56D\uBAA9\uC5D0\uC11C \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.`);
      return;
    }
    new import_obsidian3.Notice(`${result.conversations.length}\uAC1C \uB300\uD654\uB97C \uAC00\uC838\uC624\uB294 \uC911\uC785\uB2C8\uB2E4...`);
    await this.ensureFolder(this.settings.conversationFolder);
    const reportLines = [
      "# \uACFC\uAC70 \uB300\uD654 \uAC00\uC838\uC624\uAE30 \uBCF4\uACE0\uC11C",
      "",
      `\uACF5\uAE09\uC790: ${request.provider === "claude" ? "Claude" : "ChatGPT (Codex)"}`,
      `\uC6D0\uBCF8 \uD30C\uC77C: ${path}`,
      `\uAC00\uC838\uC628 \uC2DC\uAC01: ${localIsoTimestamp(/* @__PURE__ */ new Date())}`,
      ""
    ];
    let created = 0;
    let failed = 0;
    for (const conversation of result.conversations) {
      try {
        const notePath = await this.createImportedNote(conversation);
        created += 1;
        reportLines.push(`- [x] [[${notePath}|${conversation.title}]]`);
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : "\uC54C \uC218 \uC5C6\uB294 \uC624\uB958";
        reportLines.push(`- [ ] **\uC2E4\uD328** \xB7 ${conversation.title} \xB7 ${message}`);
      }
    }
    for (const message of result.errors) {
      failed += 1;
      reportLines.push(`- [ ] **\uD30C\uC2F1 \uC2E4\uD328** \xB7 ${message}`);
    }
    const reportPath = (0, import_obsidian3.normalizePath)(
      `${this.settings.conversationFolder}/\uAC00\uC838\uC624\uAE30 \uBCF4\uACE0\uC11C ${localIsoTimestamp(/* @__PURE__ */ new Date()).replace(/[:.]/g, "-")}.md`
    );
    await this.app.vault.create(reportPath, reportLines.join("\n"));
    const summary = failed === 0 ? `${created}\uAC1C \uB300\uD654\uB97C \uBAA8\uB450 \uAC00\uC838\uC654\uC2B5\uB2C8\uB2E4.` : `${created}\uAC1C \uAC00\uC838\uC624\uACE0 ${failed}\uAC1C\uB294 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uAC00\uC838\uC624\uAE30 \uBCF4\uACE0\uC11C\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694.`;
    new import_obsidian3.Notice(summary);
    const reportFile = this.app.vault.getAbstractFileByPath(reportPath);
    if (reportFile instanceof import_obsidian3.TFile) await this.app.workspace.getLeaf(false).openFile(reportFile);
  }
  async createImportedNote(conversation) {
    const title = sanitizeTitle(conversation.title);
    if (!title) throw new Error("\uC81C\uBAA9\uC744 \uD30C\uC77C\uBA85\uC73C\uB85C \uC4F8 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    const desiredPath = (0, import_obsidian3.normalizePath)(`${this.settings.conversationFolder}/${title}.md`);
    const path = this.app.vault.getAbstractFileByPath(desiredPath) ? this.nextAvailablePath(this.settings.conversationFolder, title) : desiredPath;
    const input = {
      payload: conversation.transcript,
      source: conversation.source,
      model: "unknown",
      outcome: "unknown",
      recommendation_level: "unknown",
      summary: "",
      saved_at: conversation.savedAt
    };
    const { file } = await this.createNew(path, input);
    return file.path;
  }
  async ensureFolder(folder) {
    const normalized = (0, import_obsidian3.normalizePath)(folder).replace(/^\/+|\/+$/g, "");
    if (!normalized) throw new Error("\uC800\uC7A5 \uD3F4\uB354 \uACBD\uB85C\uAC00 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
    let current = "";
    for (const part of normalized.split("/")) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (!existing) await this.app.vault.createFolder(current);
      else if (existing instanceof import_obsidian3.TFile) throw new Error(`${current} \uACBD\uB85C\uC5D0 \uAC19\uC740 \uC774\uB984\uC758 \uD30C\uC77C\uC774 \uC788\uC2B5\uB2C8\uB2E4.`);
    }
  }
  async copyText(text) {
    const dynamicRequire = window.require;
    if (dynamicRequire) {
      try {
        const electron = dynamicRequire("electron");
        if (electron.clipboard) {
          electron.clipboard.writeText(text);
          new import_obsidian3.Notice("\uC6D0\uBB38\uC744 \uD074\uB9BD\uBCF4\uB4DC\uC5D0 \uBCF5\uC0AC\uD588\uC2B5\uB2C8\uB2E4.");
          return;
        }
      } catch (e) {
      }
    }
    await navigator.clipboard.writeText(text);
    new import_obsidian3.Notice("\uC6D0\uBB38\uC744 \uD074\uB9BD\uBCF4\uB4DC\uC5D0 \uBCF5\uC0AC\uD588\uC2B5\uB2C8\uB2E4.");
  }
  async exportRecoveryFile(text) {
    const dynamicRequire = window.require;
    if (!dynamicRequire) throw new Error("\uC774 \uD658\uACBD\uC5D0\uC11C\uB294 \uD30C\uC77C \uC120\uD0DD \uCC3D\uC744 \uC5F4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    const remote = dynamicRequire("@electron/remote");
    const fs = dynamicRequire("node:fs/promises");
    if (!remote.dialog) throw new Error("\uD30C\uC77C \uC120\uD0DD \uCC3D\uC744 \uC5F4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC6D0\uBB38 \uBCF5\uC0AC\uB97C \uC0AC\uC6A9\uD574 \uC8FC\uC138\uC694.");
    const result = await remote.dialog.showSaveDialog({
      title: "AI \uB300\uD654 \uC6D0\uBB38 \uBCF5\uAD6C \uD30C\uC77C \uC800\uC7A5",
      defaultPath: `ai-conversation-recovery-${Date.now()}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }]
    });
    if (result.canceled || !result.filePath) return;
    await fs.writeFile(result.filePath, normalizeLf(text), "utf8");
    new import_obsidian3.Notice("\uC0AC\uC6A9\uC790\uAC00 \uC120\uD0DD\uD55C \uC704\uCE58\uC5D0 \uBCF5\uAD6C \uD30C\uC77C\uC744 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.");
  }
};
function localIsoTimestamp(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 6e4).toISOString().slice(0, 19);
  return `${local}${offset}`;
}
