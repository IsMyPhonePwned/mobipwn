/** OpenAI-compatible LLM endpoints — local (Ollama, LM Studio) or hosted APIs. */
export type LlmPreset = {
  id: string;
  label: string;
  apiUrl: string;
  model: string;
  keyRequired: boolean;
  hint: string;
};

export const LLM_PRESETS: LlmPreset[] = [
  {
    id: "ollama",
    label: "Ollama (local)",
    apiUrl: "http://127.0.0.1:11434/v1",
    model: "llama3.2",
    keyRequired: false,
    hint: "Run `ollama serve` and `ollama pull llama3.2`. No API key.",
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    apiUrl: "http://127.0.0.1:1234/v1",
    model: "local-model",
    keyRequired: false,
    hint: "Enable the local server in LM Studio → Developer. Use your loaded model id.",
  },
  {
    id: "openai",
    label: "OpenAI",
    apiUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyRequired: true,
    hint: "Hosted API — requires a valid API key.",
  },
  {
    id: "custom",
    label: "Custom",
    apiUrl: "",
    model: "",
    keyRequired: false,
    hint: "Any `/v1/chat/completions` endpoint (Azure OpenAI, Groq, etc.).",
  },
];

export function detectLlmPresetId(apiUrl: string): string {
  const u = apiUrl.trim().toLowerCase();
  if (!u) return "custom";
  if (u.includes("11434")) return "ollama";
  if (u.includes(":1234")) return "lmstudio";
  if (u.includes("api.openai.com")) return "openai";
  return "custom";
}

export function isLocalLlmUrl(apiUrl: string): boolean {
  const u = apiUrl.trim().toLowerCase();
  return (
    u.includes("localhost") ||
    u.includes("127.0.0.1") ||
    u.includes("[::1]") ||
    u.startsWith("http://0.0.0.0")
  );
}
