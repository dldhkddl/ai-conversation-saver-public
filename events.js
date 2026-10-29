"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderRevisionBlock = renderRevisionBlock;
exports.renderCorrectionBlock = renderCorrectionBlock;
exports.appendEventBlock = appendEventBlock;
exports.parseEventLog = parseEventLog;
const codec_1 = require("./codec");
const ID_PATTERN = "[a-z0-9][a-z0-9._-]*";
const ISO_PATTERN = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})";
const REVISION_HEADER = new RegExp(`^> \\[!note\\]- revision ([1-9]\\d*) · (${ISO_PATTERN}) · (${ID_PATTERN}) · (${ID_PATTERN}) · (good|mixed|bad) · sha256:([0-9a-f]{64})$`);
const CORRECTION_HEADER = new RegExp(`^> \\[!(warning|success)\\]- correction (void|restore) · revision ([1-9]\\d*) · (${ISO_PATTERN})$`);
function renderRevisionBlock(input) {
    const header = `> [!note]- revision ${input.rev} · ${input.saved_at} · ${input.source} · ${input.model} · ${input.outcome} · ${input.dedupe_hash}`;
    return `${header}\n${(0, codec_1.encodePayload)(input.payload)}`;
}
function renderCorrectionBlock(input) {
    const callout = input.action === "void" ? "warning" : "success";
    const header = `> [!${callout}]- correction ${input.action} · revision ${input.target_rev} · ${input.corrected_at}`;
    return `${header}\n${(0, codec_1.encodePayload)(input.reason ?? "")}`;
}
function appendEventBlock(body, block) {
    if (body === "")
        return `\n${block}\n`;
    if (body.endsWith("\n\n"))
        return `${body}${block}\n`;
    if (body.endsWith("\n"))
        return `${body}\n${block}\n`;
    return `${body}\n\n${block}\n`;
}
function parseEventLog(body) {
    const lines = (0, codec_1.normalizeLf)(body).split("\n");
    const events = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line === undefined || (index > 0 && lines[index - 1] !== ""))
            continue;
        const revisionMatch = line.match(REVISION_HEADER);
        const correctionMatch = line.match(CORRECTION_HEADER);
        if (!revisionMatch && line.startsWith("> [!note]- revision ")) {
            throw new Error(`${index + 1}행: 리비전 헤더 형식이 올바르지 않습니다.`);
        }
        if (!correctionMatch && /^> \[!(?:warning|success)\]- correction /.test(line)) {
            throw new Error(`${index + 1}행: 정정 헤더 형식이 올바르지 않습니다.`);
        }
        if (!revisionMatch && !correctionMatch)
            continue;
        const payloadLines = [];
        let cursor = index + 1;
        while (cursor < lines.length && lines[cursor] !== "") {
            const payloadLine = lines[cursor];
            if (payloadLine !== undefined)
                payloadLines.push(payloadLine);
            cursor += 1;
        }
        if (payloadLines.length === 0) {
            throw new Error(`${index + 1}행: 이벤트 payload가 없습니다.`);
        }
        const payload = (0, codec_1.decodePayload)(payloadLines);
        if (revisionMatch) {
            const [, rev, savedAt, source, model, outcome, hash] = revisionMatch;
            if (!rev || !savedAt || !source || !model || !outcome || !hash) {
                throw new Error(`${index + 1}행: 리비전 헤더를 해석할 수 없습니다.`);
            }
            if (!isValidIsoTimestamp(savedAt))
                throw new Error(`${index + 1}행: 리비전 저장 시각이 올바르지 않습니다.`);
            const event = {
                kind: "revision",
                rev: Number(rev),
                saved_at: savedAt,
                source,
                model,
                outcome: outcome,
                dedupe_hash: `sha256:${hash}`,
                payload
            };
            events.push(event);
        }
        else if (correctionMatch) {
            const [, callout, action, targetRev, correctedAt] = correctionMatch;
            if (!callout || !action || !targetRev || !correctedAt) {
                throw new Error(`${index + 1}행: 정정 헤더를 해석할 수 없습니다.`);
            }
            if (!isValidIsoTimestamp(correctedAt))
                throw new Error(`${index + 1}행: 정정 시각이 올바르지 않습니다.`);
            if ((action === "void" && callout !== "warning") || (action === "restore" && callout !== "success")) {
                throw new Error(`${index + 1}행: 정정 종류와 callout이 일치하지 않습니다.`);
            }
            const event = {
                kind: "correction",
                action: action,
                target_rev: Number(targetRev),
                corrected_at: correctedAt,
                ...(payload === "" ? {} : { reason: payload })
            };
            events.push(event);
        }
        index = cursor - 1;
    }
    return events;
}
function isValidIsoTimestamp(value) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/);
    if (!match)
        return false;
    const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, , , , offsetHourRaw, offsetMinuteRaw] = match;
    if (!yearRaw || !monthRaw || !dayRaw || !hourRaw || !minuteRaw || !secondRaw)
        return false;
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    const second = Number(secondRaw);
    if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59)
        return false;
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day)
        return false;
    if (offsetHourRaw !== undefined && offsetMinuteRaw !== undefined) {
        const offsetHour = Number(offsetHourRaw);
        const offsetMinute = Number(offsetMinuteRaw);
        if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0))
            return false;
    }
    return !Number.isNaN(Date.parse(value));
}
