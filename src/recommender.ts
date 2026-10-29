import { DEFAULT_MODELS } from "./domain";
import type { ModelDefinition, RecommendationLevel, ExecutionMode } from "./domain";
export type { RecommendationLevel } from "./domain";
export type { ExecutionMode } from "./domain";

export type RecommendationSource = "codex" | "claude";

export interface ModelRecommendation {
  source: RecommendationSource;
  model: string;
  label: string;
  description: string;
  reason: string;
  executionMode: ExecutionMode;
  executionModeLabel: string;
}

export interface RecommendationResult {
  level: RecommendationLevel;
  levelLabel: string;
  summary: string;
  recommendations: ModelRecommendation[];
  unavailableSources: RecommendationSource[];
}

export type ClarificationKind = "comparison-depth" | "depth";

export interface ClarificationOption {
  level: RecommendationLevel;
  label: string;
  description: string;
}

export interface TaskAnalysis {
  level: RecommendationLevel;
  needsClarification: boolean;
  kind: ClarificationKind | null;
  question: string | null;
  options: ClarificationOption[];
}

const AGENTIC_TERMS = [
  /장시간/i, /자율\s*에이전트/i, /에이전트\s*실행/i, /밤새/i, /백그라운드/i,
  /전체\s*(이전|마이그레이션)/i, /대규모\s*(이전|마이그레이션)/i,
  /long[- ]?running/i, /autonomous\s+agent/i, /migration/i
];

const ADVANCED_TERMS = [
  /복잡/i, /고난도/i, /여러\s*파일/i, /다중\s*파일/i, /아키텍처/i, /리팩터링/i,
  /디버그/i, /버그/i, /보안/i, /성능\s*최적화/i, /자동화/i, /설계/i,
  /코드/i, /코딩/i, /구현/i, /개발/i, /architecture/i, /refactor/i, /debug/i,
  /security/i, /multi[- ]?file/i, /implement/i
];

const QUICK_TERMS = [
  /요약/i, /번역/i, /교정/i, /분류/i, /짧은/i, /간단/i, /빠르게/i, /문장/i,
  /이름\s*짓/i, /키워드/i, /summari[sz]e/i, /translate/i, /proofread/i, /classif/i
];

const FILE_AGENT_TERMS = [
  /파일\s*(정리|찾|검색|여러|여러개)/i, /폴더\s*(정리|찾|검색)/i,
  /(엑셀|스프레드시트|xlsx|csv|워드|word|pdf|ppt|슬라이드|문서)\s*(정리|만들|생성|작성|추출|편집)/i,
  /여러\s*(파일|문서|폴더)/i, /스캔|업로드된|첨부된/i
];

const CODE_SIGNAL_TERMS = [
  /코드|코딩|구현|개발|디버그|버그|리팩터링|터미널|스크립트|커밋|깃|git|배포|서버/i,
  /code|debug|refactor|terminal|script|commit|deploy|server/i
];

const WRITING_TERMS = [
  /(블로그|콘텐츠|카피|광고\s*문구|상세\s*페이지|이메일|보도\s*자료|게시글|보고서|기획안).{0,15}(작성|써|쓰|초안|만들)/i,
  /(글|문서|메일|편지|대본|스토리).{0,10}(작성|써|쓰|다듬|초안)/i
];

const STRONG_ADVANCED_TERMS = [
  /자동화.{0,15}(만들|구현|구축|개발)/i,
  /(앱|웹\s*사이트|웹앱|프로그램|플러그인|시스템).{0,15}(만들|구현|구축|개발)/i,
  /(리팩터링|디버그|보안\s*(감사|검토|점검)|성능\s*최적화|아키텍처)/i,
  /(refactor|debug|security\s*(audit|review)|performance\s*optimi[sz]ation|architecture)/i
];

const LEVEL_COPY: Record<RecommendationLevel, { label: string; summary: string }> = {
  quick: { label: "빠른 작업", summary: "짧고 명확한 작업이라 속도가 빠른 모델이 적합합니다." },
  writing: { label: "글작성", summary: "글의 초안과 표현을 만드는 작업이라 작성 속도와 문장력을 각각 고려했습니다." },
  balanced: { label: "균형 작업", summary: "특별히 무겁지 않은 일반 작업이라 균형형 모델이 적합합니다." },
  advanced: { label: "고난도 작업", summary: "복잡한 코딩·설계·문제 해결 신호가 있어 고성능 모델이 적합합니다." },
  agentic: { label: "장시간 에이전트", summary: "여러 단계를 오래 수행하는 작업이라 에이전트 수행에 강한 모델이 적합합니다." }
};

const MODEL_ORDER: Record<RecommendationLevel, Record<RecommendationSource, string[]>> = {
  quick: { codex: ["luna", "terra", "sol"], claude: ["haiku-4.5", "sonnet-5", "opus-5", "fable-5"] },
  writing: { codex: ["luna", "terra", "sol"], claude: ["sonnet-5", "haiku-4.5", "opus-5", "fable-5"] },
  balanced: { codex: ["terra", "luna", "sol"], claude: ["sonnet-5", "haiku-4.5", "opus-5", "fable-5"] },
  advanced: { codex: ["sol", "terra", "luna"], claude: ["opus-5", "sonnet-5", "fable-5", "haiku-4.5"] },
  agentic: { codex: ["sol", "terra", "luna"], claude: ["fable-5", "opus-5", "sonnet-5", "haiku-4.5"] }
};

const REASONS: Record<RecommendationLevel, Record<RecommendationSource, string>> = {
  quick: { codex: "요약·번역·가벼운 작성을 빠르게 처리하기 좋습니다.", claude: "응답 속도가 중요한 가벼운 작업에 잘 맞습니다." },
  writing: { codex: "글 초안·문구·반복 작성을 빠르게 만들기 좋습니다.", claude: "문장력과 속도의 균형이 좋아 완성도 있는 글작성에 적합합니다." },
  balanced: { codex: "일반 코딩과 문서 작업에서 속도와 성능의 균형이 좋습니다.", claude: "글쓰기·분석·일반 업무를 균형 있게 처리합니다." },
  advanced: { codex: "복잡한 코드 수정·설계·디버깅에 가장 적합합니다.", claude: "고난도 코딩과 깊은 분석이 필요한 작업에 적합합니다." },
  agentic: { codex: "복잡한 다단계 실행과 고난도 판단에 적합합니다.", claude: "장시간 실행하는 에이전트와 복합 작업에 적합합니다." }
};

function countMatches(task: string, terms: RegExp[]): number {
  return terms.reduce((count, term) => count + (term.test(task) ? 1 : 0), 0);
}

function comparisonSignals(task: string): {
  hasContext: boolean;
  hasComparison: boolean;
  hasMultiplicity: boolean;
  hasJudgment: boolean;
  isSimple: boolean;
} {
  const hasFileContext = /(파일|문서|pdf|보고서|기획안|기획서|제안서|자료)/i.test(task);
  const hasComparison = /(비교|대조)/i.test(task);
  const hasMultiplicity = /(두\s*개|두개|2\s*개|여러\s*개|여러개)/i.test(task);
  const hasJudgment = /(더\s*좋|어떤\s*게|어느\s*(것|쪽|게)|우수|선정|평가|장단점|낫(은|다)|추천)/i.test(task);
  const isSimple = /(단순|차이만|변경\s*사항|달라진\s*점)/i.test(task);
  return {
    hasContext: hasFileContext,
    hasComparison,
    hasMultiplicity,
    hasJudgment,
    isSimple
  };
}

const EXECUTION_MODE_LABEL: Record<ExecutionMode, string> = {
  "chatgpt-chat": "ChatGPT 채팅",
  "chatgpt-work": "ChatGPT Work(파일 다루는 에이전트)",
  "codex-cli": "Codex CLI(터미널)",
  "claude-chat": "Claude 채팅",
  "claude-cowork": "Cowork(파일 다루는 에이전트)",
  "claude-code": "Claude Code(터미널)"
};

// 어떤 모델을 쓸지와 별개로, 코드/터미널이 필요한 작업인지 · 파일을 여러 개 다루는 작업인지 ·
// 그냥 대화로 끝나는 작업인지를 구분해서 실행 환경을 고른다.
// level(advanced/agentic)은 "얼마나 어려운가"를 보고, 이 함수는 "어디서 해야 하는가"를 본다 — 다른 축이다.
function determineExecutionMode(
  task: string,
  level: RecommendationLevel
): { codex: ExecutionMode; claude: ExecutionMode } {
  const isCode = countMatches(task, CODE_SIGNAL_TERMS) > 0 || level === "advanced" || level === "agentic";
  if (isCode) return { codex: "codex-cli", claude: "claude-code" };

  const isFileAgent = countMatches(task, FILE_AGENT_TERMS) > 0;
  if (isFileAgent) return { codex: "chatgpt-work", claude: "claude-cowork" };

  return { codex: "chatgpt-chat", claude: "claude-chat" };
}

function resolved(level: RecommendationLevel): TaskAnalysis {
  return { level, needsClarification: false, kind: null, question: null, options: [] };
}

export function analyzeTask(task: string, selectedLevel?: RecommendationLevel): TaskAnalysis {
  if (selectedLevel) return resolved(selectedLevel);

  const normalized = task.trim();
  if (countMatches(normalized, AGENTIC_TERMS) > 0) return resolved("agentic");

  const comparison = comparisonSignals(normalized);
  const isComparisonTask = comparison.hasContext && (comparison.hasComparison || comparison.hasJudgment);
  if (isComparisonTask && comparison.hasJudgment) return resolved("advanced");
  if (isComparisonTask && comparison.isSimple) return resolved("balanced");
  if (isComparisonTask) {
    return {
      level: "balanced",
      needsClarification: true,
      kind: "comparison-depth",
      question: "어느 수준으로 비교할까요?",
      options: [
        { level: "balanced", label: "단순 차이 확인", description: "변경점과 차이를 빠르게 정리합니다." },
        { level: "advanced", label: "장단점·우수안 선정", description: "기준을 세워 깊게 분석하고 더 좋은 안을 고릅니다." },
        { level: "agentic", label: "대량·장시간 처리", description: "많은 파일을 오래 반복 분석합니다." }
      ]
    };
  }

  if (countMatches(normalized, STRONG_ADVANCED_TERMS) > 0) return resolved("advanced");
  const advanced = countMatches(task, ADVANCED_TERMS);
  const quick = countMatches(task, QUICK_TERMS);
  if (advanced >= 2) return resolved("advanced");
  if (countMatches(normalized, WRITING_TERMS) > 0) return resolved("writing");
  if (quick > 0 && advanced === 0) return resolved("quick");
  return {
    level: "balanced",
    needsClarification: true,
    kind: "depth",
    question: "어떤 수준으로 진행할까요?",
    options: [
      { level: "quick", label: "빠르게", description: "가벼운 초안과 핵심만 받습니다." },
      { level: "balanced", label: "균형 있게", description: "속도와 품질을 균형 있게 가져갑니다." },
      { level: "advanced", label: "깊고 정확하게", description: "더 깊은 분석과 고품질 결과를 우선합니다." },
      { level: "agentic", label: "장시간 맡기기", description: "여러 단계를 오래 수행하는 작업입니다." }
    ]
  };
}

export function recommendModels(
  task: string,
  models: ModelDefinition[] = DEFAULT_MODELS,
  selectedLevel?: RecommendationLevel
): RecommendationResult {
  const level = selectedLevel ?? analyzeTask(task).level;
  const enabled = models.filter((model) => model.enabled);
  const recommendations: ModelRecommendation[] = [];
  const unavailableSources: RecommendationSource[] = [];
  const executionModes = determineExecutionMode(task, level);

  for (const source of ["codex", "claude"] as const) {
    const order = MODEL_ORDER[level][source];
    const model = order
      .map((id) => enabled.find((candidate) => candidate.source === source && candidate.id === id))
      .find((candidate): candidate is ModelDefinition => Boolean(candidate))
      ?? enabled.find((candidate) => candidate.source === source);
    if (!model) {
      unavailableSources.push(source);
      continue;
    }
    const executionMode = executionModes[source];
    recommendations.push({
      source,
      model: model.id,
      label: model.label,
      description: model.description,
      reason: REASONS[level][source],
      executionMode,
      executionModeLabel: EXECUTION_MODE_LABEL[executionMode]
    });
  }

  return {
    level,
    levelLabel: LEVEL_COPY[level].label,
    summary: LEVEL_COPY[level].summary,
    recommendations,
    unavailableSources
  };
}
