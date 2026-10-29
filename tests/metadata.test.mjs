import test from "node:test";
import assert from "node:assert/strict";
import { computeHash } from "../dist/codec.js";
import { appendEventBlock, parseEventLog, renderCorrectionBlock, renderRecommendationFeedbackBlock, renderRevisionBlock, renderSummaryCorrectionBlock } from "../dist/events.js";
import { deriveMetadata } from "../dist/metadata.js";

test("추천 피드백은 대상 리비전 메타데이터를 바꾸지 않는다", async () => {
  let body = await addRevision("", 1, "첫 시도", "sol", "good");
  body = appendEventBlock(body, renderRecommendationFeedbackBlock({
    target_rev: 1,
    recorded_at: "2026-08-07T16:00:00+09:00",
    recommended_model: "sol",
    recommended_mode: "codex-cli",
    selected_model: "opus-5",
    selected_mode: "claude-code",
    result: "good"
  }));

  const metadata = await deriveMetadata(parseEventLog(body));

  assert.equal(metadata.revisions[0].voided, false);
  assert.equal(metadata.revisions[0].summary, "첫 메모");
  assert.equal(metadata.last_saved_at, firstAt);
  assert.deepEqual(metadata.corrections, []);
});

test("존재하지 않는 리비전의 추천 피드백은 거부된다", async () => {
  let body = await addRevision("", 1, "본문", "sol", "good");
  body = appendEventBlock(body, renderRecommendationFeedbackBlock({
    target_rev: 9,
    recorded_at: secondAt,
    recommended_model: "sol",
    recommended_mode: "codex-cli",
    selected_model: "opus-5",
    selected_mode: "claude-code",
    result: "good"
  }));

  await assert.rejects(() => deriveMetadata(parseEventLog(body)), /존재하지 않는 리비전/);
});

const firstAt = "2026-08-07T14:30:00+09:00";
const secondAt = "2026-08-07T15:30:00+09:00";

async function addRevision(body, rev, payload, model, outcome, hash) {
  return appendEventBlock(body, renderRevisionBlock({
    rev,
    saved_at: rev === 1 ? firstAt : secondAt,
    source: "codex",
    model,
    outcome,
    recommendation_level: rev === 1 ? "advanced" : "balanced",
    summary: rev === 1 ? "첫 메모" : "둘째 메모",
    dedupe_hash: hash ?? await computeHash(payload),
    payload
  }));
}

test("마지막 정정 이벤트가 유효성을 결정하고 평면 메타데이터를 다시 만든다", async () => {
  let body = await addRevision("", 1, "첫 시도", "terra", "mixed");
  body = await addRevision(body, 2, "두 번째 시도", "sol", "good");
  body = appendEventBlock(body, renderCorrectionBlock({
    action: "void", target_rev: 2, corrected_at: "2026-08-07T16:00:00+09:00", reason: "오선택"
  }));
  body = appendEventBlock(body, renderCorrectionBlock({
    action: "restore", target_rev: 2, corrected_at: "2026-08-07T16:05:00+09:00", reason: "복원"
  }));

  const metadata = await deriveMetadata(parseEventLog(body));

  assert.equal(metadata.schema_version, 2);
  assert.deepEqual(metadata.models, ["terra", "sol"]);
  assert.equal(metadata.last_outcome, "good");
  assert.equal(metadata.revision_count, 2);
  assert.equal(metadata.effective_revision_count, 2);
  assert.equal(metadata.revisions[1].voided, false);
  assert.equal(metadata.corrections.length, 2);
});

test("마지막 summary 정정만 현재 메모가 되고 last_saved_at은 리비전 시각을 유지한다", async () => {
  let body = await addRevision("", 1, "첫 시도", "sol", "good");
  body = appendEventBlock(body, renderSummaryCorrectionBlock({
    target_rev: 1,
    corrected_at: "2026-08-07T16:00:00+09:00",
    summary: "첫 보완"
  }));
  body = appendEventBlock(body, renderSummaryCorrectionBlock({
    target_rev: 1,
    corrected_at: "2026-08-07T17:00:00+09:00",
    summary: "최종 보완"
  }));

  const metadata = await deriveMetadata(parseEventLog(body));

  assert.equal(metadata.revisions[0].summary, "최종 보완");
  assert.equal(metadata.last_saved_at, firstAt);
  assert.deepEqual(metadata.corrections.map((item) => item.action), ["summary", "summary"]);
});

test("unknown과 무효 리비전은 최상위 추천 단계 집계에서 제외한다", async () => {
  let body = appendEventBlock("", renderRevisionBlock({
    rev: 1,
    saved_at: firstAt,
    source: "codex",
    model: "terra",
    outcome: "mixed",
    recommendation_level: "unknown",
    summary: "미분류",
    dedupe_hash: await computeHash("첫 시도"),
    payload: "첫 시도"
  }));
  body = await addRevision(body, 2, "두 번째", "sol", "good");
  body = appendEventBlock(body, renderCorrectionBlock({
    action: "void",
    target_rev: 2,
    corrected_at: "2026-08-07T16:00:00+09:00"
  }));

  const voided = await deriveMetadata(parseEventLog(body));
  assert.deepEqual(voided.recommendation_levels, []);

  body = appendEventBlock(body, renderCorrectionBlock({
    action: "restore",
    target_rev: 2,
    corrected_at: "2026-08-07T16:05:00+09:00"
  }));
  const restored = await deriveMetadata(parseEventLog(body));
  assert.deepEqual(restored.recommendation_levels, ["balanced"]);
});

test("마지막 유효 리비전이 unknown이면 last_outcome도 unknown으로 정직하게 남는다", async () => {
  let body = await addRevision("", 1, "첫 시도", "sol", "good");
  body = await addRevision(body, 2, "두 번째", "sol", "unknown");

  const metadata = await deriveMetadata(parseEventLog(body));

  assert.equal(metadata.last_outcome, "unknown");
  assert.equal(metadata.revisions[1].outcome, "unknown");
});

test("unknown 리비전을 무효화하면 이전 유효 리비전의 outcome이 last_outcome이 된다", async () => {
  let body = await addRevision("", 1, "첫 시도", "sol", "good");
  body = await addRevision(body, 2, "두 번째", "sol", "unknown");
  body = appendEventBlock(body, renderCorrectionBlock({
    action: "void", target_rev: 2, corrected_at: "2026-08-07T16:00:00+09:00"
  }));

  const metadata = await deriveMetadata(parseEventLog(body));

  assert.equal(metadata.last_outcome, "good");
  assert.equal(metadata.effective_revision_count, 1);
});

test("리비전 번호가 1부터 연속되지 않으면 거부한다", async () => {
  const body = await addRevision("", 2, "건너뜀", "sol", "good");
  await assert.rejects(() => deriveMetadata(parseEventLog(body)), /리비전 번호/);
});

test("payload 해시가 헤더와 다르면 거부한다", async () => {
  const body = await addRevision("", 1, "원문", "sol", "good", `sha256:${"0".repeat(64)}`);
  await assert.rejects(() => deriveMetadata(parseEventLog(body)), /해시 불일치/);
});

test("존재하지 않는 리비전의 정정은 거부한다", async () => {
  let body = await addRevision("", 1, "원문", "sol", "good");
  body = appendEventBlock(body, renderCorrectionBlock({
    action: "void", target_rev: 9, corrected_at: secondAt, reason: "잘못된 대상"
  }));
  await assert.rejects(() => deriveMetadata(parseEventLog(body)), /존재하지 않는 리비전/);
});
