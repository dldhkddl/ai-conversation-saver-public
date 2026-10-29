import test from "node:test";
import assert from "node:assert/strict";
import * as pending from "../dist/pending.js";

const now = Date.parse("2026-08-07T18:00:00+09:00");

function item(id, source, hoursAgo, level = "advanced") {
  return {
    id,
    source,
    recommendedModel: source === "codex" ? "sol" : "opus-5",
    recommendationLevel: level,
    taskExcerpt: `${id} 작업`,
    recommendedAt: new Date(now - hoursAgo * 60 * 60 * 1000).toISOString()
  };
}

test("공급자별 최근 후보가 하나일 때만 자동 선택한다", () => {
  const one = pending.recommendationChoices([item("c1", "codex", 1), item("x1", "claude", 1)], "codex", now);
  const many = pending.recommendationChoices([item("c1", "codex", 1), item("c2", "codex", 2)], "codex", now);

  assert.equal(one.defaultPendingId, "c1");
  assert.equal(one.defaultLevel, "advanced");
  assert.deepEqual(one.fresh.map((entry) => entry.id), ["c1"]);
  assert.equal(many.defaultPendingId, null);
  assert.equal(many.defaultLevel, "unknown");
});

test("4시간이 지난 후보는 수동 목록에만 있고 24시간이 지나면 제거한다", () => {
  const choices = pending.recommendationChoices([
    item("fresh", "codex", 3.9),
    item("stale", "codex", 4.1),
    item("expired", "codex", 24.1)
  ], "codex", now);

  assert.deepEqual(choices.fresh.map((entry) => entry.id), ["fresh"]);
  assert.deepEqual(choices.stale.map((entry) => entry.id), ["stale"]);
  assert.equal(choices.defaultPendingId, "fresh");
});

test("미래 시각 후보는 최근 추천으로 자동 선택하지 않고 설정에서도 제거한다", () => {
  const future = item("future", "codex", -1);

  const choices = pending.recommendationChoices([future], "codex", now);

  assert.deepEqual(choices.fresh, []);
  assert.equal(choices.defaultLevel, "unknown");
  assert.deepEqual(pending.sanitizePendingRecommendations([future], now), []);
});

test("공급자별 21번째 후보는 가장 오래된 후보부터 제거한다", () => {
  let values = [item("claude-kept", "claude", 1)];
  for (let index = 0; index < 21; index += 1) {
    values = pending.enqueuePendingRecommendation(values, item(`c${index}`, "codex", 20 - index * 0.1), now);
  }

  const codex = values.filter((entry) => entry.source === "codex");
  assert.equal(codex.length, 20);
  assert.equal(codex.some((entry) => entry.id === "c0"), false);
  assert.equal(values.some((entry) => entry.id === "claude-kept"), true);
});

test("선택한 대기 추천 ID만 소비한다", () => {
  const values = [item("one", "codex", 1), item("two", "codex", 2)];

  assert.deepEqual(pending.consumePendingRecommendation(values, "one").map((entry) => entry.id), ["two"]);
  assert.deepEqual(pending.consumePendingRecommendation(values, null).map((entry) => entry.id), ["one", "two"]);
});

test("작업 문장은 공백을 정리하고 Unicode 문자 30자로 줄인다", () => {
  assert.equal(pending.createTaskExcerpt(`  ${"😀".repeat(31)}\n 다음  `), `${"😀".repeat(30)}…`);
});

test("저장 설정의 손상된 추천 항목만 버리고 유효한 항목은 유지한다", () => {
  const valid = item("valid", "codex", 1);
  const result = pending.sanitizePendingRecommendations([
    valid,
    { ...valid, id: "bad-source", source: "other" },
    { ...valid, id: "bad-level", recommendationLevel: "extreme" },
    { ...valid, id: "bad-time", recommendedAt: "yesterday" },
    null
  ], now);

  assert.deepEqual(result, [valid]);
  assert.deepEqual(pending.sanitizePendingRecommendations([item("expired-only", "codex", 24.1)], now), []);
});
