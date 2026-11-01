import nodemailer from "nodemailer";
import { randomBytes } from "node:crypto";
import type { PrismaClient, AccountTokenKind } from "@prisma/client";
import type { Config } from "./config.js";
import { digest } from "./portal-auth.js";

export function mailConfigured(cfg: Config): boolean {
  return Boolean(cfg.SMTP_HOST && cfg.SMTP_FROM && cfg.PORTAL_PUBLIC_URL);
}

export function accountLink(cfg: Config, action: "verify" | "reset", token: string): string {
  if (!cfg.PORTAL_PUBLIC_URL) throw new Error("Customer portal URL missing");
  const url = new URL(cfg.PORTAL_PUBLIC_URL);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("Customer emails require an HTTPS portal URL");
  }
  url.searchParams.set("action", action);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function issueAccountToken(
  prisma: PrismaClient, userId: string, kind: AccountTokenKind
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + (kind === "VERIFY_EMAIL" ? 24 * 60 : 30) * 60_000);
  await prisma.$transaction(async tx => {
    await tx.accountToken.deleteMany({ where: { userId, kind } });
    await tx.accountToken.create({ data: { userId, kind, tokenHash: digest(token), expiresAt } });
  });
  return token;
}

export async function consumeAccountToken(
  prisma: PrismaClient, token: string, kind: AccountTokenKind
): Promise<string | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const now = new Date();
  const found = await prisma.accountToken.findUnique({
    where: { tokenHash: digest(token) }
  });
  if (!found || found.kind !== kind || found.usedAt || found.expiresAt <= now) return null;
  const claimed = await prisma.accountToken.updateMany({
    where: { id: found.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now }
  });
  return claimed.count === 1 ? found.userId : null;
}

export async function sendAccountEmail(
  cfg: Config, to: string, kind: "verify" | "reset", token: string
): Promise<void> {
  if (!mailConfigured(cfg)) throw new Error("Customer email is not configured");
  const link = accountLink(cfg, kind, token);
  const subject = kind === "verify" ? "Verify your W-Bot email" : "Reset your W-Bot password";
  const description = kind === "verify" ? "verify your email address" : "reset your password";
  const expiry = kind === "verify" ? "24 hours" : "30 minutes";
  const transporter = nodemailer.createTransport({
    host: cfg.SMTP_HOST!,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_PORT === 465,
    auth: cfg.SMTP_USER && cfg.SMTP_PASSWORD
      ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASSWORD } : undefined
  });
  try {
    await transporter.sendMail({
      from: cfg.SMTP_FROM, to, subject,
      text: "Use this link to " + description + ":\n" + link +
        "\n\nThis link expires in " + expiry +
        ". If you didn't request this, ignore the message.\nW-Bot by SL Options",
    });
  } finally {
    transporter.close();
  }
}
