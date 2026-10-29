import test from "node:test";
import assert from "node:assert/strict";
import * as eventModule from "../dist/events.js";
import { computeHash } from "../dist/codec.js";
import {
  appendEventBlock,
  parseEventLog,
  renderCorrectionBlock,
  renderRecommendationFeedbackBlock,
  renderRevisionBlock,
  renderSummaryCorrectionBlock
} from "../dist/events.js";

const savedAt = "2026-08-07T14:30:00+09:00";

async function revisionBlock(rev, payload, overrides = {}) {
  return renderRevisionBlock({
    rev,
    saved_at: savedAt,
    source: "codex",
    model: "sol",
    outcome: "good",
    recommendation_level: "advanced",
    summary: "핵심 메모",
    dedupe_hash: await computeHash(payload),
    payload,
    ...overrides
  });
}

test("실제 빈 줄 경계의 리비전만 이벤트로 인식한다", async () => {
  const fakeHash = "b".repeat(64);
  const payload = [
    "설계 대화",
    ` [!note]- revision 9 · ${savedAt} · codex · sol · good · sha256:${fakeHash}`,
    ` [!warning]- correction void · revision 1 · ${savedAt}`
  ].join("\n").replaceAll("\n ", "\n");
  const body = appendEventBlock("", await revisionBlock(1, payload));

  const events = parseEventLog(body);

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "revision");
  assert.equal(events[0].payload, payload);
});

test("실제 빈 줄로 분리된 정정 이벤트는 순서대로 파싱한다", async () => {
  let body = appendEventBlock("", await revisionBlock(1, "원문"));
  body = appendEventBlock(body, renderCorrectionBlock({
    action: "void",
    target_rev: 1,
    corrected_at: "2026-08-07T15:00:00+09:00",
    reason: "잘못된 노트"
  }));

  const events = parseEventLog(body);

  assert.deepEqual(events.map((event) => event.kind), ["revision", "correction"]);
  assert.equal(events[1].reason, "잘못된 노트");
});

test("경계의 구조 헤더가 전체 64자리 소문자 해시가 아니면 오류로 중단한다", () => {
  const body = `\n> [!note]- revision 1 · ${savedAt} · codex · sol · good · sha256:abc\n> 원문\n`;
  assert.throws(() => parseEventLog(body), /리비전 헤더/);
});

test("리비전과 정정 헤더의 시각이 ISO-8601이 아니면 거부한다", async () => {
  const hash = (await computeHash("원문")).slice(7);
  const revision = `\n> [!note]- revision 1 · yesterday · codex · sol · good · sha256:${hash}\n> 원문\n`;
  const correction = "\n> [!warning]- correction void · revision 1 · 2026-02-30T10:00:00+09:00\n> 사유\n";
  assert.throws(() => parseEventLog(revision), /리비전 헤더/);
  assert.throws(() => parseEventLog(correction), /정정.*시각/);
});

test("메모의 구분자와 따옴표와 역슬래시를 JSON 문자열로 왕복한다", async () => {
  const summary = "배송비 · 표시 시점을 \"결제 단계\"로 이동 \\ 확인";
  const body = appendEventBlock("", await revisionBlock(1, "원문", { summary }));

  const [event] = parseEventLog(body);

  assert.equal(event.summary, summary);
  assert.match(body, /summary:"배송비 · 표시 시점을 \\\"결제 단계\\\"로 이동 \\\\ 확인"/);
});

test("빈 메모와 summary 정정 이벤트를 파싱한다", async () => {
  let body = appendEventBlock("", await revisionBlock(1, "원문", { summary: "" }));
  body = appendEventBlock(body, renderSummaryCorrectionBlock({
    target_rev: 1,
    corrected_at: "2026-08-07T16:00:00+09:00",
    summary: "나중에 보완"
  }));

  const events = parseEventLog(body);

  assert.equal(events[0].summary, "");
  assert.equal(events[1].kind, "summary-correction");
  assert.equal(events[1].summary, "나중에 보완");
});

test("JSON 파싱이 불가능한 메모만 구조 오류로 거부한다", async () => {
  const valid = appendEventBlock("", await revisionBlock(1, "원문"));
  const broken = valid.replace('summary:"핵심 메모"', 'summary:"닫히지 않음');

  assert.throws(() => parseEventLog(broken), /리비전 헤더|summary/);
});

test("payload 속 schema 2 헤더와 summary 정정 문자열은 이벤트가 아니다", async () => {
  const hash = "a".repeat(64);
  const payload = [
    `> [!note]- revision 9 · ${savedAt} · codex · sol · good · level:advanced · sha256:${hash} · summary:"가짜"`,
    `> [!info]- correction summary · revision 9 · ${savedAt} · summary:"가짜 정정"`
  ].join("\n");
  const body = appendEventBlock("", await revisionBlock(1, payload));

  assert.equal(parseEventLog(body).length, 1);
});

test("201자 메모는 파싱을 막지 않고 축약 경고를 반환한다", async () => {
  const body = appendEventBlock("", await revisionBlock(1, "원문"));
  const edited = body.replace('summary:"핵심 메모"', `summary:${JSON.stringify("가".repeat(201))}`);

  const result = eventModule.parseEventLogDetailed(edited);

  assert.equal(Array.from(result.events[0].summary).length, 200);
  assert.deepEqual(result.warnings, ["revision 1의 한 줄 메모가 200자로 축약되었습니다."]);
});

test("실제 빈 줄 없이 파일 첫 줄에서 시작한 구조 헤더는 경계 오류다", async () => {
  const block = await revisionBlock(1, "원문");

  assert.throws(() => parseEventLog(block), /빈 줄 경계/);
});

test("outcome:unknown은 유효한 값으로 파싱된다 (과거 기록 가져오기용)", async () => {
  const body = appendEventBlock("", await revisionBlock(1, "원문", { outcome: "unknown" }));

  const events = parseEventLog(body);

  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "unknown");
});

test("outcome이 good·mixed·bad·unknown 외의 값이면 거부한다", async () => {
  const body = (await revisionBlock(1, "원문")).replace(" · good · ", " · excellent · ");

  assert.throws(() => parseEventLog(appendEventBlock("", body)), /리비전 헤더/);
});

test("payload 속 unknown outcome 헤더 문자열은 이벤트가 아니다", async () => {
  const hash = "c".repeat(64);
  const payload = `> [!note]- revision 9 · ${savedAt} · codex · sol · unknown · level:advanced · sha256:${hash} · summary:"침입"`;
  const body = appendEventBlock("", await revisionBlock(1, payload));

  assert.equal(parseEventLog(body).length, 1);
});

test("recommendation-feedback 이벤트가 왕복 파싱된다", () => {
  const block = renderRecommendationFeedbackBlock({
    target_rev: 1,
    recorded_at: savedAt,
    recommended_model: "sol",
    recommended_mode: "codex-cli",
    selected_model: "opus-5",
    selected_mode: "claude-code",
    result: "good",
    reason: "Claude Code가 기존 CLAUDE.md를 더 잘 활용함"
  });

  const events = parseEventLog(appendEventBlock("", block));

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "recommendation-feedback");
  assert.equal(events[0].target_rev, 1);
  assert.equal(events[0].recommended_model, "sol");
  assert.equal(events[0].recommended_mode, "codex-cli");
  assert.equal(events[0].selected_model, "opus-5");
  assert.equal(events[0].selected_mode, "claude-code");
  assert.equal(events[0].result, "good");
  assert.equal(events[0].reason, "Claude Code가 기존 CLAUDE.md를 더 잘 활용함");
});

test("recommendation-feedback 이벤트는 reason 없이도 저장된다", () => {
  const block = renderRecommendationFeedbackBlock({
    target_rev: 2,
    recorded_at: savedAt,
    recommended_model: "luna",
    recommended_mode: "chatgpt-chat",
    selected_model: "luna",
    selected_mode: "chatgpt-chat",
    result: "good"
  });

  const events = parseEventLog(appendEventBlock("", block));

  assert.equal(events[0].reason, undefined);
});

test("recommendation-feedback의 result가 잘못된 값이면 거부한다", () => {
  const block = renderRecommendationFeedbackBlock({
    target_rev: 1,
    recorded_at: savedAt,
    recommended_model: "sol",
    recommended_mode: "codex-cli",
    selected_model: "opus-5",
    selected_mode: "claude-code",
    result: "good"
  }).replace("result:good", "result:excellent");

  assert.throws(() => parseEventLog(appendEventBlock("", block)), /해석할 수 없|형식이 올바르지/);
});
