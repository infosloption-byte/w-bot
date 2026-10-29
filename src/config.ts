import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  ADMIN_API_KEY: z.string().min(32),
  WHATSAPP_VERIFY_TOKEN: z.string().min(16),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v25.0"),
  WEB_GATEWAY_ENABLED: z.enum(["true", "false"]).default("false"),
  WEB_GATEWAY_TOKEN: z.string().optional(),
  WEB_GATEWAY_URL: z.string().url().default("http://web-gateway:9029"),
  GOOGLE_TRANSLATE_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().regex(/^gemini-[a-zA-Z0-9.-]+$/).default("gemini-3.5-flash-lite"),
  GEMINI_THINKING_LEVEL: z.enum(["minimal", "low", "medium", "high"]).default("minimal"),
  TRANSLATION_PROVIDER: z.enum(["mock", "google", "gemini"]).default("mock"),
  DRY_RUN: z.enum(["true", "false"]).default("true"),
  PORT: z.coerce.number().int().min(1).max(65535).default(9028),
  HOST: z.string().default("0.0.0.0")
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const cfg = schema.parse(env);
  if (cfg.TRANSLATION_PROVIDER === "google" && !cfg.GOOGLE_TRANSLATE_API_KEY) {
    throw new Error("GOOGLE_TRANSLATE_API_KEY required for google provider");
  }
  if (cfg.TRANSLATION_PROVIDER === "gemini" && !cfg.GEMINI_API_KEY?.trim()) {
    throw new Error("GEMINI_API_KEY required for gemini provider");
  }
  if (cfg.WEB_GATEWAY_ENABLED === "true" && (!cfg.WEB_GATEWAY_TOKEN || cfg.WEB_GATEWAY_TOKEN.length < 32)) {
    throw new Error("WEB_GATEWAY_TOKEN of at least 32 characters required when Web gateway enabled");
  }
  if (cfg.DRY_RUN === "false" && cfg.WEB_GATEWAY_ENABLED !== "true"
      && (!cfg.WHATSAPP_APP_SECRET || !cfg.WHATSAPP_ACCESS_TOKEN || !cfg.WHATSAPP_PHONE_NUMBER_ID)) {
    throw new Error("Live mode requires an enabled Web gateway or authorized Meta credentials");
  }
  return { ...cfg, dryRun: cfg.DRY_RUN === "true", webEnabled: cfg.WEB_GATEWAY_ENABLED === "true" };
}
