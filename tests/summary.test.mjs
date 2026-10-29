import test from "node:test";
import assert from "node:assert/strict";
import * as summary from "../dist/summary.js";

test("메모 유무에 따라 평가 저장 버튼 라벨만 바뀐다", () => {
  assert.equal(summary.saveButtonLabel("good", "결론 메모"), "좋음으로 저장");
  assert.equal(summary.saveButtonLabel("mixed", "   "), "메모 없이 보통으로 저장");
  assert.equal(summary.saveButtonLabel("bad", ""), "메모 없이 나쁨으로 저장");
});
