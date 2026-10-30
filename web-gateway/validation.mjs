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

/**
 * Fail closed on identities we cannot match. Baileys group metadata may expose
 * both phone-number and LID JIDs depending on WhatsApp rollout.
 */
// Match identities from the authenticated WhatsApp message key against fresh
// group metadata; never treat a user-supplied number or command text as identity.
// Baileys may represent the same sender by a PN JID or an LID JID.
export function senderJidCandidates(message) {
  const key = message?.key;
  const values = [key?.participant, key?.participantAlt];
  return [...new Set(values.filter(value => typeof value === "string"
    && /^[0-9][0-9:.-]*@(lid|s\.whatsapp\.net)$/.test(value)))];
}

function normalizedJid(value) {
  if (typeof value !== "string") return null;
  const match = /^([0-9]+)(?::[0-9]+)?@(lid|s\.whatsapp\.net)$/.exec(value);
  return match ? match[1] + "@" + match[2] : null;
}

export function isVerifiedGroupAdmin(participants, senderJids) {
  if (!Array.isArray(participants)) return false;
  const list = typeof senderJids === "string" ? [senderJids] : senderJids;
  if (!Array.isArray(list)) return false;
  const candidates = new Set(list.map(normalizedJid).filter(Boolean));
  if (!candidates.size) return false;
  return participants.some(participant => {
    const isAdmin = participant && (
      participant.admin === "admin" || participant.admin === "superadmin" ||
      participant.isAdmin === true || participant.isSuperAdmin === true
    );
    return Boolean(isAdmin && [participant.id, participant.lid, participant.phoneNumber]
      .map(normalizedJid).some(jid => jid && candidates.has(jid)));
  });
}

export function parseActivationCommand(text) {
  if (typeof text !== "string") return null;
  const match = /^\/wbot\s+connect\s+([A-Fa-f0-9]{16})\s*$/i.exec(text.trim());
  return match ? match[1].toUpperCase() : null;
}
