"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitConversationNote = splitConversationNote;
exports.serializeFrontmatter = serializeFrontmatter;
exports.serializeConversationNote = serializeConversationNote;
exports.prepareRevision = prepareRevision;
exports.prepareCorrection = prepareCorrection;
exports.rebuildConversationNote = rebuildConversationNote;
exports.verifyConversationWrite = verifyConversationWrite;
exports.sanitizeTitle = sanitizeTitle;
exports.suggestTitle = suggestTitle;
const codec_1 = require("./codec");
const domain_1 = require("./domain");
const events_1 = require("./events");
const metadata_1 = require("./metadata");
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
function yamlString(value) {
    return JSON.stringify(value);
}
function yamlStringArray(values) {
    return `[${values.map(yamlString).join(", ")}]`;
}
function readFrontmatterString(frontmatter, key) {
    const keyOccurrences = [...frontmatter.matchAll(new RegExp(`^[ \\t]*${key}[ \\t]*:`, "gm"))];
    if (keyOccurrences.length !== 1)
        return null;
    const matches = [...frontmatter.matchAll(new RegExp(`^[ \\t]*${key}[ \\t]*:[ \\t]*(?:"([^"]*)"|'([^']*)'|([^\\s#]+))[ \\t]*(?:#.*)?$`, "gm"))];
    if (matches.length !== 1)
        return null;
    const match = matches[0];
    return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}
function splitConversationNote(text) {
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
function serializeFrontmatter(metadata) {
    const lines = [
        `type: ${yamlString(metadata.type)}`,
        `schema_version: ${metadata.schema_version}`,
        `created_at: ${yamlString(metadata.created_at)}`,
        `last_saved_at: ${yamlString(metadata.last_saved_at)}`,
        `sources: ${yamlStringArray(metadata.sources)}`,
        `models: ${yamlStringArray(metadata.models)}`,
        `last_outcome: ${metadata.last_outcome === null ? "null" : yamlString(metadata.last_outcome)}`,
        `revision_count: ${metadata.revision_count}`,
        `effective_revision_count: ${metadata.effective_revision_count}`,
        "revisions:"
    ];
    for (const revision of metadata.revisions) {
        lines.push(`  - rev: ${revision.rev}`, `    source: ${yamlString(revision.source)}`, `    model: ${yamlString(revision.model)}`, `    outcome: ${yamlString(revision.outcome)}`, `    saved_at: ${yamlString(revision.saved_at)}`, `    dedupe_hash: ${yamlString(revision.dedupe_hash)}`, `    voided: ${revision.voided}`);
    }
    if (metadata.corrections.length === 0) {
        lines.push("corrections: []");
    }
    else {
        lines.push("corrections:");
        for (const correction of metadata.corrections) {
            lines.push(`  - action: ${yamlString(correction.action)}`, `    target_rev: ${correction.target_rev}`, `    corrected_at: ${yamlString(correction.corrected_at)}`);
            if (correction.reason !== undefined)
                lines.push(`    reason: ${yamlString(correction.reason)}`);
        }
    }
    return lines.join("\n");
}
function serializeConversationNote(metadata, body) {
    return `---\n${serializeFrontmatter(metadata)}\n---\n${body}`;
}
function assertConversationNoteWritable(split) {
    if (split.type !== "ai-conversation") {
        throw new Error("대상 노트가 AI 대화 노트가 아닙니다.");
    }
    if (split.schemaVersion === null) {
        throw new Error("schema_version이 없거나 올바르지 않습니다.");
    }
    if (split.schemaVersion !== domain_1.SCHEMA_VERSION) {
        throw new Error(`지원하지 않는 schema_version ${split.schemaVersion}입니다. 쓰기를 거부합니다.`);
    }
}
function assertId(value, label) {
    if (!SAFE_ID_PATTERN.test(value))
        throw new Error(`${label} ID 형식이 올바르지 않습니다: ${value}`);
}
async function prepareRevision(text, input) {
    const split = splitConversationNote(text);
    const isNew = text === "";
    if (!isNew)
        assertConversationNoteWritable(split);
    assertId(input.source, "공급자");
    assertId(input.model, "모델");
    const payload = (0, codec_1.normalizeLf)(input.payload);
    const hash = await (0, codec_1.computeHash)(payload);
    const existingEvents = isNew ? [] : (0, events_1.parseEventLog)(split.body);
    const existingRevision = existingEvents.find((event) => event.kind === "revision" && event.dedupe_hash === hash);
    if (existingRevision?.kind === "revision") {
        return { changed: false, hash, duplicateRev: existingRevision.rev };
    }
    const revision = existingEvents.filter((event) => event.kind === "revision").length + 1;
    const block = (0, events_1.renderRevisionBlock)({
        rev: revision,
        saved_at: input.saved_at,
        source: input.source,
        model: input.model,
        outcome: input.outcome,
        dedupe_hash: hash,
        payload
    });
    const body = (0, events_1.appendEventBlock)(isNew ? "" : split.body, block);
    const metadata = await (0, metadata_1.deriveMetadata)((0, events_1.parseEventLog)(body));
    return {
        changed: true,
        hash,
        revision,
        content: serializeConversationNote(metadata, body),
        metadata
    };
}
async function prepareCorrection(text, input) {
    const split = splitConversationNote(text);
    assertConversationNoteWritable(split);
    const block = (0, events_1.renderCorrectionBlock)(input);
    const body = (0, events_1.appendEventBlock)(split.body, block);
    const metadata = await (0, metadata_1.deriveMetadata)((0, events_1.parseEventLog)(body));
    return { changed: true, content: serializeConversationNote(metadata, body), metadata };
}
async function rebuildConversationNote(text) {
    const split = splitConversationNote(text);
    assertConversationNoteWritable(split);
    const metadata = await (0, metadata_1.deriveMetadata)((0, events_1.parseEventLog)(split.body));
    return serializeConversationNote(metadata, split.body);
}
async function verifyConversationWrite(text, expectedMetadata, expectedHash) {
    const split = splitConversationNote(text);
    assertConversationNoteWritable(split);
    if (split.frontmatter !== serializeFrontmatter(expectedMetadata)) {
        throw new Error("쓰기 후 frontmatter 검증에 실패했습니다.");
    }
    const events = (0, events_1.parseEventLog)(split.body);
    const actualMetadata = await (0, metadata_1.deriveMetadata)(events);
    if (JSON.stringify(actualMetadata) !== JSON.stringify(expectedMetadata)) {
        throw new Error("쓰기 후 메타데이터 검증에 실패했습니다.");
    }
    if (expectedHash !== undefined) {
        const count = events.filter((event) => event.kind === "revision" && event.dedupe_hash === expectedHash).length;
        if (count !== 1)
            throw new Error("쓰기 후 원문 해시 검증에 실패했습니다.");
    }
}
function sanitizeTitle(raw) {
    return raw
        .replace(/[\\/:*?"<>|]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[.\s]+$/u, "");
}
function suggestTitle(text) {
    const firstLine = (0, codec_1.normalizeLf)(text).split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
    return Array.from(firstLine).slice(0, 40).join("");
}
