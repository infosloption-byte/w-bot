/**
 * Resolve the REAL WhatsApp sender phone number from authenticated Baileys
 * identity metadata. A @lid JID is NOT a telephone number.
 * Never infer a sender number from message text or a booking contact.
 */
export function phoneFromJid(jid) {
  if (typeof jid !== "string") return null;
  const match = /^([1-9][0-9]{7,14})(?::[0-9]+)?@s\.whatsapp\.net$/.exec(jid);
  return match ? "+" + match[1] : null;
}
function phoneFromVerifiedMetadata(value) {
  const jid = phoneFromJid(value);
  if (jid) return jid;
  // Explicit phoneNumber metadata may be a raw international number.
  return typeof value === "string" && /^\+?[1-9][0-9]{7,14}$/.test(value)
    ? "+" + value.replace(/^\+/, "") : null;
}
function normalizedJid(jid) {
  if (typeof jid !== "string") return null;
  const match = /^([0-9]+)(?::[0-9]+)?@(lid|s\.whatsapp\.net)$/.exec(jid);
  return match ? match[1] + "@" + match[2] : null;
}
export async function resolveSenderPhone(message, ownerJid, getMetadata) {
  const key = message?.key;
  if (!key) return null;
  if (key.fromMe === true) {
    // A connected account's own phone is available as its PN identity.
    return phoneFromJid(ownerJid) ||
      phoneFromJid(key.participantAlt) || phoneFromJid(key.participant);
  }
  // Baileys may include both PN and privacy-preserving LID identities.
  const direct = phoneFromJid(key.participantAlt) || phoneFromJid(key.participant);
  if (direct) return direct;
  const senderLids = new Set([key.participant, key.participantAlt]
    .map(normalizedJid).filter(value => value?.endsWith("@lid")));
  if (!senderLids.size || typeof getMetadata !== "function") return null;
  try {
    const metadata = await getMetadata(key.remoteJid);
    if (!Array.isArray(metadata?.participants)) return null;
    // Resolve only a participant whose LID matches the exact message sender.
    const matching = metadata.participants.filter(p =>
      senderLids.has(normalizedJid(p?.lid)) || senderLids.has(normalizedJid(p?.id)));
    const numbers = [...new Set(matching.map(p =>
      phoneFromVerifiedMetadata(p.phoneNumber) || phoneFromJid(p.id)).filter(Boolean))];
    return numbers.length === 1 ? numbers[0] : null;
  } catch {
    // WhatsApp may hide PN metadata. Never show LID digits as a phone.
    return null;
  }
}
