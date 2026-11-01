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

/**
 * Reconstitute only the text required by Baileys' quoted-message context.
 * The API provides the already persisted original message (not an arbitrary destination).
 */
export function buildQuotedMessage(groupId, reference) {
  if (!isGroupJid(groupId) || !reference || typeof reference !== "object") return null;
  const { messageId, senderId, text } = reference;
  if (typeof messageId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/.test(messageId) ||
      typeof senderId !== "string" || !/^[0-9][0-9:.-]*@(lid|s\.whatsapp\.net)$/.test(senderId) ||
      typeof text !== "string" || !text.trim() || text.length > 1000) {
    return null;
  }
  return {
    key: { id: messageId, remoteJid: groupId, participant: senderId, fromMe: false },
    message: { conversation: text }
  };
}
