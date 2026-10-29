import type { ImportParseResult, ImportedConversation } from "./types";

// 공식 문서로 확정된 필드가 아니라 커뮤니티 조사 기준의 최선 추정치다.
// 실제 내보내기 파일로 검증하기 전까지는 방어적으로 파싱하고,
// 대화 하나가 예상과 다른 형태여도 전체를 중단하지 않고 개별 오류로 보고한다.

interface RawClaudeContentBlock {
  text?: unknown;
}

interface RawClaudeMessage {
  sender?: unknown;
  text?: unknown;
  content?: unknown;
}

interface RawClaudeConversation {
  name?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  chat_messages?: unknown;
}

const ROLE_LABEL: Record<string, string> = {
  human: "사용자",
  assistant: "AI"
};

export function parseClaudeExport(raw: unknown): ImportParseResult {
  const conversations: ImportedConversation[] = [];
  const errors: string[] = [];

  const list = Array.isArray(raw) ? raw : null;
  if (!list) {
    errors.push("최상위가 배열이 아닙니다. Claude 공식 내보내기의 conversations.json 형식이 아닐 수 있습니다.");
    return { conversations, errors };
  }

  list.forEach((entry, index) => {
    const label = `대화 ${index + 1}`;
    try {
      const conv = entry as RawClaudeConversation;
      const messages = Array.isArray(conv.chat_messages) ? conv.chat_messages : null;
      if (!messages) throw new Error("chat_messages 배열이 없습니다.");

      const lines: string[] = [];
      let firstHumanText = "";
      for (const rawMessage of messages) {
        const message = rawMessage as RawClaudeMessage;
        const role = typeof message.sender === "string" ? message.sender : "";
        const text = extractText(message);
        if (text === "") continue;
        if (role === "human" && firstHumanText === "") firstHumanText = text;
        const roleLabel = ROLE_LABEL[role] ?? (role || "알 수 없음");
        lines.push(`${roleLabel}: ${text}`);
      }
      if (lines.length === 0) throw new Error("추출된 메시지가 없습니다.");

      const rawTitle = typeof conv.name === "string" ? conv.name.trim() : "";
      const title = rawTitle !== "" && rawTitle.toLowerCase() !== "untitled"
        ? rawTitle
        : Array.from(firstHumanText).slice(0, 40).join("") || `가져온 대화 ${index + 1}`;

      const savedAt = normalizeTimestamp(conv.created_at) ?? normalizeTimestamp(conv.updated_at);
      if (!savedAt) throw new Error("저장 시각을 해석할 수 없습니다.");

      conversations.push({ source: "claude", title, savedAt, transcript: lines.join("\n\n") });
    } catch (error) {
      errors.push(`${label}: ${error instanceof Error ? error.message : "알 수 없는 오류로 건너뜀"}`);
    }
  });

  return { conversations, errors };
}

function extractText(message: RawClaudeMessage): string {
  if (typeof message.text === "string" && message.text.trim() !== "") return message.text.trim();
  if (Array.isArray(message.content)) {
    const parts = message.content
      .map((block) => {
        const b = block as RawClaudeContentBlock;
        return typeof b.text === "string" ? b.text : "";
      })
      .filter((part) => part !== "");
    if (parts.length > 0) return parts.join("\n\n").trim();
  }
  return "";
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const truncated = value.replace(/(\.\d{3})\d+/, "$1");
  const date = new Date(truncated);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
