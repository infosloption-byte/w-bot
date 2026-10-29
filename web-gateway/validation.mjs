// Country code required, digits only (WhatsApp pairing code input).
export const isPairingPhoneNumber = value =>
  typeof value === "string" && /^[1-9][0-9]{7,14}$/.test(value);

export const isGroupJid = id =>
  typeof id === "string" && /^[0-9][0-9-]{5,}@g\.us$/.test(id);

export function extractLiveMessage(msg, type) {
  if (type !== "notify" || !msg || msg.key?.fromMe === true) return null;
  const groupId = msg.key?.remoteJid;
  if (!isGroupJid(groupId)) return null;
  const messageId = msg.key?.id;
  const senderId = msg.key?.participant;
  const message = msg.message?.ephemeralMessage?.message ?? msg.message;
  const body = message?.conversation ?? message?.extendedTextMessage?.text;
  if (typeof messageId !== "string" || !messageId || messageId.length > 191 ||
      typeof senderId !== "string" || !senderId || senderId.length > 191 ||
      typeof body !== "string" || !body.trim() || body.length > 1000 ||
      body.startsWith("🌐 ")) return null;
  return { groupId, messageId, senderId, text: body };
}
