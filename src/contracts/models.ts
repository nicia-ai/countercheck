export const JEV_MODEL_ID = "jev-1.14.0";
export const CLEF_MODEL_ID = "clef";
export const CLEF_FLASH_MODEL_ID = "clef-flash";
export const CLEF_OMNI_MODEL_ID = "clef-omni";
export const OPENAI_MODEL_ID = "gpt-6-luna";
export const DECISION_ONE_MODEL_ID = "microsoft/microsoft-decision-1";
export const DECIDER_MODEL_ID = "perplexity/pplx-decider-v1.2";
export const DECIDER_FLASH_MODEL_ID = "perplexity/pplx-decider-flash-v1.2";
export const MODEL_IDS = [
  JEV_MODEL_ID,
  CLEF_MODEL_ID,
  CLEF_FLASH_MODEL_ID,
  CLEF_OMNI_MODEL_ID,
  OPENAI_MODEL_ID,
  DECISION_ONE_MODEL_ID,
  DECIDER_MODEL_ID,
  DECIDER_FLASH_MODEL_ID,
] as const;
export type Model = (typeof MODEL_IDS)[number];
export const DEFAULT_MODEL = JEV_MODEL_ID;
export const MODEL_ROUTE_IDS = ["jev", "clef", "openai-decisions", "openrouter"] as const;
export type ModelRoute = (typeof MODEL_ROUTE_IDS)[number];
export const MODEL_ROUTES = {
  [JEV_MODEL_ID]: "jev",
  [CLEF_MODEL_ID]: "clef",
  [CLEF_FLASH_MODEL_ID]: "clef",
  [CLEF_OMNI_MODEL_ID]: "clef",
  [OPENAI_MODEL_ID]: "openai-decisions",
  [DECISION_ONE_MODEL_ID]: "openrouter",
  [DECIDER_MODEL_ID]: "openrouter",
  [DECIDER_FLASH_MODEL_ID]: "openrouter",
} as const satisfies Record<Model, ModelRoute>;
export const SUPPORTED_MODELS = [
  { id: JEV_MODEL_ID, name: "Jev 1.14", provider: "typesafe" },
  { id: CLEF_MODEL_ID, name: "Clef", provider: "cloudflare-workers-ai" },
  { id: CLEF_FLASH_MODEL_ID, name: "Clef Flash", provider: "cloudflare-workers-ai" },
  { id: CLEF_OMNI_MODEL_ID, name: "Clef Omni", provider: "cloudflare-workers-ai" },
  { id: OPENAI_MODEL_ID, name: "GPT-6 Luna (OpenAI Decisions)", provider: "openai-decisions" },
  { id: DECISION_ONE_MODEL_ID, name: "Decision-1 (OpenRouter)", provider: "openrouter-microsoft" },
  {
    id: DECIDER_MODEL_ID,
    name: "Pplx Decider v1.2 (OpenRouter)",
    provider: "openrouter-perplexity",
  },
  {
    id: DECIDER_FLASH_MODEL_ID,
    name: "Pplx Decider Flash v1.2 (OpenRouter)",
    provider: "openrouter-perplexity",
  },
] as const;
export type ModelCatalogEntry = (typeof SUPPORTED_MODELS)[number] & { configured: boolean };
