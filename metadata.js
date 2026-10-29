"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveMetadata = deriveMetadata;
const codec_1 = require("./codec");
const domain_1 = require("./domain");
async function deriveMetadata(events) {
    const revisions = [];
    const corrections = [];
    const byRevision = new Map();
    for (const event of events) {
        if (event.kind === "revision") {
            const expectedRevision = revisions.length + 1;
            if (event.rev !== expectedRevision) {
                throw new Error(`리비전 번호 오류: ${expectedRevision}이 필요하지만 ${event.rev}을 찾았습니다.`);
            }
            const actualHash = await (0, codec_1.computeHash)(event.payload);
            if (actualHash !== event.dedupe_hash) {
                throw new Error(`리비전 ${event.rev} 해시 불일치: 원문이 변경되었을 수 있습니다.`);
            }
            const revision = {
                rev: event.rev,
                source: event.source,
                model: event.model,
                outcome: event.outcome,
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
            throw new Error(`존재하지 않는 리비전 ${event.target_rev}의 정정 이벤트입니다.`);
        }
        target.voided = event.action === "void";
        corrections.push({
            action: event.action,
            target_rev: event.target_rev,
            corrected_at: event.corrected_at,
            ...(event.reason === undefined ? {} : { reason: event.reason })
        });
    }
    if (revisions.length === 0) {
        throw new Error("리비전이 하나도 없습니다.");
    }
    const effective = revisions.filter((revision) => !revision.voided);
    const uniqueInOrder = (values) => [...new Set(values)];
    const lastEffective = effective.at(-1);
    const firstRevision = revisions[0];
    const lastRevision = revisions.at(-1);
    if (!firstRevision || !lastRevision)
        throw new Error("리비전 메타데이터를 만들 수 없습니다.");
    return {
        type: "ai-conversation",
        schema_version: domain_1.SCHEMA_VERSION,
        created_at: firstRevision.saved_at,
        last_saved_at: lastRevision.saved_at,
        sources: uniqueInOrder(effective.map((revision) => revision.source)),
        models: uniqueInOrder(effective.map((revision) => revision.model)),
        last_outcome: lastEffective?.outcome ?? null,
        revision_count: revisions.length,
        effective_revision_count: effective.length,
        revisions,
        corrections
    };
}
