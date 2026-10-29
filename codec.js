"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLf = normalizeLf;
exports.encodePayload = encodePayload;
exports.decodePayload = decodePayload;
exports.computeHash = computeHash;
function normalizeLf(text) {
    return text.replace(/\r\n?/g, "\n");
}
function encodePayload(text) {
    return normalizeLf(text)
        .split("\n")
        .map((line) => (line === "" ? ">" : `> ${line}`))
        .join("\n");
}
function decodePayload(lines) {
    return lines
        .map((line) => {
        if (line === ">")
            return "";
        if (line.startsWith("> "))
            return line.slice(2);
        throw new Error(`잘못된 payload 인코딩 줄: ${line}`);
    })
        .join("\n");
}
async function computeHash(text) {
    const bytes = new TextEncoder().encode(normalizeLf(text));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `sha256:${hex}`;
}
