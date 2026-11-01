import type { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";
import { mailConfigured, sendAccountEmail } from "./mailer.js";

/** Track state transitions without reading or writing WhatsApp authentication
 * files. Notifications are only emitted after a sustained outage, to avoid
 * noise during brief network reconnects.
 */
export async function checkGatewayHealth(prisma: PrismaClient, cfg: Config, now = new Date()) {
  if (!cfg.webEnabled || !cfg.WEB_GATEWAY_TOKEN) return;
  let state = "UNREACHABLE";
  try {
    const response = await fetch(cfg.WEB_GATEWAY_URL + "/status", {
      headers: { authorization: "Bearer " + cfg.WEB_GATEWAY_TOKEN },
      signal: AbortSignal.timeout(3000)
    });
    if (response.ok) {
      const status = await response.json() as { connected?: boolean };
      state = status.connected ? "CONNECTED" : "DISCONNECTED";
    }
  } catch { /* retain UNREACHABLE */ }
  const old = await prisma.gatewayHealth.findUnique({ where: { name: "web" } });
  if (!old) {
    await prisma.gatewayHealth.create({
      data: { name: "web", state, checkedAt: now, changedAt: now }
    });
    return;
  }
  const changed = old.state !== state;
  const alertable = state !== "CONNECTED" && !changed
    && now.getTime() - old.changedAt.getTime() >= 5 * 60_000
    && (!old.alertedAt || now.getTime() - old.alertedAt.getTime() >= 60 * 60_000);
  await prisma.gatewayHealth.update({
    where: { name: "web" },
    data: {
      state, checkedAt: now,
      ...(changed ? { changedAt: now, alertedAt: null } : {}),
      ...(alertable ? { alertedAt: now } : {})
    }
  });
  if (alertable && cfg.GATEWAY_ALERT_EMAIL && mailConfigured(cfg)) {
    try {
      // Gateway alert transport can be replaced by a dedicated transactional
      // provider. Do not include linked auth, group IDs or customer content.
      await sendGatewayAlert(cfg, cfg.GATEWAY_ALERT_EMAIL, state);
    } catch { console.warn("Gateway alert delivery failed"); }
  }
}

async function sendGatewayAlert(cfg: Config, to: string, state: string) {
  // Reuse configured SMTP transport without inventing an account token.
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.default.createTransport({
    host: cfg.SMTP_HOST!, port: cfg.SMTP_PORT, secure: cfg.SMTP_PORT === 465,
    auth: cfg.SMTP_USER && cfg.SMTP_PASSWORD
      ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASSWORD } : undefined
  });
  try {
    await transport.sendMail({
      from: cfg.SMTP_FROM, to,
      subject: "W-Bot gateway connectivity warning",
      text: "The shared WhatsApp Web gateway is " + state +
        " for at least five minutes. Check your W-Bot operations dashboard."
    });
  } finally { transport.close(); }
}
