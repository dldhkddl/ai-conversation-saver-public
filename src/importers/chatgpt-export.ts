import type { ImportParseResult, ImportedConversation } from "./types";

// ChatGPT/Codex 내보내기는 트리 구조(mapping)라서 대화가 갈라질 수 있다.
// current_node가 있으면 그 지점까지의 부모 체인만 따라가 "실제로 남은 마지막 대화 흐름"을
// 복원한다. 없으면 가장 최근에 생성된 잎(leaf) 노드에서 같은 방식으로 거슬러 올라간다.
// 공식 문서로 확정된 형식이 아니므로 방어적으로 파싱하고, 대화 하나가 예상과 다른 형태여도
// 전체를 중단하지 않고 개별 오류로 보고한다.

interface RawMessageAuthor {
  role?: unknown;
}

interface RawMessageContent {
  parts?: unknown;
}

interface RawMessage {
  author?: unknown;
  content?: unknown;
  create_time?: unknown;
}

interface RawMappingNode {
  message?: unknown;
  parent?: unknown;
  children?: unknown;
}

interface RawConversation {
  title?: unknown;
  create_time?: unknown;
  update_time?: unknown;
  mapping?: unknown;
  current_node?: unknown;
}

const ROLE_LABEL: Record<string, string> = {
  user: "사용자",
  assistant: "AI"
};
const SKIP_ROLES = new Set(["system", "tool"]);

export function parseChatGptExport(raw: unknown): ImportParseResult {
  const conversations: ImportedConversation[] = [];
  const errors: string[] = [];

  const list = Array.isArray(raw) ? raw : null;
  if (!list) {
    errors.push("최상위가 배열이 아닙니다. ChatGPT 공식 내보내기의 conversations.json 형식이 아닐 수 있습니다.");
    return { conversations, errors };
  }

  list.forEach((entry, index) => {
    const label = `대화 ${index + 1}`;
    try {
      const conv = entry as RawConversation;
      if (!conv.mapping || typeof conv.mapping !== "object") throw new Error("mapping 트리가 없습니다.");
      const mapping = conv.mapping as Record<string, RawMappingNode>;

      const chain = resolveActiveChain(mapping, conv.current_node);
      const lines: string[] = [];
      let firstUserText = "";
      let lastCreateTime: number | null = null;

      for (const node of chain) {
        const message = node.message as RawMessage | null | undefined;
        if (!message) continue;
        const author = message.author as RawMessageAuthor | undefined;
        const role = typeof author?.role === "string" ? author.role : "";
        if (SKIP_ROLES.has(role)) continue;
        const text = extractParts(message.content);
        if (text === "") continue;
        if (role === "user" && firstUserText === "") firstUserText = text;
        if (typeof message.create_time === "number") lastCreateTime = message.create_time;
        const roleLabel = ROLE_LABEL[role] ?? (role || "알 수 없음");
        lines.push(`${roleLabel}: ${text}`);
      }
      if (lines.length === 0) throw new Error("추출된 메시지가 없습니다.");

      const rawTitle = typeof conv.title === "string" ? conv.title.trim() : "";
      const title = rawTitle !== "" && rawTitle.toLowerCase() !== "new chat"
        ? rawTitle
        : Array.from(firstUserText).slice(0, 40).join("") || `가져온 대화 ${index + 1}`;

      const seconds = lastCreateTime ?? asNumber(conv.update_time) ?? asNumber(conv.create_time);
      if (seconds === null) throw new Error("저장 시각을 해석할 수 없습니다.");
      const savedAt = new Date(seconds * 1000).toISOString();

      conversations.push({ source: "codex", title, savedAt, transcript: lines.join("\n\n") });
    } catch (error) {
      errors.push(`${label}: ${error instanceof Error ? error.message : "알 수 없는 오류로 건너뜀"}`);
    }
  });

  return { conversations, errors };
}

function resolveActiveChain(mapping: Record<string, RawMappingNode>, currentNode: unknown): RawMappingNode[] {
  const ids = Object.keys(mapping);
  let leafId: string | null = typeof currentNode === "string" && mapping[currentNode] ? currentNode : null;

  if (leafId === null) {
    // 잎(leaf) = 자기 children이 비어 있는 노드. "누구의 자식으로도 지목되지 않은 노드"는
    // 잎이 아니라 뿌리(root)이므로 그 반대 조건과 혼동하지 않는다.
    const leaves = ids.filter((id) => {
      const children = mapping[id]?.children;
      return !Array.isArray(children) || children.length === 0;
    });
    let bestTime = -Infinity;
    for (const id of leaves) {
      const message = mapping[id]?.message as RawMessage | null | undefined;
      const time = typeof message?.create_time === "number" ? message.create_time : -Infinity;
      if (time > bestTime) {
        bestTime = time;
        leafId = id;
      }
    }
  }
  if (leafId === null) return [];

  const chain: RawMappingNode[] = [];
  const seen = new Set<string>();
  let cursor: string | null = leafId;
  while (cursor !== null && mapping[cursor] !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    const node: RawMappingNode | undefined = mapping[cursor];
    if (node) chain.push(node);
    const parent: unknown = node?.parent;
    cursor = typeof parent === "string" ? parent : null;
  }
  return chain.reverse();
}

function extractParts(content: unknown): string {
  const c = content as RawMessageContent | undefined;
  if (!c || !Array.isArray(c.parts)) return "";
  return c.parts
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join("\n\n")
    .trim();
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
