import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTask, recommendModels } from "../dist/recommender.js";
import { DEFAULT_MODELS } from "../dist/domain.js";

test("복잡한 코딩 작업은 Sol과 Opus 5를 추천한다", () => {
  const result = recommendModels("여러 파일의 결제 코드를 리팩터링하고 복잡한 버그를 디버깅해줘");

  assert.equal(result.level, "advanced");
  assert.deepEqual(result.recommendations.map((item) => `${item.source}:${item.model}`), [
    "codex:sol",
    "claude:opus-5"
  ]);
});

test("요약과 번역 같은 가벼운 작업은 Luna와 Haiku를 추천한다", () => {
  const result = recommendModels("이 짧은 문장을 요약하고 번역해줘");

  assert.equal(result.level, "quick");
  assert.deepEqual(result.recommendations.map((item) => item.model), ["luna", "haiku-4.5"]);
});

test("블로그 글작성은 Luna와 Sonnet 5를 추천한다", () => {
  const result = recommendModels("새 상품을 소개하는 블로그 글을 작성해줘");

  assert.equal(result.level, "writing");
  assert.deepEqual(result.recommendations.map((item) => item.model), ["luna", "sonnet-5"]);
});

test("자동화 구축과 앱 구현은 Sol과 Opus 5를 추천한다", () => {
  for (const task of ["스마트스토어 가격 자동화 만들어줘", "상품 관리 앱을 구현해줘"]) {
    const result = recommendModels(task);
    assert.equal(result.level, "advanced", task);
    assert.deepEqual(result.recommendations.map((item) => item.model), ["sol", "opus-5"], task);
  }
});

test("두 파일을 비교해 우수안을 고르는 작업은 Sol과 Opus 5를 추천한다", () => {
  const result = recommendModels("파일 두개를 비교해서 어떤게 더 좋은지 비교하고싶어");

  assert.equal(result.level, "advanced");
  assert.deepEqual(result.recommendations.map((item) => item.model), ["sol", "opus-5"]);
});

test("비교라는 단어 없이 기획서 2개의 우열을 판단해도 Sol과 Opus 5를 추천한다", () => {
  const result = recommendModels("기획서 2개 보여주면어떤기획서가 더좋은지 구체적으로 확인");

  assert.equal(result.level, "advanced");
  assert.deepEqual(result.recommendations.map((item) => item.model), ["sol", "opus-5"]);
});

test("두 파일의 단순 차이만 확인하는 작업은 균형형을 유지한다", () => {
  const result = recommendModels("파일 두 개의 차이만 비교해줘");

  assert.equal(result.level, "balanced");
  assert.deepEqual(result.recommendations.map((item) => item.model), ["terra", "sonnet-5"]);
});

test("장시간 자율 작업은 Sol과 Fable 5를 추천한다", () => {
  const result = recommendModels("장시간 실행하는 자율 에이전트로 전체 마이그레이션을 진행해줘");

  assert.equal(result.level, "agentic");
  assert.deepEqual(result.recommendations.map((item) => item.model), ["sol", "fable-5"]);
});

test("특별한 신호가 없는 일반 작업은 Terra와 Sonnet 5를 추천한다", () => {
  const result = recommendModels("이번 주 업무 계획을 같이 정리해줘");

  assert.equal(result.level, "balanced");
  assert.deepEqual(result.recommendations.map((item) => item.model), ["terra", "sonnet-5"]);
  assert.ok(result.recommendations.every((item) => item.reason.length > 0));
});

test("한 공급자의 모델이 모두 꺼지면 누락 공급자를 명시한다", () => {
  const models = DEFAULT_MODELS.map((model) => ({
    ...model,
    enabled: model.source === "codex" ? false : model.enabled
  }));

  const result = recommendModels("이 문장을 요약해줘", models);

  assert.deepEqual(result.unavailableSources, ["codex"]);
  assert.deepEqual(result.recommendations.map((item) => item.source), ["claude"]);
});

test("최적 모델이 꺼져 있으면 같은 공급자의 활성 대안을 추천한다", () => {
  const models = DEFAULT_MODELS.map((model) => ({
    ...model,
    enabled: model.id === "luna" ? false : model.enabled
  }));

  const result = recommendModels("이 짧은 문장을 요약해줘", models);

  assert.deepEqual(result.unavailableSources, []);
  assert.equal(result.recommendations.find((item) => item.source === "codex")?.model, "terra");
});

test("우열 기준이 없는 파일 비교는 비교 깊이를 한 번 되묻는다", () => {
  const analysis = analyzeTask("파일 두 개 비교해줘");

  assert.equal(analysis.needsClarification, true);
  assert.equal(analysis.kind, "comparison-depth");
  assert.deepEqual(analysis.options.map((option) => option.level), ["balanced", "advanced", "agentic"]);
});

test("애매한 일반 작업은 원하는 작업 수준을 한 번 되묻는다", () => {
  const analysis = analyzeTask("이 일을 도와줘");

  assert.equal(analysis.needsClarification, true);
  assert.equal(analysis.kind, "depth");
  assert.deepEqual(analysis.options.map((option) => option.level), ["quick", "balanced", "advanced", "agentic"]);
});

test("사용자가 선택한 깊이로 모델을 추천한다", () => {
  const result = recommendModels("파일 두 개 비교해줘", DEFAULT_MODELS, "advanced");

  assert.deepEqual(result.recommendations.map((item) => item.model), ["sol", "opus-5"]);
});

test("우열 판단이 명확한 비교는 되묻지 않는다", () => {
  const analysis = analyzeTask("기획서 2개 중 어느 것이 더 좋은지 평가해줘");

  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.level, "advanced");
});

test("여러 파일이어도 번역·요약이 명확하면 비교 질문을 하지 않는다", () => {
  for (const task of ["파일 두 개를 번역해줘", "문서 여러 개를 요약해줘"]) {
    const analysis = analyzeTask(task);
    assert.equal(analysis.needsClarification, false, task);
    assert.equal(analysis.level, "quick", task);
  }
});

test("한 번 선택한 작업 수준은 같은 입력에서 다시 묻지 않는다", () => {
  const analysis = analyzeTask("파일 두 개 비교해줘", "advanced");

  assert.equal(analysis.needsClarification, false);
  assert.equal(analysis.level, "advanced");
});

test("코드 작업은 실행 환경으로 CLI 계열을 추천한다", () => {
  const result = recommendModels("여러 파일의 결제 코드를 리팩터링하고 복잡한 버그를 디버깅해줘");

  assert.equal(result.recommendations.find((item) => item.source === "codex").executionMode, "codex-cli");
  assert.equal(result.recommendations.find((item) => item.source === "claude").executionMode, "claude-code");
});

test("파일을 여러 개 다루는 작업은 Work/Cowork를 추천한다", () => {
  const result = recommendModels("업로드된 엑셀 파일 여러 개를 정리해서 하나로 합쳐줘");

  assert.equal(result.recommendations.find((item) => item.source === "codex").executionMode, "chatgpt-work");
  assert.equal(result.recommendations.find((item) => item.source === "claude").executionMode, "claude-cowork");
});

test("순수 대화형 작업은 채팅을 추천한다", () => {
  const result = recommendModels("이 짧은 문장을 요약해줘");

  assert.equal(result.recommendations.find((item) => item.source === "codex").executionMode, "chatgpt-chat");
  assert.equal(result.recommendations.find((item) => item.source === "claude").executionMode, "claude-chat");
});

test("장시간 에이전트 작업은 코드 신호가 없어도 CLI를 추천한다", () => {
  const result = recommendModels("장시간 실행하는 자율 에이전트로 전체 마이그레이션을 진행해줘");

  assert.equal(result.recommendations.find((item) => item.source === "claude").executionMode, "claude-code");
});
