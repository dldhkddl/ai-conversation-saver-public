import { App, Modal, Setting } from "obsidian";
import type { ModelDefinition, Outcome, RevisionMeta, StoredRecommendationLevel } from "./domain";
import { recommendationChoices } from "./pending";
import type { PendingRecommendation, PendingSource } from "./pending";
import { analyzeTask, recommendModels } from "./recommender";
import type { RecommendationLevel, RecommendationSource, TaskAnalysis } from "./recommender";
import { normalizeSummary, saveButtonLabel } from "./summary";

export interface NoteCandidate {
  path: string;
  basename: string;
  group: "current" | "recent" | "other";
  modified: number;
  lastSource: string | null;
  lastRecommendationLevel: StoredRecommendationLevel | null;
  lastSavedAt: string | null;
}

export interface SaveRequest {
  targetPath: string | null;
  title: string;
  source: string;
  model: string;
  outcome: Outcome;
  recommendationLevel: StoredRecommendationLevel;
  summary: string;
  pendingRecommendationId: string | null;
}

export interface SaveModalOptions {
  candidates: NoteCandidate[];
  suggestedTitle: string;
  models: ModelDefinition[];
  lastSource: string | null;
  lastModel: Record<string, string>;
  pendingRecommendations: PendingRecommendation[];
  onSave(request: SaveRequest): Promise<void>;
}

export interface OpenAppRecommendation {
  source: RecommendationSource;
  model: string;
  level: RecommendationLevel;
  task: string;
}

const sourceLabel = (source: string): string => source === "codex" ? "Codex" : source === "claude" ? "Claude" : source;

export class SaveConversationModal extends Modal {
  private targetSelect!: HTMLSelectElement;
  private titleInput!: HTMLInputElement;
  private titleSetting!: Setting;
  private sourceSelect!: HTMLSelectElement;
  private modelSelect!: HTMLSelectElement;
  private modelDescription!: HTMLElement;
  private recommendationSelect!: HTMLSelectElement;
  private summaryInput!: HTMLInputElement;
  private errorEl!: HTMLElement;
  private outcomeButtons: Array<{ button: HTMLButtonElement; outcome: Outcome }> = [];
  private busy = false;

  constructor(app: App, private readonly options: SaveModalOptions) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ai-saver-modal");
    this.titleEl.setText("AI 대화 저장");
    this.contentEl.createEl("p", {
      text: "클립보드 원문은 교체하지 않고 새 리비전으로 추가합니다.",
      cls: "ai-saver-lead"
    });

    new Setting(this.contentEl)
      .setName("대화 노트 찾기")
      .setDesc("현재 노트와 최근 24시간 노트가 먼저 표시됩니다.")
      .addSearch((search) => search
        .setPlaceholder("제목 검색")
        .onChange((query) => this.renderCandidates(query)));

    new Setting(this.contentEl)
      .setName("저장 대상")
      .addDropdown((dropdown) => {
        this.targetSelect = dropdown.selectEl;
        dropdown.onChange(() => this.updateTargetMode());
      });

    this.titleSetting = new Setting(this.contentEl)
      .setName("새 노트 제목")
      .setDesc("날짜 접두사는 붙지 않으며 저장 전에 직접 확인할 수 있습니다.")
      .addText((text) => {
        this.titleInput = text.inputEl;
        text.setValue(this.options.suggestedTitle).setPlaceholder("대화 제목");
      });

    new Setting(this.contentEl)
      .setName("공급자")
      .addDropdown((dropdown) => {
        this.sourceSelect = dropdown.selectEl;
        dropdown.addOption("", "선택하세요");
        for (const source of [...new Set(this.options.models.filter((model) => model.enabled).map((model) => model.source))]) {
          dropdown.addOption(source, sourceLabel(source));
        }
        dropdown.setValue(this.options.lastSource ?? "");
        dropdown.onChange(() => {
          this.renderModels();
          this.renderRecommendationOptions();
        });
      });

    const modelSetting = new Setting(this.contentEl)
      .setName("사용 모델")
      .addDropdown((dropdown) => {
        this.modelSelect = dropdown.selectEl;
        dropdown.onChange(() => this.updateModelDescription());
      });
    this.modelDescription = modelSetting.descEl;

    new Setting(this.contentEl)
      .setName("추천 단계")
      .setDesc("추천 출처를 확인하고 실제 작업에 맞게 바꿀 수 있습니다.")
      .addDropdown((dropdown) => {
        this.recommendationSelect = dropdown.selectEl;
        dropdown.onChange(() => this.applyRecommendationModel());
      });

    new Setting(this.contentEl)
      .setName("한 줄 메모")
      .setDesc("이번 대화에서 얻은 결론이나 다음 행동을 200자 안으로 적습니다.")
      .addText((text) => {
        this.summaryInput = text.inputEl;
        text.setPlaceholder("예: 배송비 표시 시점을 결제 단계로 옮기기로 함")
          .onChange(() => this.updateOutcomeLabels());
      });

    this.errorEl = this.contentEl.createDiv({ cls: "ai-saver-error" });
    this.errorEl.setAttr("aria-live", "assertive");

    const actions = this.contentEl.createDiv({ cls: "ai-saver-outcomes" });
    const outcomes: Array<[Outcome, string, string]> = [
      ["good", "좋음으로 저장", "Alt+1"],
      ["mixed", "보통으로 저장", "Alt+2"],
      ["bad", "나쁨으로 저장", "Alt+3"]
    ];
    for (const [outcome, label, shortcut] of outcomes) {
      const button = actions.createEl("button", { text: label, cls: `ai-saver-outcome ai-saver-${outcome}` });
      button.setAttr("type", "button");
      button.setAttr("aria-keyshortcuts", shortcut);
      button.addEventListener("click", () => void this.submit(outcome));
      this.outcomeButtons.push({ button, outcome });
    }

    this.contentEl.addEventListener("keydown", (event: KeyboardEvent) => {
      if (!event.altKey || this.busy) return;
      const outcome = event.key === "1" ? "good" : event.key === "2" ? "mixed" : event.key === "3" ? "bad" : null;
      if (outcome) {
        event.preventDefault();
        void this.submit(outcome);
      }
    });

    this.renderCandidates("");
    this.renderModels();
    this.updateTargetMode();
    this.updateOutcomeLabels();
    window.setTimeout(() => this.summaryInput.focus(), 0);
  }

  private renderCandidates(query: string): void {
    const previous = this.targetSelect.value;
    this.targetSelect.empty();
    const normalized = query.trim().toLocaleLowerCase();
    const filtered = this.options.candidates.filter((candidate) => candidate.basename.toLocaleLowerCase().includes(normalized));
    for (const candidate of filtered) {
      const prefix = candidate.group === "current" ? "현재 · " : candidate.group === "recent" ? "최근 · " : "";
      this.targetSelect.add(new Option(`${prefix}${candidate.basename}`, candidate.path));
    }
    this.targetSelect.add(new Option("＋ 새 노트 만들기", "__new__"));
    const canRestore = Array.from(this.targetSelect.options).some((option) => option.value === previous);
    this.targetSelect.value = canRestore ? previous : filtered[0]?.path ?? "__new__";
    this.updateTargetMode();
  }

  private updateTargetMode(): void {
    if (!this.titleSetting) return;
    const isNew = this.targetSelect.value === "__new__";
    this.titleSetting.settingEl.toggleClass("ai-saver-hidden", !isNew);
    this.renderRecommendationOptions();
  }

  private renderModels(): void {
    if (!this.modelSelect || !this.sourceSelect) return;
    const source = this.sourceSelect.value;
    this.modelSelect.empty();
    this.modelSelect.add(new Option("선택하세요", ""));
    for (const model of this.options.models.filter((item) => item.enabled && item.source === source)) {
      this.modelSelect.add(new Option(model.label, model.id));
    }
    const previous = this.options.lastModel[source] ?? "";
    if (Array.from(this.modelSelect.options).some((option) => option.value === previous)) this.modelSelect.value = previous;
    this.updateModelDescription();
  }

  private updateModelDescription(): void {
    if (!this.modelDescription || !this.modelSelect || !this.sourceSelect) return;
    const model = this.options.models.find((item) => item.source === this.sourceSelect.value && item.id === this.modelSelect.value);
    this.modelDescription.setText(model?.description ?? "방금 사용한 모델을 확인해 주세요.");
  }

  private renderRecommendationOptions(): void {
    if (!this.recommendationSelect || !this.sourceSelect || !this.targetSelect) return;
    const source = this.sourceSelect.value;
    this.recommendationSelect.empty();
    this.recommendationSelect.add(new Option("unknown · 추천 기록 사용 안 함", "unknown"));
    if (source !== "codex" && source !== "claude") {
      this.recommendationSelect.value = "unknown";
      return;
    }

    const target = this.options.candidates.find((candidate) => candidate.path === this.targetSelect.value);
    const previous = target?.lastSource === source && target.lastRecommendationLevel && target.lastSavedAt
      ? { recommendationLevel: target.lastRecommendationLevel, savedAt: target.lastSavedAt }
      : null;
    const choices = recommendationChoices(this.options.pendingRecommendations, source as PendingSource, Date.now(), previous);
    for (const item of choices.fresh) {
      this.recommendationSelect.add(new Option(
        `${item.recommendationLevel} · ${item.recommendedModel} · ${this.ageLabel(item.recommendedAt)} · ${item.taskExcerpt}`,
        `pending:${item.id}`
      ));
    }
    for (const item of choices.stale) {
      this.recommendationSelect.add(new Option(
        `${item.recommendationLevel} · 지난 추천 · ${this.ageLabel(item.recommendedAt)} · ${item.taskExcerpt}`,
        `pending:${item.id}`
      ));
    }
    if (previous) {
      this.recommendationSelect.add(new Option(
        `${previous.recommendationLevel} · 직전 리비전에서 가져옴 · ${previous.savedAt.slice(0, 10)} 저장`,
        "previous"
      ));
    }
    this.recommendationSelect.value = choices.defaultPendingId ? `pending:${choices.defaultPendingId}` : "unknown";
    this.applyRecommendationModel();
  }

  private applyRecommendationModel(): void {
    const value = this.recommendationSelect?.value ?? "unknown";
    if (!value.startsWith("pending:")) return;
    const item = this.options.pendingRecommendations.find((candidate) => candidate.id === value.slice(8));
    if (!item || item.source !== this.sourceSelect.value) return;
    if (Array.from(this.modelSelect.options).some((option) => option.value === item.recommendedModel)) {
      this.modelSelect.value = item.recommendedModel;
      this.updateModelDescription();
    }
  }

  private selectedRecommendation(): { level: StoredRecommendationLevel; pendingId: string | null } {
    const value = this.recommendationSelect.value;
    if (value.startsWith("pending:")) {
      const pendingId = value.slice(8);
      const item = this.options.pendingRecommendations.find((candidate) => candidate.id === pendingId);
      if (item) return { level: item.recommendationLevel, pendingId };
    }
    if (value === "previous") {
      const target = this.options.candidates.find((candidate) => candidate.path === this.targetSelect.value);
      return { level: target?.lastRecommendationLevel ?? "unknown", pendingId: null };
    }
    return { level: "unknown", pendingId: null };
  }

  private ageLabel(iso: string): string {
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
    if (minutes < 60) return `${minutes}분 전`;
    return `${Math.floor(minutes / 60)}시간 전`;
  }

  private updateOutcomeLabels(): void {
    const summary = this.summaryInput?.value ?? "";
    for (const entry of this.outcomeButtons) entry.button.setText(saveButtonLabel(entry.outcome, summary));
  }

  private async submit(outcome: Outcome): Promise<void> {
    if (this.busy) return;
    const source = this.sourceSelect.value;
    const model = this.modelSelect.value;
    const targetPath = this.targetSelect.value === "__new__" ? null : this.targetSelect.value;
    const title = this.titleInput.value;
    const recommendation = this.selectedRecommendation();
    const summary = normalizeSummary(this.summaryInput.value).value;
    if (!source) return this.showError("공급자를 선택해 주세요.");
    if (!model) return this.showError("사용한 모델을 선택해 주세요.");
    if (targetPath === null && title.trim() === "") return this.showError("새 노트 제목을 입력해 주세요.");

    this.busy = true;
    this.setButtonsDisabled(true);
    this.showError("");
    try {
      await this.options.onSave({
        targetPath,
        title,
        source,
        model,
        outcome,
        recommendationLevel: recommendation.level,
        summary,
        pendingRecommendationId: recommendation.pendingId
      });
      this.close();
    } catch (error) {
      this.showError(error instanceof Error ? error.message : "저장 중 알 수 없는 오류가 발생했습니다.");
    } finally {
      this.busy = false;
      this.setButtonsDisabled(false);
    }
  }

  private setButtonsDisabled(disabled: boolean): void {
    for (const entry of this.outcomeButtons) entry.button.disabled = disabled;
  }

  private showError(message: string): void {
    this.errorEl.setText(message);
    this.errorEl.toggleClass("is-visible", message !== "");
  }
}

export class TaskRecommendationModal extends Modal {
  private selectedLevel: RecommendationLevel | null = null;
  private task = "";
  private errorEl!: HTMLElement;
  private resultEl!: HTMLElement;

  constructor(
    app: App,
    private readonly models: ModelDefinition[],
    private readonly onOpenApp: (request: OpenAppRecommendation) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ai-saver-modal", "ai-recommender-modal");
    this.titleEl.setText("AI 작업 모델 추천");
    this.contentEl.createEl("p", {
      text: "하려는 일을 적으면 API 비용 없이 Codex와 Claude 모델을 추천합니다.",
      cls: "ai-saver-lead"
    });

    new Setting(this.contentEl)
      .setName("무엇을 하려 하나요?")
      .setDesc("목표·난이도·작업 범위를 구체적으로 적으면 추천이 더 정확합니다.")
      .addTextArea((text) => {
        text.inputEl.rows = 5;
        text.inputEl.addClass("ai-recommender-input");
        text.setPlaceholder("예: 여러 파일의 결제 코드를 리팩터링하고 버그를 찾아줘")
          .onChange((value) => {
            this.task = value;
            this.selectedLevel = null;
            if (value.trim()) this.showError("");
            if (this.resultEl) {
              this.resultEl.empty();
              this.resultEl.addClass("ai-saver-hidden");
            }
          });
        window.setTimeout(() => text.inputEl.focus(), 0);
      });

    this.errorEl = this.contentEl.createDiv({ cls: "ai-saver-error" });
    this.errorEl.setAttr("aria-live", "assertive");
    this.resultEl = this.contentEl.createDiv({ cls: "ai-recommender-results ai-saver-hidden" });
    this.resultEl.setAttr("aria-live", "polite");

    const actions = this.contentEl.createDiv({ cls: "ai-saver-dialog-actions" });
    const closeButton = actions.createEl("button", { text: "닫기" });
    closeButton.setAttr("type", "button");
    closeButton.addEventListener("click", () => this.close());
    const recommendButton = actions.createEl("button", { text: "모델 추천받기", cls: "mod-cta" });
    recommendButton.setAttr("type", "button");
    recommendButton.addEventListener("click", () => this.renderRecommendation());

    this.contentEl.addEventListener("keydown", (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        this.renderRecommendation();
      }
    });
  }

  private renderRecommendation(): void {
    if (!this.task.trim()) {
      this.showError("하려는 일을 먼저 적어 주세요.");
      return;
    }

    const analysis = analyzeTask(this.task, this.selectedLevel ?? undefined);
    if (analysis.needsClarification) {
      this.renderClarification(analysis);
      return;
    }
    this.renderRecommendationResult(analysis.level);
  }

  private renderClarification(analysis: TaskAnalysis): void {
    this.showError("");
    this.resultEl.empty();
    this.resultEl.removeClass("ai-saver-hidden");
    this.resultEl.createEl("h3", { text: analysis.question ?? "작업 수준을 선택해 주세요.", cls: "ai-recommender-question" });
    this.resultEl.createEl("p", {
      text: "한 번만 선택하면 적합한 Codex·Claude 모델을 바로 보여줍니다.",
      cls: "ai-saver-lead"
    });
    const choices = this.resultEl.createDiv({ cls: "ai-recommender-choices" });
    for (const option of analysis.options) {
      const button = choices.createEl("button", { cls: "ai-recommender-choice" });
      button.setAttr("type", "button");
      button.createEl("strong", { text: option.label });
      button.createEl("span", { text: option.description });
      button.addEventListener("click", () => {
        this.selectedLevel = option.level;
        this.renderRecommendationResult(option.level);
      });
    }
  }

  private renderRecommendationResult(level: RecommendationLevel): void {
    const result = recommendModels(this.task, this.models, level);
    if (result.unavailableSources.length > 0) {
      const providers = result.unavailableSources.map((source) => source === "codex" ? "Codex" : "Claude").join("·");
      this.resultEl.empty();
      this.resultEl.addClass("ai-saver-hidden");
      this.showError(`${providers}에서 활성화된 모델이 없습니다. 플러그인 설정에서 모델을 켜 주세요.`);
      return;
    }

    this.showError("");
    this.resultEl.empty();
    this.resultEl.removeClass("ai-saver-hidden");
    const heading = this.resultEl.createDiv({ cls: "ai-recommender-heading" });
    heading.createSpan({ text: result.levelLabel, cls: `ai-recommender-level is-${result.level}` });
    heading.createEl("p", { text: result.summary });

    const cards = this.resultEl.createDiv({ cls: "ai-recommender-cards" });
    for (const recommendation of result.recommendations) {
      const card = cards.createDiv({ cls: "ai-recommender-card" });
      card.createDiv({
        text: recommendation.source === "codex" ? "Codex 추천" : "Claude 추천",
        cls: "ai-recommender-source"
      });
      card.createEl("h3", { text: recommendation.label });
      card.createDiv({ text: recommendation.executionModeLabel, cls: "ai-recommender-execution-mode" });
      card.createEl("p", { text: recommendation.reason, cls: "ai-recommender-reason" });
      card.createEl("p", { text: recommendation.description, cls: "setting-item-description" });
      const openButton = card.createEl("button", {
        text: recommendation.source === "codex" ? "Codex 열기" : "Claude 열기",
        cls: "ai-recommender-open"
      });
      openButton.setAttr("type", "button");
      openButton.addEventListener("click", () => void this.openApp(
        recommendation.source,
        recommendation.model,
        level,
        openButton
      ));
    }
  }

  private async openApp(
    source: RecommendationSource,
    model: string,
    level: RecommendationLevel,
    button: HTMLButtonElement
  ): Promise<void> {
    button.disabled = true;
    this.showError("");
    try {
      await this.onOpenApp({ source, model, level, task: this.task });
    } catch (error) {
      this.showError(error instanceof Error ? error.message : "AI 앱을 열지 못했습니다.");
    } finally {
      button.disabled = false;
    }
  }

  private showError(message: string): void {
    this.errorEl.setText(message);
    this.errorEl.toggleClass("is-visible", message !== "");
  }
}

export type CollisionChoice = "append" | "suffix" | "cancel";

export class CollisionModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly title: string,
    private readonly canAppend: boolean,
    private readonly resolveChoice: (choice: CollisionChoice) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("같은 제목의 노트가 있습니다");
    this.contentEl.createEl("p", { text: `“${this.title}” 파일이 이미 존재합니다.` });
    const actions = this.contentEl.createDiv({ cls: "ai-saver-dialog-actions" });
    if (this.canAppend) this.addButton(actions, "기존 노트에 추가", "append", true);
    this.addButton(actions, "숫자 접미사로 새 노트", "suffix", !this.canAppend);
    this.addButton(actions, "취소", "cancel", false);
  }

  onClose(): void {
    if (!this.settled) this.resolveChoice("cancel");
    this.contentEl.empty();
  }

  private addButton(container: HTMLElement, label: string, choice: CollisionChoice, primary: boolean): void {
    const button = container.createEl("button", { text: label, cls: primary ? "mod-cta" : "" });
    button.addEventListener("click", () => {
      this.settled = true;
      this.resolveChoice(choice);
      this.close();
    });
  }
}

export interface CorrectionChoice {
  targetRev: number;
  action: "void" | "restore";
  reason: string;
}

export class CorrectionModal extends Modal {
  constructor(app: App, private readonly revisions: RevisionMeta[], private readonly onApply: (choice: CorrectionChoice) => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("리비전 유효성 변경");
    let selected = this.revisions.at(-1);
    let reason = "";
    const state = this.contentEl.createEl("p", { cls: "setting-item-description" });
    const updateState = (): void => state.setText(selected?.voided ? "현재 무효 · 복원 이벤트를 추가합니다." : "현재 유효 · 무효 이벤트를 추가합니다.");
    new Setting(this.contentEl).setName("대상 리비전").addDropdown((dropdown) => {
      for (const revision of this.revisions) {
        dropdown.addOption(String(revision.rev), `revision ${revision.rev} · ${revision.model} · ${revision.outcome}${revision.voided ? " · 무효" : ""}`);
      }
      if (selected) dropdown.setValue(String(selected.rev));
      dropdown.onChange((value) => {
        selected = this.revisions.find((revision) => revision.rev === Number(value));
        updateState();
      });
    });
    new Setting(this.contentEl).setName("사유 (선택)").addText((text) => text.onChange((value) => { reason = value; }));
    updateState();
    const button = this.contentEl.createEl("button", { text: "정정 이벤트 추가", cls: "mod-cta" });
    button.addEventListener("click", async () => {
      if (!selected) return;
      button.disabled = true;
      try {
        await this.onApply({ targetRev: selected.rev, action: selected.voided ? "restore" : "void", reason });
        this.close();
      } finally {
        button.disabled = false;
      }
    });
  }
}

export interface SummaryCorrectionChoice {
  targetRev: number;
  summary: string;
}

export class SummaryCorrectionModal extends Modal {
  constructor(
    app: App,
    private readonly revisions: RevisionMeta[],
    private readonly onApply: (choice: SummaryCorrectionChoice) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("한 줄 메모 보완");
    const ordered = [...this.revisions]
      .sort((left, right) => Number(left.voided) - Number(right.voided)
        || Number(left.summary !== "") - Number(right.summary !== "")
        || right.rev - left.rev);
    let selected = ordered[0];
    let summary = selected?.summary ?? "";
    let summaryInput: HTMLInputElement | null = null;

    new Setting(this.contentEl).setName("대상 리비전").addDropdown((dropdown) => {
      for (const revision of ordered) {
        dropdown.addOption(
          String(revision.rev),
          `revision ${revision.rev} · ${revision.model} · ${revision.summary === "" ? "메모 없음" : revision.summary}`
        );
      }
      if (selected) dropdown.setValue(String(selected.rev));
      dropdown.onChange((value) => {
        selected = ordered.find((revision) => revision.rev === Number(value));
        summary = selected?.summary ?? "";
        if (summaryInput) summaryInput.value = summary;
      });
    });
    new Setting(this.contentEl).setName("한 줄 메모").addText((text) => {
      summaryInput = text.inputEl;
      text.setValue(summary).setPlaceholder("이번 리비전의 결론이나 다음 행동")
        .onChange((value) => { summary = value; });
      window.setTimeout(() => text.inputEl.focus(), 0);
    });
    const errorEl = this.contentEl.createDiv({ cls: "ai-saver-error" });
    errorEl.setAttr("aria-live", "assertive");
    const button = this.contentEl.createEl("button", { text: "메모 정정 이벤트 추가", cls: "mod-cta" });
    button.addEventListener("click", async () => {
      if (!selected) return;
      button.disabled = true;
      try {
        await this.onApply({ targetRev: selected.rev, summary });
        this.close();
      } catch (error) {
        errorEl.setText(error instanceof Error ? error.message : "한 줄 메모를 보완하지 못했습니다.");
        errorEl.addClass("is-visible");
      } finally {
        button.disabled = false;
      }
    });
  }
}

export interface RecoveryActions {
  retry(): Promise<void>;
  copy(): Promise<void>;
  export(): Promise<void>;
}

export class RecoveryModal extends Modal {
  constructor(app: App, private readonly message: string, private readonly actions: RecoveryActions) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("원문을 저장하지 못했습니다");
    this.contentEl.createEl("p", { text: this.message });
    this.contentEl.createEl("p", { text: "원문은 이 창이 열려 있는 동안 메모리에 유지됩니다.", cls: "setting-item-description" });
    const actions = this.contentEl.createDiv({ cls: "ai-saver-dialog-actions" });
    this.addAsyncButton(actions, "다시 시도", async () => { await this.actions.retry(); this.close(); }, true);
    this.addAsyncButton(actions, "원문 복사", () => this.actions.copy(), false);
    this.addAsyncButton(actions, "복구 파일로 내보내기", () => this.actions.export(), false);
    const cancel = actions.createEl("button", { text: "취소" });
    cancel.addEventListener("click", () => this.close());
  }

  private addAsyncButton(container: HTMLElement, label: string, action: () => Promise<void>, primary: boolean): void {
    const button = container.createEl("button", { text: label, cls: primary ? "mod-cta" : "" });
    button.addEventListener("click", async () => {
      button.disabled = true;
      try { await action(); } finally { button.disabled = false; }
    });
  }
}

export interface ImportRequest {
  provider: "claude" | "chatgpt";
  vaultPath: string;
}

export class ImportModal extends Modal {
  private provider: "claude" | "chatgpt" = "claude";
  private path = "";

  constructor(app: App, private readonly onSubmit: (request: ImportRequest) => void) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("과거 대화 가져오기");
    this.contentEl.createEl("p", {
      text: "Claude 또는 ChatGPT 계정 설정에서 받은 공식 데이터 내보내기의 conversations.json 파일을 볼트 안에 먼저 옮겨 두세요.",
      cls: "setting-item-description"
    });

    new Setting(this.contentEl)
      .setName("어느 서비스의 내보내기인가요")
      .addDropdown((dropdown) => dropdown
        .addOption("claude", "Claude")
        .addOption("chatgpt", "ChatGPT (Codex)")
        .setValue(this.provider)
        .onChange((value) => { this.provider = value === "chatgpt" ? "chatgpt" : "claude"; }));

    new Setting(this.contentEl)
      .setName("볼트 안 conversations.json 경로")
      .setDesc("예: 99-가져오기/conversations.json")
      .addText((text) => text
        .setPlaceholder("99-가져오기/conversations.json")
        .onChange((value) => { this.path = value.trim(); }));

    const actions = this.contentEl.createDiv({ cls: "ai-saver-dialog-actions" });
    const submit = actions.createEl("button", { text: "가져오기 시작", cls: "mod-cta" });
    submit.addEventListener("click", () => {
      if (this.path === "") return;
      this.onSubmit({ provider: this.provider, vaultPath: this.path });
      this.close();
    });
    const cancel = actions.createEl("button", { text: "취소" });
    cancel.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
