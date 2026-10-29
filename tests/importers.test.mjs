import test from "node:test";
import assert from "node:assert/strict";
import { parseClaudeExport } from "../dist/importers/claude-export.js";
import { parseChatGptExport } from "../dist/importers/chatgpt-export.js";
import { prepareRevision, splitConversationNote, sanitizeTitle } from "../dist/note.js";
import { parseEventLog } from "../dist/events.js";
import { deriveMetadata } from "../dist/metadata.js";

test("Claude 내보내기: Untitled는 첫 사용자 메시지로 대체하고 사용자/AI 순서를 보존한다", () => {
  const raw = [
    {
      uuid: "abc",
      name: "Untitled",
      created_at: "2026-07-01T10:00:00.123456Z",
      chat_messages: [
        { sender: "human", text: "가격 자동화 어떻게 할까" },
        { sender: "assistant", content: [{ type: "text", text: "이렇게 하면 됩니다" }] }
      ]
    }
  ];

  const result = parseClaudeExport(raw);

  assert.equal(result.conversations.length, 1);
  assert.equal(result.conversations[0].source, "claude");
  assert.equal(result.conversations[0].title, "가격 자동화 어떻게 할까");
  assert.equal(
    result.conversations[0].transcript,
    "사용자: 가격 자동화 어떻게 할까\n\nAI: 이렇게 하면 됩니다"
  );
  assert.match(result.conversations[0].savedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("Claude 내보내기: chat_messages가 없는 대화는 전체를 중단하지 않고 개별 오류로 보고한다", () => {
  const raw = [
    { uuid: "ok", name: "정상", created_at: "2026-07-01T10:00:00Z", chat_messages: [{ sender: "human", text: "안녕" }] },
    { uuid: "bad", name: "깨짐" }
  ];

  const result = parseClaudeExport(raw);

  assert.equal(result.conversations.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /대화 2/);
});

test("Claude 내보내기: 최상위가 배열이 아니면 전체 오류 하나를 반환한다", () => {
  const result = parseClaudeExport({ not: "array" });

  assert.equal(result.conversations.length, 0);
  assert.equal(result.errors.length, 1);
});

test("ChatGPT 내보내기: current_node 체인만 포함하고 폐기된 분기는 제외한다", () => {
  const raw = [
    {
      title: "가격 크롤링 문의",
      create_time: 1690000000,
      current_node: "n3",
      mapping: {
        root: { message: null, parent: null, children: ["n1"] },
        n1: { message: { author: { role: "user" }, content: { parts: ["안녕"] }, create_time: 1690000001 }, parent: "root", children: ["n2", "n2b"] },
        n2: { message: { author: { role: "assistant" }, content: { parts: ["폐기된 분기 응답"] }, create_time: 1690000002 }, parent: "n1", children: [] },
        n2b: { message: { author: { role: "assistant" }, content: { parts: ["최신 응답"] }, create_time: 1690000003 }, parent: "n1", children: ["n3"] },
        n3: { message: { author: { role: "user" }, content: { parts: ["고마워"] }, create_time: 1690000004 }, parent: "n2b", children: [] }
      }
    }
  ];

  const result = parseChatGptExport(raw);

  assert.equal(result.conversations.length, 1);
  assert.equal(result.conversations[0].source, "codex");
  assert.equal(
    result.conversations[0].transcript,
    "사용자: 안녕\n\nAI: 최신 응답\n\n사용자: 고마워"
  );
});

test("ChatGPT 내보내기: current_node가 없으면 가장 최근 leaf에서 역추적한다", () => {
  const raw = [
    {
      title: "제목만",
      mapping: {
        root: { message: null, parent: null, children: ["n1"] },
        n1: { message: { author: { role: "user" }, content: { parts: ["질문"] }, create_time: 100 }, parent: "root", children: ["n2"] },
        n2: { message: { author: { role: "assistant" }, content: { parts: ["답변"] }, create_time: 200 }, parent: "n1", children: [] }
      }
    }
  ];

  const result = parseChatGptExport(raw);

  assert.equal(result.conversations.length, 1);
  assert.equal(result.conversations[0].transcript, "사용자: 질문\n\nAI: 답변");
});

test("ChatGPT 내보내기: system·tool 역할은 transcript에서 제외한다", () => {
  const raw = [
    {
      title: "system 스킵",
      current_node: "n2",
      mapping: {
        root: { message: null, parent: null, children: ["n0"] },
        n0: { message: { author: { role: "system" }, content: { parts: ["시스템 프롬프트"] }, create_time: 1 }, parent: "root", children: ["n1"] },
        n1: { message: { author: { role: "user" }, content: { parts: ["질문"] }, create_time: 2 }, parent: "n0", children: ["n2"] },
        n2: { message: { author: { role: "assistant" }, content: { parts: ["답변"] }, create_time: 3 }, parent: "n1", children: [] }
      }
    }
  ];

  const result = parseChatGptExport(raw);

  assert.ok(!result.conversations[0].transcript.includes("시스템 프롬프트"));
});

test("ChatGPT 내보내기: parent 순환 참조에서도 무한루프 없이 종료한다", () => {
  const raw = [
    {
      title: "순환",
      current_node: "n2",
      mapping: {
        n1: { message: { author: { role: "user" }, content: { parts: ["a"] }, create_time: 1 }, parent: "n2", children: [] },
        n2: { message: { author: { role: "assistant" }, content: { parts: ["b"] }, create_time: 2 }, parent: "n1", children: [] }
      }
    }
  ];

  const result = parseChatGptExport(raw);

  assert.equal(result.conversations.length + result.errors.length, 1);
});

test("가져온 대화를 노트로 만들면 outcome:unknown·model:unknown으로 왕복한다", async () => {
  const raw = [
    {
      uuid: "abc",
      name: "복숭아 배송 문의",
      created_at: "2026-06-01T09:00:00.000000Z",
      chat_messages: [
        { sender: "human", text: "복숭아 배송비 얼마야?" },
        { sender: "assistant", text: "3천원입니다." }
      ]
    }
  ];
  const conversation = parseClaudeExport(raw).conversations[0];

  const prepared = await prepareRevision("", {
    payload: conversation.transcript,
    source: conversation.source,
    model: "unknown",
    outcome: "unknown",
    recommendation_level: "unknown",
    summary: "",
    saved_at: conversation.savedAt
  });

  assert.equal(prepared.changed, true);
  const split = splitConversationNote(prepared.content);
  const events = parseEventLog(split.body);
  assert.equal(events[0].outcome, "unknown");
  assert.equal(events[0].payload, conversation.transcript);

  const metadata = await deriveMetadata(events);
  assert.equal(metadata.last_outcome, "unknown");
  assert.deepEqual(metadata.models, ["unknown"]);
  assert.equal(sanitizeTitle(conversation.title), "복숭아 배송 문의");
});
