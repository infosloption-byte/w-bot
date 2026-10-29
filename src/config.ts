import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  ADMIN_API_KEY: z.string().min(32),
  WHATSAPP_VERIFY_TOKEN: z.string().min(16),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v25.0"),
  GOOGLE_TRANSLATE_API_KEY: z.string().optional(),
  TRANSLATION_PROVIDER: z.enum(["mock", "google"]).default("mock"),
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
  if (cfg.DRY_RUN === "false" && (!cfg.WHATSAPP_APP_SECRET || !cfg.WHATSAPP_ACCESS_TOKEN || !cfg.WHATSAPP_PHONE_NUMBER_ID)) {
    throw new Error("Live mode requires WhatsApp app secret, access token, and phone-number ID");
  }
  return { ...cfg, dryRun: cfg.DRY_RUN === "true" };
}
