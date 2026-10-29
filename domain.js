"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MODELS = exports.SCHEMA_VERSION = void 0;
exports.SCHEMA_VERSION = 1;
exports.DEFAULT_MODELS = [
    { source: "codex", id: "luna", label: "Luna", description: "빠른 작성·요약·분류·반복 작업", enabled: true, builtin: true },
    { source: "codex", id: "terra", label: "Terra", description: "속도와 성능이 균형 잡힌 일반 작업", enabled: true, builtin: true },
    { source: "codex", id: "sol", label: "Sol", description: "복잡한 설계·코딩·고난도 추론", enabled: true, builtin: true },
    { source: "claude", id: "fable-5", label: "Fable 5", description: "장시간 실행 에이전트와 복합 작업", enabled: true, builtin: true },
    { source: "claude", id: "opus-5", label: "Opus 5", description: "복잡한 에이전트 코딩과 고난도 업무", enabled: true, builtin: true },
    { source: "claude", id: "sonnet-5", label: "Sonnet 5", description: "속도와 지능이 균형 잡힌 일반 작업", enabled: true, builtin: true },
    { source: "claude", id: "haiku-4.5", label: "Haiku 4.5", description: "가장 빠른 응답과 가벼운 작업", enabled: true, builtin: true }
];
