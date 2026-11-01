import { extractLiveMessage, isGroupJid } from "./validation.mjs";

const participantJid = value =>
  typeof value === "string" && /^[0-9][0-9:.-]*@(lid|s\.whatsapp\.net)$/.test(value);
const unwrap = message => message?.ephemeralMessage?.message ??
  message?.viewOnceMessage?.message ?? message?.viewOnceMessageV2?.message ?? message;
const getText = message => {
  const content = unwrap(message);
  return content?.conversation ?? content?.extendedTextMessage?.text;
};
// The bot emits translations and activation confirmations from the same account.
// Filter them even when a delayed echo arrives after the in-memory ID cache expires.
export const isBotText = text =>
  text.startsWith("🌐 ") || text.startsWith("✅ W-Bot ") || text.startsWith("⚠️ W-Bot ") ||
  text.startsWith("⚠️ Activation could not be completed.");

export function extractByonLiveMessage(message, type, ownerJid, recentOutboundIds = new Set()) {
  if (!isGroupJid(message?.key?.remoteJid)) return null;
  // Baileys may deliver human messages sent on the linked phone as
  // type="append" rather than "notify". Only accept a very recent outgoing
  // human message, never historical sync (which may replay entire chats).
  if (type !== "notify") {
    if (type !== "append" || message?.key?.fromMe !== true) return null;
    const raw = message?.messageTimestamp;
    const timestamp = typeof raw === "number" ? raw :
      typeof raw === "bigint" ? Number(raw) :
      raw && typeof raw.toNumber === "function" ? raw.toNumber() :
      raw && typeof raw.low === "number" ? raw.low : NaN;
    const age = Date.now() - timestamp * 1000;
    if (!Number.isFinite(age) || age < -30000 || age > 120000) return null;
  }
  const id = message.key?.id;
  if (typeof id !== "string" || !id || id.length > 191 || recentOutboundIds.has(id)) return null;
  if (message.key?.fromMe !== true) return extractLiveMessage(message, type);
  const text = getText(message.message);
  if (typeof text !== "string" || !text.trim() || text.length > 1000 || isBotText(text)) return null;
  const senderId = participantJid(message.key.participant) ? message.key.participant :
    participantJid(message.key.participantAlt) ? message.key.participantAlt : ownerJid;
  if (!participantJid(senderId) || senderId.length > 191) return null;
  return { groupId: message.key.remoteJid, messageId: id, senderId, text };
}
