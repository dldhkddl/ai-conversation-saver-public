"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecoveryModal = exports.CorrectionModal = exports.CollisionModal = exports.SaveConversationModal = void 0;
const obsidian_1 = require("obsidian");
const sourceLabel = (source) => source === "codex" ? "Codex" : source === "claude" ? "Claude" : source;
class SaveConversationModal extends obsidian_1.Modal {
    options;
    targetSelect;
    titleInput;
    titleSetting;
    sourceSelect;
    modelSelect;
    modelDescription;
    errorEl;
    outcomeButtons = [];
    busy = false;
    constructor(app, options) {
        super(app);
        this.options = options;
    }
    onOpen() {
        this.modalEl.addClass("ai-saver-modal");
        this.titleEl.setText("AI 대화 저장");
        this.contentEl.createEl("p", {
            text: "클립보드 원문은 교체하지 않고 새 리비전으로 추가합니다.",
            cls: "ai-saver-lead"
        });
        new obsidian_1.Setting(this.contentEl)
            .setName("대화 노트 찾기")
            .setDesc("현재 노트와 최근 24시간 노트가 먼저 표시됩니다.")
            .addSearch((search) => search
            .setPlaceholder("제목 검색")
            .onChange((query) => this.renderCandidates(query)));
        new obsidian_1.Setting(this.contentEl)
            .setName("저장 대상")
            .addDropdown((dropdown) => {
            this.targetSelect = dropdown.selectEl;
            dropdown.onChange(() => this.updateTargetMode());
        });
        this.titleSetting = new obsidian_1.Setting(this.contentEl)
            .setName("새 노트 제목")
            .setDesc("날짜 접두사는 붙지 않으며 저장 전에 직접 확인할 수 있습니다.")
            .addText((text) => {
            this.titleInput = text.inputEl;
            text.setValue(this.options.suggestedTitle).setPlaceholder("대화 제목");
        });
        new obsidian_1.Setting(this.contentEl)
            .setName("공급자")
            .addDropdown((dropdown) => {
            this.sourceSelect = dropdown.selectEl;
            dropdown.addOption("", "선택하세요");
            for (const source of [...new Set(this.options.models.filter((model) => model.enabled).map((model) => model.source))]) {
                dropdown.addOption(source, sourceLabel(source));
            }
            dropdown.setValue(this.options.lastSource ?? "");
            dropdown.onChange(() => this.renderModels());
        });
        const modelSetting = new obsidian_1.Setting(this.contentEl)
            .setName("사용 모델")
            .addDropdown((dropdown) => {
            this.modelSelect = dropdown.selectEl;
            dropdown.onChange(() => this.updateModelDescription());
        });
        this.modelDescription = modelSetting.descEl;
        this.errorEl = this.contentEl.createDiv({ cls: "ai-saver-error" });
        this.errorEl.setAttr("aria-live", "assertive");
        const actions = this.contentEl.createDiv({ cls: "ai-saver-outcomes" });
        const outcomes = [
            ["good", "좋음으로 저장", "Alt+1"],
            ["mixed", "보통으로 저장", "Alt+2"],
            ["bad", "나쁨으로 저장", "Alt+3"]
        ];
        for (const [outcome, label, shortcut] of outcomes) {
            const button = actions.createEl("button", { text: label, cls: `ai-saver-outcome ai-saver-${outcome}` });
            button.setAttr("type", "button");
            button.setAttr("aria-keyshortcuts", shortcut);
            button.addEventListener("click", () => void this.submit(outcome));
            this.outcomeButtons.push(button);
        }
        this.contentEl.addEventListener("keydown", (event) => {
            if (!event.altKey || this.busy)
                return;
            const outcome = event.key === "1" ? "good" : event.key === "2" ? "mixed" : event.key === "3" ? "bad" : null;
            if (outcome) {
                event.preventDefault();
                void this.submit(outcome);
            }
        });
        this.renderCandidates("");
        this.renderModels();
        this.updateTargetMode();
    }
    renderCandidates(query) {
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
    updateTargetMode() {
        if (!this.titleSetting)
            return;
        const isNew = this.targetSelect.value === "__new__";
        this.titleSetting.settingEl.toggleClass("ai-saver-hidden", !isNew);
    }
    renderModels() {
        if (!this.modelSelect || !this.sourceSelect)
            return;
        const source = this.sourceSelect.value;
        this.modelSelect.empty();
        this.modelSelect.add(new Option("선택하세요", ""));
        for (const model of this.options.models.filter((item) => item.enabled && item.source === source)) {
            this.modelSelect.add(new Option(model.label, model.id));
        }
        const previous = this.options.lastModel[source] ?? "";
        if (Array.from(this.modelSelect.options).some((option) => option.value === previous))
            this.modelSelect.value = previous;
        this.updateModelDescription();
    }
    updateModelDescription() {
        if (!this.modelDescription || !this.modelSelect || !this.sourceSelect)
            return;
        const model = this.options.models.find((item) => item.source === this.sourceSelect.value && item.id === this.modelSelect.value);
        this.modelDescription.setText(model?.description ?? "방금 사용한 모델을 확인해 주세요.");
    }
    async submit(outcome) {
        if (this.busy)
            return;
        const source = this.sourceSelect.value;
        const model = this.modelSelect.value;
        const targetPath = this.targetSelect.value === "__new__" ? null : this.targetSelect.value;
        const title = this.titleInput.value;
        if (!source)
            return this.showError("공급자를 선택해 주세요.");
        if (!model)
            return this.showError("사용한 모델을 선택해 주세요.");
        if (targetPath === null && title.trim() === "")
            return this.showError("새 노트 제목을 입력해 주세요.");
        this.busy = true;
        this.setButtonsDisabled(true);
        this.showError("");
        try {
            await this.options.onSave({ targetPath, title, source, model, outcome });
            this.close();
        }
        catch (error) {
            this.showError(error instanceof Error ? error.message : "저장 중 알 수 없는 오류가 발생했습니다.");
        }
        finally {
            this.busy = false;
            this.setButtonsDisabled(false);
        }
    }
    setButtonsDisabled(disabled) {
        for (const button of this.outcomeButtons)
            button.disabled = disabled;
    }
    showError(message) {
        this.errorEl.setText(message);
        this.errorEl.toggleClass("is-visible", message !== "");
    }
}
exports.SaveConversationModal = SaveConversationModal;
class CollisionModal extends obsidian_1.Modal {
    title;
    canAppend;
    resolveChoice;
    settled = false;
    constructor(app, title, canAppend, resolveChoice) {
        super(app);
        this.title = title;
        this.canAppend = canAppend;
        this.resolveChoice = resolveChoice;
    }
    onOpen() {
        this.titleEl.setText("같은 제목의 노트가 있습니다");
        this.contentEl.createEl("p", { text: `“${this.title}” 파일이 이미 존재합니다.` });
        const actions = this.contentEl.createDiv({ cls: "ai-saver-dialog-actions" });
        if (this.canAppend)
            this.addButton(actions, "기존 노트에 추가", "append", true);
        this.addButton(actions, "숫자 접미사로 새 노트", "suffix", !this.canAppend);
        this.addButton(actions, "취소", "cancel", false);
    }
    onClose() {
        if (!this.settled)
            this.resolveChoice("cancel");
        this.contentEl.empty();
    }
    addButton(container, label, choice, primary) {
        const button = container.createEl("button", { text: label, cls: primary ? "mod-cta" : "" });
        button.addEventListener("click", () => {
            this.settled = true;
            this.resolveChoice(choice);
            this.close();
        });
    }
}
exports.CollisionModal = CollisionModal;
class CorrectionModal extends obsidian_1.Modal {
    revisions;
    onApply;
    constructor(app, revisions, onApply) {
        super(app);
        this.revisions = revisions;
        this.onApply = onApply;
    }
    onOpen() {
        this.titleEl.setText("리비전 유효성 변경");
        let selected = this.revisions.at(-1);
        let reason = "";
        const state = this.contentEl.createEl("p", { cls: "setting-item-description" });
        const updateState = () => state.setText(selected?.voided ? "현재 무효 · 복원 이벤트를 추가합니다." : "현재 유효 · 무효 이벤트를 추가합니다.");
        new obsidian_1.Setting(this.contentEl).setName("대상 리비전").addDropdown((dropdown) => {
            for (const revision of this.revisions) {
                dropdown.addOption(String(revision.rev), `revision ${revision.rev} · ${revision.model} · ${revision.outcome}${revision.voided ? " · 무효" : ""}`);
            }
            if (selected)
                dropdown.setValue(String(selected.rev));
            dropdown.onChange((value) => {
                selected = this.revisions.find((revision) => revision.rev === Number(value));
                updateState();
            });
        });
        new obsidian_1.Setting(this.contentEl).setName("사유 (선택)").addText((text) => text.onChange((value) => { reason = value; }));
        updateState();
        const button = this.contentEl.createEl("button", { text: "정정 이벤트 추가", cls: "mod-cta" });
        button.addEventListener("click", async () => {
            if (!selected)
                return;
            button.disabled = true;
            try {
                await this.onApply({ targetRev: selected.rev, action: selected.voided ? "restore" : "void", reason });
                this.close();
            }
            finally {
                button.disabled = false;
            }
        });
    }
}
exports.CorrectionModal = CorrectionModal;
class RecoveryModal extends obsidian_1.Modal {
    message;
    actions;
    constructor(app, message, actions) {
        super(app);
        this.message = message;
        this.actions = actions;
    }
    onOpen() {
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
    addAsyncButton(container, label, action, primary) {
        const button = container.createEl("button", { text: label, cls: primary ? "mod-cta" : "" });
        button.addEventListener("click", async () => {
            button.disabled = true;
            try {
                await action();
            }
            finally {
                button.disabled = false;
            }
        });
    }
}
exports.RecoveryModal = RecoveryModal;
