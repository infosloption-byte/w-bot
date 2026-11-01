import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SAAS_ENABLED: z.enum(["true", "false"]).default("false"),
  SAAS_BOT_NUMBER: z.string().optional(),
  SAAS_SIGNUP_CODE: z.string().optional(),
  SAAS_REQUIRE_EMAIL_VERIFICATION: z.enum(["true", "false"]).default("false"),
  PORTAL_PUBLIC_URL: z.string().url().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().email().optional(),
  MESSAGE_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  GATEWAY_ALERT_EMAIL: z.string().email().optional(),
  SAAS_COOKIE_SECURE: z.enum(["true", "false"]).default("true"),
  SAAS_MAX_GROUPS: z.coerce.number().int().min(1).max(30).default(3),
  SAAS_MONTHLY_MESSAGES: z.coerce.number().int().min(10).max(100000).default(1000),
  ADMIN_API_KEY: z.string().min(32),
  WHATSAPP_VERIFY_TOKEN: z.string().min(16),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v25.0"),
  WEB_GATEWAY_ENABLED: z.enum(["true", "false"]).default("false"),
  WEB_GATEWAY_TOKEN: z.string().optional(),
  WEB_GATEWAY_URL: z.string().url().default("http://web-gateway:9029"),
  BYON_GATEWAY_ENABLED: z.enum(["true", "false"]).default("false"),
  BYON_GATEWAY_TOKEN: z.string().optional(),
  BYON_GATEWAY_URL: z.string().url().default("http://byon-gateway:9039"),
  GOOGLE_TRANSLATE_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  // Isolated Smart Alerts AI processing; opt-in for the pilot.
  ALERTS_AI_ENABLED: z.enum(["true", "false"]).default("false"),
  ALERTS_GEMINI_API_KEY: z.string().optional(),
  ALERTS_GEMINI_MODEL: z.string().regex(/^gemini-[a-zA-Z0-9.-]+$/).optional(),
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
  if (cfg.SAAS_ENABLED === "true" && (!cfg.SAAS_SIGNUP_CODE || cfg.SAAS_SIGNUP_CODE.length < 24)) {
    throw new Error("SAAS_SIGNUP_CODE must be at least 24 characters when portal is enabled");
  }
  if (cfg.SAAS_REQUIRE_EMAIL_VERIFICATION === "true" &&
    (!cfg.SMTP_HOST || !cfg.SMTP_FROM || !cfg.PORTAL_PUBLIC_URL)) {
    throw new Error("Email verification requires SMTP_HOST, SMTP_FROM and PORTAL_PUBLIC_URL");
  }
  if (cfg.ALERTS_AI_ENABLED === "true" &&
      !(cfg.ALERTS_GEMINI_API_KEY?.trim() || cfg.GEMINI_API_KEY?.trim())) {
    throw new Error("ALERTS_AI_ENABLED requires ALERTS_GEMINI_API_KEY or GEMINI_API_KEY");
  }
  if (cfg.TRANSLATION_PROVIDER === "google" && !cfg.GOOGLE_TRANSLATE_API_KEY) {
    throw new Error("GOOGLE_TRANSLATE_API_KEY required for google provider");
  }
  if (cfg.TRANSLATION_PROVIDER === "gemini" && !cfg.GEMINI_API_KEY?.trim()) {
    throw new Error("GEMINI_API_KEY required for gemini provider");
  }
  if (cfg.WEB_GATEWAY_ENABLED === "true" && (!cfg.WEB_GATEWAY_TOKEN || cfg.WEB_GATEWAY_TOKEN.length < 32)) {
    throw new Error("WEB_GATEWAY_TOKEN of at least 32 characters required when Web gateway enabled");
  }
  if (cfg.BYON_GATEWAY_ENABLED === "true" &&
      (!cfg.BYON_GATEWAY_TOKEN || cfg.BYON_GATEWAY_TOKEN.length < 32)) {
    throw new Error("BYON_GATEWAY_TOKEN must be at least 32 characters when enabled");
  }
  if (cfg.DRY_RUN === "false" && cfg.WEB_GATEWAY_ENABLED !== "true"
      && cfg.BYON_GATEWAY_ENABLED !== "true"
      && (!cfg.WHATSAPP_APP_SECRET || !cfg.WHATSAPP_ACCESS_TOKEN || !cfg.WHATSAPP_PHONE_NUMBER_ID)) {
    throw new Error("Live mode requires an enabled Web gateway or authorized Meta credentials");
  }
  return { ...cfg, dryRun: cfg.DRY_RUN === "true", webEnabled: cfg.WEB_GATEWAY_ENABLED === "true", saasEnabled: cfg.SAAS_ENABLED === "true" };
}
