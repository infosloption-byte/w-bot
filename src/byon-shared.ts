import { timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";

export function byonAuthorized(header: string | undefined, cfg: Config): boolean {
  const received = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = cfg.BYON_GATEWAY_TOKEN ?? "";
  const a = Buffer.from(received), b = Buffer.from(expected);
  return cfg.BYON_GATEWAY_ENABLED === "true" && b.length >= 32 &&
    a.length === b.length && timingSafeEqual(a, b);
}
export const connectionKey = (id: string) => "byon:" + id;
export const isConnectionId = (id: string): boolean => /^c[a-z0-9]{18,35}$/.test(id);
export function connectionTypeAllowed(
  policy: { customerNumbersEnabled: boolean; personalEnabled: boolean; businessEnabled: boolean },
  kind: "PERSONAL" | "BUSINESS"
): boolean {
  return policy.customerNumbersEnabled &&
    (kind === "PERSONAL" ? policy.personalEnabled : policy.businessEnabled);
}
export async function byonRequest(
  cfg: Config, path: string, method: "GET" | "POST" = "GET", data?: unknown
): Promise<Response> {
  if (!cfg.BYON_GATEWAY_ENABLED || cfg.BYON_GATEWAY_ENABLED !== "true" || !cfg.BYON_GATEWAY_TOKEN)
    throw new Error("Customer-number gateway not configured");
  return fetch(cfg.BYON_GATEWAY_URL + path, {
    method,
    headers: { authorization: "Bearer " + cfg.BYON_GATEWAY_TOKEN, "content-type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(12000)
  });
}
