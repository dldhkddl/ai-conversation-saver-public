import {
  Menu,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  normalizePath
} from "obsidian";
import { normalizeLf } from "./codec";
import { parseEventLog } from "./events";
import { appLaunchUrl } from "./launcher";
import { deriveMetadata } from "./metadata";
import {
  CollisionModal,
  CorrectionModal,
  ImportModal,
  RecoveryModal,
  SaveConversationModal,
  SummaryCorrectionModal,
  TaskRecommendationModal
} from "./modals";
import type { CollisionChoice, ImportRequest, NoteCandidate, OpenAppRecommendation, SaveRequest } from "./modals";
import { parseClaudeExport } from "./importers/claude-export";
import { parseChatGptExport } from "./importers/chatgpt-export";
import type { ImportedConversation } from "./importers/types";
import type { ConversationMetadata, StoredRecommendationLevel } from "./domain";
import {
  prepareCorrection,
  prepareRevision,
  prepareSummaryCorrection,
  rebuildConversationNoteDetailed,
  isSupportedConversationFrontmatter,
  sanitizeTitle,
  splitConversationNote,
  suggestTitle,
  verifyConversationWrite
} from "./note";
import type { PreparedRevision, RevisionInput } from "./note";
import { DEFAULT_SETTINGS, SaverSettingTab, loadSettings } from "./settings";
import type { SaverSettings } from "./settings";
import { consumePendingRecommendation, createTaskExcerpt, enqueuePendingRecommendation } from "./pending";

type DynamicRequire = (id: string) => unknown;
type WindowWithRequire = Window & { require?: DynamicRequire };

class ConcurrentEditError extends Error {}
class UserInputError extends Error {}

export default class AIConversationSaverPlugin extends Plugin {
  settings: SaverSettings = {
    ...DEFAULT_SETTINGS,
    lastModel: {},
    pendingRecommendations: [],
    models: DEFAULT_SETTINGS.models.map((model) => ({ ...model }))
  };

  async onload(): Promise<void> {
    this.settings = loadSettings(await this.loadData());
    this.addSettingTab(new SaverSettingTab(this.app, this));

    this.addRibbonIcon("save", "AI 대화 저장", () => void this.openSaveModal());
    this.addRibbonIcon("sparkles", "AI 작업 모델 추천", () => this.openRecommendationModal());
    this.addRibbonIcon("book-open", "현재 대화에서 지식 노트 만들기", () => void this.createKnowledgeNote());

    this.addCommand({
      id: "recommend-ai-model",
      name: "AI 작업 모델 추천",
      callback: () => this.openRecommendationModal()
    });
    this.addCommand({
      id: "save-ai-conversation",
      name: "AI 대화 저장",
      callback: () => void this.openSaveModal()
    });
    this.addCommand({
      id: "toggle-revision-validity",
      name: "리비전 유효성 변경",
      checkCallback: (checking) => {
        const file = this.getActiveAiFile();
        if (!file) return false;
        if (!checking) void this.openCorrectionModal(file);
        return true;
      }
    });
    this.addCommand({
      id: "rebuild-ai-conversation-metadata",
      name: "AI 대화 메타데이터 재구축",
      checkCallback: (checking) => {
        const file = this.getActiveAiFile();
        if (!file) return false;
        if (!checking) void this.rebuildMetadata(file);
        return true;
      }
    });
    this.addCommand({
      id: "complete-revision-summary",
      name: "현재 노트의 한 줄 메모 보완",
      checkCallback: (checking) => {
        const file = this.getActiveSupportedAiFile();
        if (!file) return false;
        if (!checking) void this.openSummaryCorrectionModal(file);
        return true;
      }
    });
    this.addCommand({
      id: "create-knowledge-note",
      name: "현재 대화에서 지식 노트 만들기",
      checkCallback: (checking) => {
        if (!this.getActiveAiFile()) return false;
        if (!checking) void this.createKnowledgeNote();
        return true;
      }
    });
    this.addCommand({
      id: "create-model-mapping-note",
      name: "모델 매핑 노트 만들기",
      callback: () => void this.createModelMappingNote()
    });
    this.addCommand({
      id: "import-ai-conversations",
      name: "과거 대화 가져오기 (Claude / ChatGPT 내보내기)",
      callback: () => this.openImportModal()
    });

    this.registerEvent(this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
      if (!(file instanceof TFile) || !this.isAiConversation(file)) return;
      menu.addItem((item) => item
        .setTitle("현재 대화에서 지식 노트 만들기")
        .setIcon("book-open")
        .onClick(() => void this.createKnowledgeNote(file)));
      menu.addItem((item) => item
        .setTitle("리비전 유효성 변경")
        .setIcon("rotate-ccw")
        .onClick(() => void this.openCorrectionModal(file)));
      if (this.isSupportedAiConversation(file)) {
        menu.addItem((item) => item
          .setTitle("한 줄 메모 보완")
          .setIcon("message-square-plus")
          .onClick(() => void this.openSummaryCorrectionModal(file)));
      }
    }));
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private openRecommendationModal(): void {
    new TaskRecommendationModal(
      this.app,
      this.settings.models,
      (request) => this.openRecommendedApp(request)
    ).open();
  }

  private async openRecommendedApp(request: OpenAppRecommendation): Promise<void> {
    const dynamicRequire = (window as WindowWithRequire).require;
    if (!dynamicRequire) throw new Error("Windows 앱 실행 기능을 사용할 수 없습니다.");
    const electron = dynamicRequire("electron") as {
      shell?: { openExternal(url: string): Promise<void> };
    };
    if (!electron.shell) throw new Error("Windows 앱 실행 기능을 사용할 수 없습니다.");
    await electron.shell.openExternal(appLaunchUrl(request.source));
    this.settings.pendingRecommendations = enqueuePendingRecommendation(
      this.settings.pendingRecommendations,
      {
        id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        source: request.source,
        recommendedModel: request.model,
        recommendationLevel: request.level,
        taskExcerpt: createTaskExcerpt(request.task),
        recommendedAt: new Date().toISOString()
      },
      Date.now()
    );
    await this.saveSettings();
  }

  private async openSaveModal(): Promise<void> {
    try {
      const payload = await this.readClipboardText();
      if (payload.trim() === "") {
        new Notice("클립보드가 비어 있습니다.");
        return;
      }
      const candidates = this.getNoteCandidates();
      new SaveConversationModal(this.app, {
        candidates,
        suggestedTitle: suggestTitle(payload),
        models: this.settings.models,
        lastSource: this.settings.lastSource,
        lastModel: this.settings.lastModel,
        pendingRecommendations: this.settings.pendingRecommendations,
        onSave: (request) => this.saveConversation(request, payload)
      }).open();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "클립보드를 읽지 못했습니다.");
    }
  }

  private async readClipboardText(): Promise<string> {
    const dynamicRequire = (window as WindowWithRequire).require;
    if (dynamicRequire) {
      try {
        const electron = dynamicRequire("electron") as { clipboard?: { readText(): string } };
        const text = electron.clipboard?.readText();
        if (typeof text === "string") return text;
      } catch {
        // Browser clipboard fallback below.
      }
    }
    try {
      return await navigator.clipboard.readText();
    } catch {
      throw new Error("클립보드를 읽을 권한이 없습니다. 대화를 다시 복사한 뒤 시도해 주세요.");
    }
  }

  private getNoteCandidates(): NoteCandidate[] {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const current = this.app.workspace.getActiveFile();
    const all = this.app.vault.getMarkdownFiles().filter((file) => this.isAiConversation(file));
    const unique = new Map<string, NoteCandidate>();

    if (current && this.isAiConversation(current)) {
      unique.set(current.path, this.noteCandidate(current, "current"));
    }
    const candidates = all
      .map((file) => this.noteCandidate(file, "other"))
      .sort((left, right) => right.modified - left.modified);
    for (const candidate of candidates) {
      if (unique.has(candidate.path)) continue;
      candidate.group = now - candidate.modified <= day ? "recent" : "other";
      unique.set(candidate.path, candidate);
    }
    return [...unique.values()];
  }

  private noteCandidate(file: TFile, group: NoteCandidate["group"]): NoteCandidate {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const revisions = frontmatter?.revisions;
    const last = Array.isArray(revisions)
      ? [...revisions].reverse().find((value) => value && typeof value === "object" && value.voided !== true) as Record<string, unknown> | undefined
      : undefined;
    const level = last?.recommendation_level;
    const storedLevel: StoredRecommendationLevel | null = typeof level === "string"
      && ["quick", "writing", "balanced", "advanced", "agentic", "unknown"].includes(level)
      ? level as StoredRecommendationLevel
      : null;
    const lastSavedAt = typeof frontmatter?.last_saved_at === "string" ? frontmatter.last_saved_at : null;
    const activity = lastSavedAt === null ? file.stat.mtime : Date.parse(lastSavedAt);
    return {
      path: file.path,
      basename: file.basename,
      group,
      modified: Number.isFinite(activity) ? activity : file.stat.mtime,
      lastSource: typeof last?.source === "string" ? last.source : null,
      lastRecommendationLevel: storedLevel,
      lastSavedAt: typeof last?.saved_at === "string" ? last.saved_at : null
    };
  }

  private isAiConversation(file: TFile): boolean {
    return this.app.metadataCache.getFileCache(file)?.frontmatter?.type === "ai-conversation";
  }

  private getActiveAiFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    return file && this.isAiConversation(file) ? file : null;
  }

  private isSupportedAiConversation(file: TFile): boolean {
    return isSupportedConversationFrontmatter(this.app.metadataCache.getFileCache(file)?.frontmatter);
  }

  private getActiveSupportedAiFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    return file && this.isSupportedAiConversation(file) ? file : null;
  }

  private async saveConversation(request: SaveRequest, payload: string): Promise<void> {
    try {
      await this.performSave(request, payload);
    } catch (error) {
      if (error instanceof UserInputError) throw error;
      const message = error instanceof Error ? error.message : "파일 쓰기에 실패했습니다.";
      new RecoveryModal(this.app, message, {
        retry: () => this.saveConversation(request, payload),
        copy: () => this.copyText(payload),
        export: () => this.exportRecoveryFile(payload)
      }).open();
    }
  }

  private async performSave(request: SaveRequest, payload: string): Promise<void> {
    const input: RevisionInput = {
      payload,
      source: request.source,
      model: request.model,
      outcome: request.outcome,
      recommendation_level: request.recommendationLevel,
      summary: request.summary,
      saved_at: localIsoTimestamp(new Date())
    };

    let file: TFile;
    let prepared: PreparedRevision;
    if (request.targetPath) {
      const target = this.app.vault.getAbstractFileByPath(normalizePath(request.targetPath));
      if (!(target instanceof TFile) || !this.isAiConversation(target)) {
        throw new UserInputError("선택한 대상이 AI 대화 노트가 아닙니다.");
      }
      ({ file, prepared } = await this.appendToExisting(target, input));
    } else {
      const title = sanitizeTitle(request.title);
      if (!title) throw new UserInputError("파일명으로 사용할 수 있는 제목을 입력해 주세요.");
      await this.ensureFolder(this.settings.conversationFolder);
      const desiredPath = normalizePath(`${this.settings.conversationFolder}/${title}.md`);
      const existing = this.app.vault.getAbstractFileByPath(desiredPath);
      if (existing) {
        const canAppend = existing instanceof TFile && this.isAiConversation(existing);
        const choice = await this.chooseCollision(title, canAppend);
        if (choice === "cancel") throw new UserInputError("저장을 취소했습니다.");
        if (choice === "append" && existing instanceof TFile) {
          ({ file, prepared } = await this.appendToExisting(existing, input));
        } else {
          const path = this.nextAvailablePath(this.settings.conversationFolder, title);
          ({ file, prepared } = await this.createNew(path, input));
        }
      } else {
        ({ file, prepared } = await this.createNew(desiredPath, input));
      }
    }

    if (!prepared.changed) {
      new Notice(`이미 revision ${prepared.duplicateRev}에 저장된 내용입니다.`);
      this.showParseWarnings(prepared.warnings);
      return;
    }
    await this.verifyWrittenConversation(file, prepared.metadata, prepared.hash);
    this.settings.lastSource = request.source;
    this.settings.lastModel[request.source] = request.model;
    this.settings.pendingRecommendations = consumePendingRecommendation(
      this.settings.pendingRecommendations,
      request.pendingRecommendationId
    );
    await this.saveSettings();
    const megabytes = file.stat.size / (1024 * 1024);
    const sizeMessage = megabytes > this.settings.sizeWarnMB
      ? ` 파일 크기가 ${megabytes.toFixed(2)}MB로 경고 기준을 넘었습니다.`
      : "";
    const summaryMessage = request.summary === ""
      ? " 메모 없이 저장했습니다. 커맨드 팔레트에서 나중에 보완할 수 있습니다."
      : "";
    new Notice(`revision ${prepared.revision}을 저장했습니다.${summaryMessage}${sizeMessage}`);
    this.showParseWarnings(prepared.warnings);
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  private async appendToExisting(file: TFile, input: RevisionInput): Promise<{ file: TFile; prepared: PreparedRevision }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await this.app.vault.read(file);
      let prepared: PreparedRevision;
      try {
        prepared = await prepareRevision(before, input);
      } catch (error) {
        throw new UserInputError(error instanceof Error ? error.message : "대화 노트를 해석할 수 없습니다.");
      }
      if (!prepared.changed) return { file, prepared };
      try {
        await this.app.vault.process(file, (current) => {
          if (current !== before) throw new ConcurrentEditError("저장 중 노트가 변경되었습니다.");
          return prepared.content;
        });
        return { file, prepared };
      } catch (error) {
        if (error instanceof ConcurrentEditError) continue;
        try {
          await this.verifyWrittenConversation(file, prepared.metadata, prepared.hash);
          return { file, prepared };
        } catch {
          // The expected revision is not fully present; preserve the original write error.
        }
        throw error;
      }
    }
    throw new Error("노트가 계속 변경되어 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  private async createNew(path: string, input: RevisionInput): Promise<{ file: TFile; prepared: PreparedRevision }> {
    let prepared: PreparedRevision;
    try {
      prepared = await prepareRevision("", input);
    } catch (error) {
      throw new UserInputError(error instanceof Error ? error.message : "새 대화 노트를 준비할 수 없습니다.");
    }
    if (!prepared.changed) throw new Error("새 노트 준비 중 예상하지 못한 중복이 발생했습니다.");
    try {
      const file = await this.app.vault.create(path, prepared.content);
      return { file, prepared };
    } catch (error) {
      const possibleFile = this.app.vault.getAbstractFileByPath(path);
      if (possibleFile instanceof TFile) {
        try {
          await this.verifyWrittenConversation(possibleFile, prepared.metadata, prepared.hash);
          return { file: possibleFile, prepared };
        } catch {
          // Creation did not leave a fully verified note; preserve the original error.
        }
      }
      throw error;
    }
  }

  private async verifyWrittenConversation(file: TFile, metadata: ConversationMetadata, hash?: string): Promise<void> {
    const current = await this.app.vault.read(file);
    await verifyConversationWrite(current, metadata, hash);
  }

  private chooseCollision(title: string, canAppend: boolean): Promise<CollisionChoice> {
    return new Promise((resolve) => new CollisionModal(this.app, title, canAppend, resolve).open());
  }

  private nextAvailablePath(folder: string, title: string): string {
    let suffix = 2;
    while (true) {
      const path = normalizePath(`${folder}/${sanitizeTitle(title, ` (${suffix})`)}.md`);
      if (!this.app.vault.getAbstractFileByPath(path)) return path;
      suffix += 1;
    }
  }

  private async openCorrectionModal(file: TFile): Promise<void> {
    try {
      const text = await this.app.vault.read(file);
      const metadata = await deriveMetadata(parseEventLog(splitConversationNote(text).body));
      new CorrectionModal(this.app, metadata.revisions, async (choice) => {
        await this.appendCorrection(file, choice.targetRev, choice.action, choice.reason);
      }).open();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "리비전을 읽지 못했습니다.");
    }
  }

  private async appendCorrection(file: TFile, targetRev: number, action: "void" | "restore", reason: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await this.app.vault.read(file);
      const prepared = await prepareCorrection(before, {
        action,
        target_rev: targetRev,
        corrected_at: localIsoTimestamp(new Date()),
        ...(reason.trim() === "" ? {} : { reason: reason.trim() })
      });
      try {
        await this.app.vault.process(file, (current) => {
          if (current !== before) throw new ConcurrentEditError();
          return prepared.content;
        });
        await this.verifyWrittenConversation(file, prepared.metadata);
        new Notice(`revision ${targetRev}에 ${action === "void" ? "무효" : "복원"} 이벤트를 추가했습니다.`);
        this.showParseWarnings(prepared.warnings);
        return;
      } catch (error) {
        if (error instanceof ConcurrentEditError) continue;
        try {
          await this.verifyWrittenConversation(file, prepared.metadata);
          new Notice(`revision ${targetRev}에 ${action === "void" ? "무효" : "복원"} 이벤트를 추가했습니다.`);
          this.showParseWarnings(prepared.warnings);
          return;
        } catch {
          // The expected correction is not fully present; preserve the original error.
        }
        throw error;
      }
    }
    throw new Error("노트가 계속 변경되어 정정 이벤트를 추가하지 못했습니다.");
  }

  private async openSummaryCorrectionModal(file: TFile): Promise<void> {
    try {
      const text = await this.app.vault.read(file);
      const metadata = await deriveMetadata(parseEventLog(splitConversationNote(text).body));
      new SummaryCorrectionModal(this.app, metadata.revisions, async (choice) => {
        await this.appendSummaryCorrection(file, choice.targetRev, choice.summary);
      }).open();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "리비전 메모를 읽지 못했습니다.");
    }
  }

  private async appendSummaryCorrection(file: TFile, targetRev: number, summary: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await this.app.vault.read(file);
      const prepared = await prepareSummaryCorrection(before, {
        target_rev: targetRev,
        corrected_at: localIsoTimestamp(new Date()),
        summary
      });
      try {
        await this.app.vault.process(file, (current) => {
          if (current !== before) throw new ConcurrentEditError();
          return prepared.content;
        });
        await this.verifyWrittenConversation(file, prepared.metadata);
        new Notice(`revision ${targetRev}의 한 줄 메모를 보완했습니다.`);
        this.showParseWarnings(prepared.warnings);
        return;
      } catch (error) {
        if (error instanceof ConcurrentEditError) continue;
        try {
          await this.verifyWrittenConversation(file, prepared.metadata);
          new Notice(`revision ${targetRev}의 한 줄 메모를 보완했습니다.`);
          this.showParseWarnings(prepared.warnings);
          return;
        } catch {
          // The expected summary correction is not fully present; preserve the original error.
        }
        throw error;
      }
    }
    throw new Error("노트가 계속 변경되어 한 줄 메모를 보완하지 못했습니다.");
  }

  private async rebuildMetadata(file: TFile): Promise<void> {
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const before = await this.app.vault.read(file);
        const rebuiltResult = await rebuildConversationNoteDetailed(before);
        const rebuilt = rebuiltResult.content;
        try {
          await this.app.vault.process(file, (current) => {
            if (current !== before) throw new ConcurrentEditError();
            return rebuilt;
          });
          if (await this.app.vault.read(file) !== rebuilt) {
            throw new Error("재구축 후 파일 검증에 실패했습니다.");
          }
          new Notice("본문 이벤트에서 메타데이터를 재구축했습니다.");
          this.showParseWarnings(rebuiltResult.warnings);
          return;
        } catch (error) {
          if (error instanceof ConcurrentEditError) continue;
          if (await this.app.vault.read(file) === rebuilt) {
            new Notice("본문 이벤트에서 메타데이터를 재구축했습니다.");
            this.showParseWarnings(rebuiltResult.warnings);
            return;
          }
          throw error;
        }
      }
      throw new Error("노트가 계속 변경되어 재구축하지 못했습니다.");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "메타데이터 재구축에 실패했습니다.");
    }
  }

  private showParseWarnings(warnings: string[]): void {
    if (warnings.length > 0) new Notice([...new Set(warnings)].join("\n"));
  }

  private async createKnowledgeNote(sourceFile?: TFile): Promise<void> {
    const file = sourceFile ?? this.getActiveAiFile();
    if (!file) {
      new Notice("AI 대화 노트를 먼저 열어 주세요.");
      return;
    }
    try {
      await this.ensureFolder(this.settings.knowledgeFolder);
      const path = this.nextAvailableKnowledgePath(file.basename);
      const content = [
        `# ${file.basename}`,
        "",
        `원문: [[${file.path}|${file.basename}]]`,
        "",
        "## 핵심 요약",
        "",
        "## 결정",
        "",
        "## 할 일",
        "",
        "## 다음 행동",
        ""
      ].join("\n");
      const created = await this.app.vault.create(path, content);
      await this.app.workspace.getLeaf(false).openFile(created);
      new Notice("지식 노트를 만들었습니다.");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "지식 노트를 만들지 못했습니다.");
    }
  }

  private nextAvailableKnowledgePath(title: string): string {
    const first = normalizePath(`${this.settings.knowledgeFolder}/${title}.md`);
    if (!this.app.vault.getAbstractFileByPath(first)) return first;
    let suffix = 2;
    while (true) {
      const path = normalizePath(`${this.settings.knowledgeFolder}/${title} ${suffix}.md`);
      if (!this.app.vault.getAbstractFileByPath(path)) return path;
      suffix += 1;
    }
  }

  private async createModelMappingNote(): Promise<void> {
    const folder = "99-설정";
    const path = normalizePath(`${folder}/모델-매핑.md`);
    await this.ensureFolder(folder);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(existing);
      new Notice("기존 모델 매핑 노트를 열었습니다. 덮어쓰지 않았습니다.");
      return;
    }
    const rows = this.settings.models.map((model) =>
      `| ${model.source} | ${model.id} | ${model.label} | ${model.description} | 2026-08-07 |  | 공개되지 않음 |`
    );
    const content = [
      "# AI 모델 매핑 이력",
      "",
      "공식적으로 확인된 화면 표시 정보만 기록합니다. 내부 기반 모델은 추측하지 않으며 기존 기간을 덮어쓰지 않습니다.",
      "",
      "| 공급자 | 저장 ID | 화면 표시 이름 | 당시 공식 설명 | 적용 시작일 | 적용 종료일 | 내부 기반 모델 |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...rows,
      ""
    ].join("\n");
    const created = await this.app.vault.create(path, content);
    await this.app.workspace.getLeaf(false).openFile(created);
  }

  private openImportModal(): void {
    new ImportModal(this.app, (request) => void this.runImport(request)).open();
  }

  private async runImport(request: ImportRequest): Promise<void> {
    const path = normalizePath(request.vaultPath);
    if (!(await this.app.vault.adapter.exists(path))) {
      new Notice(`볼트 안에서 "${path}" 파일을 찾을 수 없습니다. 내보내기 파일을 볼트로 옮긴 뒤 다시 시도해 주세요.`);
      return;
    }
    let raw: unknown;
    try {
      const text = await this.app.vault.adapter.read(path);
      raw = JSON.parse(text);
    } catch (error) {
      new Notice(`파일을 읽거나 해석하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const result = request.provider === "claude" ? parseClaudeExport(raw) : parseChatGptExport(raw);
    if (result.conversations.length === 0) {
      new Notice(`가져올 대화가 없습니다. ${result.errors.length}개 항목에서 오류가 발생했습니다.`);
      return;
    }

    new Notice(`${result.conversations.length}개 대화를 가져오는 중입니다...`);
    await this.ensureFolder(this.settings.conversationFolder);

    const reportLines: string[] = [
      "# 과거 대화 가져오기 보고서",
      "",
      `공급자: ${request.provider === "claude" ? "Claude" : "ChatGPT (Codex)"}`,
      `원본 파일: ${path}`,
      `가져온 시각: ${localIsoTimestamp(new Date())}`,
      ""
    ];
    let created = 0;
    let failed = 0;

    for (const conversation of result.conversations) {
      try {
        const notePath = await this.createImportedNote(conversation);
        created += 1;
        reportLines.push(`- [x] [[${notePath}|${conversation.title}]]`);
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : "알 수 없는 오류";
        reportLines.push(`- [ ] **실패** · ${conversation.title} · ${message}`);
      }
    }
    for (const message of result.errors) {
      failed += 1;
      reportLines.push(`- [ ] **파싱 실패** · ${message}`);
    }

    const reportPath = normalizePath(
      `${this.settings.conversationFolder}/가져오기 보고서 ${localIsoTimestamp(new Date()).replace(/[:.]/g, "-")}.md`
    );
    await this.app.vault.create(reportPath, reportLines.join("\n"));

    const summary = failed === 0
      ? `${created}개 대화를 모두 가져왔습니다.`
      : `${created}개 가져오고 ${failed}개는 실패했습니다. 가져오기 보고서를 확인해 주세요.`;
    new Notice(summary);
    const reportFile = this.app.vault.getAbstractFileByPath(reportPath);
    if (reportFile instanceof TFile) await this.app.workspace.getLeaf(false).openFile(reportFile);
  }

  private async createImportedNote(conversation: ImportedConversation): Promise<string> {
    const title = sanitizeTitle(conversation.title);
    if (!title) throw new Error("제목을 파일명으로 쓸 수 없습니다.");
    const desiredPath = normalizePath(`${this.settings.conversationFolder}/${title}.md`);
    const path = this.app.vault.getAbstractFileByPath(desiredPath)
      ? this.nextAvailablePath(this.settings.conversationFolder, title)
      : desiredPath;
    const input: RevisionInput = {
      payload: conversation.transcript,
      source: conversation.source,
      model: "unknown",
      outcome: "unknown",
      recommendation_level: "unknown",
      summary: "",
      saved_at: conversation.savedAt
    };
    const { file } = await this.createNew(path, input);
    return file.path;
  }

  private async ensureFolder(folder: string): Promise<void> {
    const normalized = normalizePath(folder).replace(/^\/+|\/+$/g, "");
    if (!normalized) throw new Error("저장 폴더 경로가 비어 있습니다.");
    let current = "";
    for (const part of normalized.split("/")) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (!existing) await this.app.vault.createFolder(current);
      else if (existing instanceof TFile) throw new Error(`${current} 경로에 같은 이름의 파일이 있습니다.`);
    }
  }

  private async copyText(text: string): Promise<void> {
    const dynamicRequire = (window as WindowWithRequire).require;
    if (dynamicRequire) {
      try {
        const electron = dynamicRequire("electron") as { clipboard?: { writeText(value: string): void } };
        if (electron.clipboard) {
          electron.clipboard.writeText(text);
          new Notice("원문을 클립보드에 복사했습니다.");
          return;
        }
      } catch {
        // Browser clipboard fallback below.
      }
    }
    await navigator.clipboard.writeText(text);
    new Notice("원문을 클립보드에 복사했습니다.");
  }

  private async exportRecoveryFile(text: string): Promise<void> {
    const dynamicRequire = (window as WindowWithRequire).require;
    if (!dynamicRequire) throw new Error("이 환경에서는 파일 선택 창을 열 수 없습니다.");
    const remote = dynamicRequire("@electron/remote") as {
      dialog?: { showSaveDialog(options: object): Promise<{ canceled: boolean; filePath?: string }> }
    };
    const fs = dynamicRequire("node:fs/promises") as { writeFile(path: string, data: string, encoding: string): Promise<void> };
    if (!remote.dialog) throw new Error("파일 선택 창을 열 수 없습니다. 원문 복사를 사용해 주세요.");
    const result = await remote.dialog.showSaveDialog({
      title: "AI 대화 원문 복구 파일 저장",
      defaultPath: `ai-conversation-recovery-${Date.now()}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }]
    });
    if (result.canceled || !result.filePath) return;
    await fs.writeFile(result.filePath, normalizeLf(text), "utf8");
    new Notice("사용자가 선택한 위치에 복구 파일을 저장했습니다.");
  }
}

function localIsoTimestamp(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  return `${local}${offset}`;
}
