export function normalizeLf(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function encodePayload(text: string): string {
  return normalizeLf(text)
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

export function decodePayload(lines: string[]): string {
  return lines
    .map((line) => {
      if (line === ">") return "";
      if (line.startsWith("> ")) return line.slice(2);
      throw new Error(`잘못된 payload 인코딩 줄: ${line}`);
    })
    .join("\n");
}

export async function computeHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeLf(text));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}
