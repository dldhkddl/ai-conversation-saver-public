export interface ImportedConversation {
  source: "claude" | "codex";
  title: string;
  savedAt: string;
  transcript: string;
}

export interface ImportParseResult {
  conversations: ImportedConversation[];
  errors: string[];
}
