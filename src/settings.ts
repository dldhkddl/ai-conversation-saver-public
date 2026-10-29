import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_MODELS } from "./domain";
import type { ModelDefinition } from "./domain";
import { sanitizePendingRecommendations } from "./pending";
import type { PendingRecommendation } from "./pending";

export interface SaverSettings {
  conversationFolder: string;
  knowledgeFolder: string;
  sizeWarnMB: number;
  lastSource: string | null;
  lastModel: Record<string, string>;
  pendingRecommendations: PendingRecommendation[];
  models: ModelDefinition[];
}

export const DEFAULT_SETTINGS: SaverSettings = {
  conversationFolder: "01-대화 원본",
  knowledgeFolder: "02-지식",
  sizeWarnMB: 1,
  lastSource: null,
  lastModel: {},
  pendingRecommendations: [],
  models: DEFAULT_MODELS.map((model) => ({ ...model }))
};

function validModel(value: unknown): value is ModelDefinition {
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<ModelDefinition>;
  return typeof model.source === "string"
    && typeof model.id === "string"
    && typeof model.label === "string"
    && typeof model.description === "string"
    && typeof model.enabled === "boolean";
}

export function loadSettings(value: unknown): SaverSettings {
  const saved = value && typeof value === "object" ? value as Partial<SaverSettings> : {};
  const savedModels = Array.isArray(saved.models) ? saved.models.filter(validModel) : [];
  const models = DEFAULT_MODELS.map((builtin) => {
    const previous = savedModels.find((model) => model.source === builtin.source && model.id === builtin.id);
    return { ...builtin, enabled: previous?.enabled ?? builtin.enabled };
  });
  for (const custom of savedModels.filter((model) => !model.builtin)) {
    if (!models.some((model) => model.source === custom.source && model.id === custom.id)) {
      models.push({ ...custom, builtin: false });
    }
  }

  return {
    conversationFolder: typeof saved.conversationFolder === "string" ? saved.conversationFolder : DEFAULT_SETTINGS.conversationFolder,
    knowledgeFolder: typeof saved.knowledgeFolder === "string" ? saved.knowledgeFolder : DEFAULT_SETTINGS.knowledgeFolder,
    sizeWarnMB: typeof saved.sizeWarnMB === "number" && saved.sizeWarnMB > 0 ? saved.sizeWarnMB : DEFAULT_SETTINGS.sizeWarnMB,
    lastSource: typeof saved.lastSource === "string" ? saved.lastSource : null,
    lastModel: saved.lastModel && typeof saved.lastModel === "object" ? { ...saved.lastModel } : {},
    pendingRecommendations: sanitizePendingRecommendations(saved.pendingRecommendations, Date.now()),
    models
  };
}

export interface SettingsHost extends Plugin {
  settings: SaverSettings;
  saveSettings(): Promise<void>;
}

export class SaverSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly host: SettingsHost) {
    super(app, host);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "AI 대화 저장" });
    containerEl.createEl("p", {
      text: "대화는 로컬 볼트에만 저장되며 외부 API나 네트워크를 사용하지 않습니다.",
      cls: "setting-item-description"
    });

    new Setting(containerEl)
      .setName("대화 원본 폴더")
      .setDesc("공급자·모델·연도 하위 폴더 없이 평평하게 저장합니다.")
      .addText((text) => text
        .setPlaceholder("01-대화 원본")
        .setValue(this.host.settings.conversationFolder)
        .onChange(async (value) => {
          this.host.settings.conversationFolder = value.trim() || DEFAULT_SETTINGS.conversationFolder;
          await this.host.saveSettings();
        }));

    new Setting(containerEl)
      .setName("지식 노트 폴더")
      .setDesc("명령을 실행했을 때만 지식 노트를 만듭니다.")
      .addText((text) => text
        .setPlaceholder("02-지식")
        .setValue(this.host.settings.knowledgeFolder)
        .onChange(async (value) => {
          this.host.settings.knowledgeFolder = value.trim() || DEFAULT_SETTINGS.knowledgeFolder;
          await this.host.saveSettings();
        }));

    new Setting(containerEl)
      .setName("파일 크기 경고")
      .setDesc("저장은 막지 않고 이 크기(MB)를 넘으면 알립니다.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "0.1";
        text.inputEl.step = "0.1";
        text.setValue(String(this.host.settings.sizeWarnMB)).onChange(async (value) => {
          const number = Number(value);
          if (Number.isFinite(number) && number > 0) {
            this.host.settings.sizeWarnMB = number;
            await this.host.saveSettings();
          }
        });
      });

    containerEl.createEl("h3", { text: "기본 모델" });
    for (const model of this.host.settings.models.filter((item) => item.builtin)) {
      new Setting(containerEl)
        .setName(`${model.label} · ${model.source}`)
        .setDesc(model.description)
        .addToggle((toggle) => toggle.setValue(model.enabled).onChange(async (enabled) => {
          model.enabled = enabled;
          await this.host.saveSettings();
        }));
    }

    containerEl.createEl("h3", { text: "사용자 정의 모델" });
    const help = containerEl.createEl("p", {
      text: "한 줄에 공급자|저장 ID|표시 이름|설명을 입력합니다. 예: codex|my-model|내 모델|사내용 모델",
      cls: "setting-item-description"
    });
    help.setAttr("aria-live", "polite");
    new Setting(containerEl)
      .setName("모델 목록")
      .addTextArea((area) => {
        const custom = this.host.settings.models.filter((model) => !model.builtin);
        area.setValue(custom.map((model) => [model.source, model.id, model.label, model.description].join("|")).join("\n"));
        area.inputEl.rows = 6;
        area.inputEl.addClass("ai-saver-settings-textarea");
        area.onChange(async (value) => {
          const parsed: ModelDefinition[] = [];
          for (const [index, line] of value.split("\n").entries()) {
            if (line.trim() === "") continue;
            const [source, id, label, ...descriptionParts] = line.split("|").map((part) => part.trim());
            const description = descriptionParts.join("|");
            if (!source || !id || !label || !description || !/^[a-z0-9][a-z0-9._-]*$/.test(source) || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
              help.setText(`${index + 1}번째 줄 형식이 올바르지 않아 저장하지 않았습니다.`);
              return;
            }
            if (parsed.some((model) => model.source === source && model.id === id)) {
              help.setText(`${index + 1}번째 줄의 저장 ID가 중복됩니다.`);
              return;
            }
            parsed.push({ source, id, label, description, enabled: true, builtin: false });
          }
          const builtin = this.host.settings.models.filter((model) => model.builtin);
          this.host.settings.models = [...builtin, ...parsed];
          help.setText("사용자 정의 모델을 저장했습니다.");
          await this.host.saveSettings();
        });
      });
  }
}
