import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";

export type IncomingGroupMessage = {
  groupId: string; messageId: string; senderId: string; text: string;
};

export function verifySignature(body: Buffer, header: string | undefined, secret: string): boolean {
  if (!header || !/^sha256=[a-f0-9]{64}$/i.test(header)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const received = Buffer.from(header.slice(7), "hex");
  return received.length === expected.length && timingSafeEqual(expected, received);
}

export function extractGroupMessages(payload: unknown): IncomingGroupMessage[] {
  if (!payload || typeof payload !== "object" || (payload as any).object !== "whatsapp_business_account") return [];
  const out: IncomingGroupMessage[] = [];
  for (const entry of (Array.isArray((payload as any).entry) ? (payload as any).entry : [])) {
    for (const change of (Array.isArray(entry?.changes) ? entry.changes : [])) {
      if (change?.field !== "messages") continue;
      for (const msg of (Array.isArray(change?.value?.messages) ? change.value.messages : [])) {
        // Require the official Groups API field; never reinterpret a private chat as a group.
        if (msg?.type !== "text" || msg?.from_me === true) continue;
        const groupId = msg?.group_id, messageId = msg?.id, senderId = msg?.from, body = msg?.text?.body;
        if ([groupId, messageId, senderId, body].every(v => typeof v === "string") &&
            groupId.length > 0 && groupId.length <= 191 &&
            messageId.length > 0 && messageId.length <= 191 &&
            senderId.length > 0 && senderId.length <= 191 &&
            body.trim().length > 0 && body.length <= 1000) {
          out.push({ groupId, messageId, senderId, text: body });
        }
      }
    }
  }
  return out.slice(0, 100);
}

export async function sendGroupText(config: Config, groupId: string, text: string): Promise<string | null> {
  if (config.dryRun) return null;
  const response = await fetch(
    "https://graph.facebook.com/" + config.WHATSAPP_GRAPH_VERSION + "/" + config.WHATSAPP_PHONE_NUMBER_ID + "/messages",
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + config.WHATSAPP_ACCESS_TOKEN,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp", recipient_type: "group", to: groupId,
        type: "text", text: { preview_url: false, body: text }
      }),
      signal: AbortSignal.timeout(12000)
    }
  );
  if (!response.ok) throw new Error("WhatsApp Graph API HTTP " + response.status);
  const data = await response.json() as { messages?: { id?: string }[] };
  return data.messages?.[0]?.id || null;
}
