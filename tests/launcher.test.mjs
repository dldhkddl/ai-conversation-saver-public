import test from "node:test";
import assert from "node:assert/strict";
import { appLaunchUrl } from "../dist/launcher.js";

test("Codex와 Claude를 Windows 등록 프로토콜로 연다", () => {
  assert.equal(appLaunchUrl("codex"), "codex://");
  assert.equal(appLaunchUrl("claude"), "claude://");
});

test("알 수 없는 공급자는 실행하지 않는다", () => {
  assert.throws(() => appLaunchUrl("unknown"), /지원하지 않는/);
});
