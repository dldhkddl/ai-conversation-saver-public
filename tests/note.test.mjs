import test from "node:test";
import assert from "node:assert/strict";
import * as noteModule from "../dist/note.js";
import { parseEventLog } from "../dist/events.js";
import { deriveMetadata } from "../dist/metadata.js";
import {
  prepareCorrection,
  prepareRevision,
  prepareSummaryCorrection,
  rebuildConversationNote,
  sanitizeTitle,
  isSupportedConversationFrontmatter,
  splitConversationNote,
  suggestTitle,
  verifyConversationWrite
} from "../dist/note.js";

const first = {
  payload: "사용자 질문\nAI 답변",
  source: "codex",
  model: "terra",
  outcome: "mixed",
  recommendation_level: "balanced",
  summary: "첫 저장 메모",
  saved_at: "2026-08-07T14:30:00+09:00"
};

test("제목 제안과 Windows 금지 문자 정리를 분리한다", () => {
  assert.equal(suggestTitle("\n   첫 질문은 무엇인가요? 그리고 더 긴 설명"), "첫 질문은 무엇인가요? 그리고 더 긴 설명");
  assert.equal(sanitizeTitle("  스마트:스토어 / 가격*자동화... "), "스마트 스토어 가격 자동화");
  assert.equal(sanitizeTitle("<>|?."), "");
});

test("제목은 선행 점과 Windows 예약어를 안전하게 바꾼다", () => {
  assert.equal(sanitizeTitle("... CON"), "CON_");
  assert.equal(sanitizeTitle("CON.report"), "CON_.report");
  assert.equal(sanitizeTitle("lpt1"), "lpt1_");
});

test("제목과 충돌 접미사는 이모지를 깨뜨리지 않고 합계 120자로 제한한다", () => {
  const emojiTitle = sanitizeTitle("😀".repeat(121));
  const suffixed = sanitizeTitle("가".repeat(120) + ". ", " (2)");

  assert.equal(Array.from(emojiTitle).length, 120);
  assert.equal(Array.from(suffixed).length, 120);
  assert.ok(suffixed.endsWith(" (2)"));
  assert.equal(Array.from(suffixed).at(-1), ")");
});

test("새 노트는 빈 줄 경계 뒤에 첫 리비전과 평면 frontmatter를 만든다", async () => {
  const result = await prepareRevision("", first);
  assert.equal(result.changed, true);
  assert.match(result.content, /^---\ntype: "ai-conversation"\nschema_version: 2/m);

  const { body } = splitConversationNote(result.content);
  assert.ok(body.startsWith("\n> [!note]- revision 1"));
  const metadata = await deriveMetadata(parseEventLog(body));
  assert.equal(metadata.revision_count, 1);
  assert.equal(metadata.revisions[0].dedupe_hash, result.hash);
});

test("기존 본문은 바꾸지 않고 파일 끝에 새 리비전만 추가한다", async () => {
  const one = await prepareRevision("", first);
  const beforeBody = splitConversationNote(one.content).body;
  const two = await prepareRevision(one.content, {
    ...first,
    payload: "두 번째 전체 원문",
    model: "sol",
    outcome: "good",
    saved_at: "2026-08-07T15:30:00+09:00"
  });
  const afterBody = splitConversationNote(two.content).body;

  assert.equal(two.changed, true);
  assert.ok(afterBody.startsWith(beforeBody));
  assert.equal((await deriveMetadata(parseEventLog(afterBody))).revision_count, 2);
});

test("마지막이 아닌 과거 리비전과 같아도 중복으로 차단하고 문자열을 만들지 않는다", async () => {
  const one = await prepareRevision("", first);
  const two = await prepareRevision(one.content, {
    ...first,
    payload: "다른 원문",
    saved_at: "2026-08-07T15:30:00+09:00"
  });
  const duplicate = await prepareRevision(two.content, {
    ...first,
    saved_at: "2026-08-07T16:30:00+09:00"
  });

  assert.deepEqual(duplicate, { changed: false, hash: one.hash, duplicateRev: 1, warnings: [] });
});

test("schema 1과 지원 버전보다 큰 schema 3은 모든 쓰기를 거부한다", async () => {
  const one = await prepareRevision("", first);
  const old = one.content.replace("schema_version: 2", "schema_version: 1");
  const future = one.content.replace("schema_version: 2", "schema_version: 3");

  await assert.rejects(() => prepareRevision(old, { ...first, payload: "추가" }), /지원하지 않는 schema_version 1/);
  await assert.rejects(() => prepareRevision(future, { ...first, payload: "추가" }), /지원하지 않는 schema_version 3/);
  await assert.rejects(() => prepareCorrection(future, {
    action: "void", target_rev: 1, corrected_at: "2026-08-07T16:00:00+09:00"
  }), /지원하지 않는 schema_version 3/);
  await assert.rejects(() => rebuildConversationNote(future), /지원하지 않는 schema_version 3/);
});

test("정확히 schema_version 2만 쓰며 0과 중복 키를 거부한다", async () => {
  const one = await prepareRevision("", first);
  const zero = one.content.replace("schema_version: 2", "schema_version: 0");
  const duplicateFuture = one.content.replace("schema_version: 2", "schema_version: 2\nschema_version: 999");
  const commentedDuplicateFuture = one.content.replace("schema_version: 2", "schema_version: 2\nschema_version: 999 # future");

  await assert.rejects(() => prepareRevision(zero, { ...first, payload: "추가" }), /schema_version/);
  await assert.rejects(() => prepareRevision(duplicateFuture, { ...first, payload: "추가" }), /schema_version/);
  await assert.rejects(() => prepareRevision(commentedDuplicateFuture, { ...first, payload: "추가" }), /schema_version/);
});

test("메모 보완 UI는 정확히 schema 2 AI 대화 노트에만 노출한다", () => {
  assert.equal(isSupportedConversationFrontmatter({ type: "ai-conversation", schema_version: 2 }), true);
  assert.equal(isSupportedConversationFrontmatter({ type: "ai-conversation", schema_version: 1 }), false);
  assert.equal(isSupportedConversationFrontmatter({ type: "ai-conversation", schema_version: 3 }), false);
  assert.equal(isSupportedConversationFrontmatter({ type: "note", schema_version: 2 }), false);
});

test("손으로 201자로 늘린 유효 JSON 메모는 노트를 잠그지 않고 frontmatter에서만 줄인다", async () => {
  const one = await prepareRevision("", first);
  const longSummary = "가".repeat(201);
  const edited = one.content.replace('summary:"첫 저장 메모"', `summary:${JSON.stringify(longSummary)}`);

  const rebuilt = await rebuildConversationNote(edited);
  const split = splitConversationNote(rebuilt);
  const metadata = await deriveMetadata(parseEventLog(split.body));

  assert.equal(Array.from(metadata.revisions[0].summary).length, 200);
  assert.ok(split.body.includes(`summary:${JSON.stringify(longSummary)}`));

  const detailed = await noteModule.rebuildConversationNoteDetailed(edited);
  assert.deepEqual(detailed.warnings, ["revision 1의 한 줄 메모가 200자로 축약되었습니다."]);
});

test("정정은 기존 본문을 보존한 채 append-only 이벤트를 추가한다", async () => {
  const one = await prepareRevision("", first);
  const beforeBody = splitConversationNote(one.content).body;
  const corrected = await prepareCorrection(one.content, {
    action: "void",
    target_rev: 1,
    corrected_at: "2026-08-07T16:00:00+09:00",
    reason: "잘못된 노트"
  });
  const afterBody = splitConversationNote(corrected.content).body;
  const metadata = await deriveMetadata(parseEventLog(afterBody));

  assert.ok(afterBody.startsWith(beforeBody));
  assert.equal(metadata.effective_revision_count, 0);
  assert.equal(metadata.revisions[0].voided, true);
});

test("메모 보완은 기존 본문을 보존하고 last_saved_at을 바꾸지 않는다", async () => {
  const one = await prepareRevision("", { ...first, summary: "" });
  const beforeBody = splitConversationNote(one.content).body;
  const corrected = await prepareSummaryCorrection(one.content, {
    target_rev: 1,
    corrected_at: "2026-08-08T09:00:00+09:00",
    summary: "나중에 채운 결론"
  });
  const after = splitConversationNote(corrected.content);

  assert.ok(after.body.startsWith(beforeBody));
  assert.equal(corrected.metadata.revisions[0].summary, "나중에 채운 결론");
  assert.equal(corrected.metadata.last_saved_at, first.saved_at);
});

test("쓰기 검증은 예상 정정 메타데이터와 해시 개수가 다르면 실패한다", async () => {
  const one = await prepareRevision("", first);
  const corrected = await prepareCorrection(one.content, {
    action: "void", target_rev: 1, corrected_at: "2026-08-07T16:00:00+09:00", reason: "검증"
  });

  await verifyConversationWrite(corrected.content, corrected.metadata, one.hash);
  await assert.rejects(() => verifyConversationWrite(one.content, corrected.metadata, one.hash), /frontmatter 검증|메타데이터 검증/);
  await assert.rejects(() => verifyConversationWrite(corrected.content, corrected.metadata, `sha256:${"f".repeat(64)}`), /해시 검증/);
  const staleFrontmatter = corrected.content.replace("last_outcome: null", 'last_outcome: "good"');
  await assert.rejects(() => verifyConversationWrite(staleFrontmatter, corrected.metadata, one.hash), /frontmatter 검증/);
});

test("설계서 §7.2 형식 전문이 payload여도 재구축 전후 의미와 본문이 같다", async () => {
  const hash = "a".repeat(64);
  const section = [
    "### 7.2 리비전 본문",
    "",
    `> [!note]- revision 1 · 2026-08-07T14:30:00+09:00 · codex · terra · mixed · sha256:${hash}`,
    "> 사용자가 복사한 첫 번째 줄",
    "> 두 번째 줄",
    ">",
    "> 네 번째 줄",
    "",
    "고정 헤더 형식입니다."
  ].join("\n");
  const saved = await prepareRevision("", { ...first, payload: section });
  const rebuilt = await rebuildConversationNote(saved.content);
  const before = splitConversationNote(saved.content);
  const after = splitConversationNote(rebuilt);

  assert.equal(after.body, before.body);
  assert.equal(after.frontmatter, before.frontmatter);
  assert.equal((await deriveMetadata(parseEventLog(after.body))).revision_count, 1);
});
