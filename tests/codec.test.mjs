import test from "node:test";
import assert from "node:assert/strict";
import { computeHash, decodePayload, encodePayload, normalizeLf } from "../dist/codec.js";

test("CRLF와 CR만 LF로 정규화한다", () => {
  assert.equal(normalizeLf("가\r\n나\r다"), "가\n나\n다");
});

test("빈 줄과 마지막 줄바꿈을 왕복 보존한다", () => {
  const original = "첫 줄\n\n마지막 줄\n";
  const encoded = encodePayload(original);

  assert.equal(encoded, "> 첫 줄\n>\n> 마지막 줄\n>");
  assert.equal(decodePayload(encoded.split("\n")), original);
});

test("완전한 리비전 헤더 문자열도 단순 payload로 왕복한다", () => {
  const hash = "a".repeat(64);
  const original = `앞줄\n[!note]- revision 5 · 2026-08-07T14:30:00+09:00 · codex · sol · good · sha256:${hash}\n뒷줄`;

  assert.equal(decodePayload(encodePayload(original).split("\n")), original);
});

test("인용문으로 인코딩되지 않은 줄은 거부한다", () => {
  assert.throws(() => decodePayload(["> 정상", "비정상"]), /payload 인코딩/);
});

test("SHA-256은 LF 정규화 원문의 전체 소문자 해시를 반환한다", async () => {
  assert.equal(
    await computeHash("abc\r\n"),
    "sha256:edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb"
  );
});
