import makeWASocket, {
  Browsers, DisconnectReason, useMultiFileAuthState
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { createServer } from "node:http";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { isGroupJid, extractLiveMessage, buildQuotedMessage, isVerifiedGroupAdmin,
  senderJidCandidates, parseActivationCommand } from "./validation.mjs";

process.umask(0o077);
const token = process.env.BYON_GATEWAY_TOKEN || "";
const authRoot = process.env.BYON_AUTH_DIR || "/data/auth";
const port = Number(process.env.PORT || 9039);
const apiOrigin = process.env.BYON_API_ORIGIN || "http://api:9028";
const maxSessions = Number(process.env.BYON_MAX_SESSIONS || 20);
if (token.length < 32) throw Error("BYON_GATEWAY_TOKEN must be at least 32 characters");
if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 100)
  throw Error("Invalid session capacity");
const idValid = id => typeof id === "string" && /^c[a-z0-9]{18,35}$/.test(id);
const phoneValid = number => typeof number === "string" && /^[1-9][0-9]{7,14}$/.test(number);
const sessions = new Map();
const wait = duration => new Promise(resolve => setTimeout(resolve, duration));

function auth(req) {
  const value = req.headers.authorization?.startsWith("Bearer ") ?
    req.headers.authorization.slice(7) : "";
  const a = Buffer.from(value), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
function respond(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json", "cache-control": "private, no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let raw = "";
  for await (const part of req) {
    raw += part.toString("utf8");
    if (Buffer.byteLength(raw) > 8192) throw Error("BODY_TOO_LARGE");
  }
  return raw ? JSON.parse(raw) : {};
}
async function report(id, status, phoneLast4) {
  try {
    await fetch(apiOrigin + "/internal/byon/state", {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ connectionId: id, status, ...(phoneLast4 ? { phoneLast4 } : {}) }),
      signal: AbortSignal.timeout(5000)
    });
  } catch { console.warn("BYON state delivery deferred"); }
}
async function post(path, payload) {
  for (let retry = 0; retry < 4; retry++) {
    try {
      const response = await fetch(apiOrigin + path, {
        method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(9000)
      });
      if (response.ok) return true;
      if ([400,401,403,404].includes(response.status)) return false;
    } catch { /* temporary API connection outage */ }
    await wait(400 * 2 ** retry);
  }
  console.warn("BYON message delivery to API failed");
  return false;
}
async function senderJids(ws, msg) {
  const ids = new Set(senderJidCandidates(msg));
  if (msg.key?.fromMe && ws.user?.id) {
    // Commands sent from another linked device of the customer's own account
    // may have fromMe=true. Only permit them if groupMetadata confirms admin.
    const own = ws.user.id;
    for (const jid of senderJidCandidates({ key: { participant: own } })) ids.add(jid);
    if (ws.user.lid) ids.add(ws.user.lid);
  }
  const mapping = ws.signalRepository?.lidMapping;
  if (mapping) for (const id of [...ids]) {
    try {
      const method = id.endsWith("@lid") ? mapping.getPNForLID : mapping.getLIDForPN;
      if (typeof method !== "function") continue;
      const alternate = await method.call(mapping, id);
      for (const jid of senderJidCandidates({ key: { participant: alternate } })) ids.add(jid);
    } catch { /* fail closed */ }
  }
  return [...ids];
}
async function activation(entry, msg, incoming, code) {
  try {
    if (!entry.connected || entry.stopped) return;
    const metadata = await entry.socket.groupMetadata(incoming.groupId);
    const ids = await senderJids(entry.socket, msg);
    if (!isVerifiedGroupAdmin(metadata.participants, ids)) {
      console.warn("BYON group activation denied: unverified administrator");
      return;
    }
    const accepted = await post("/internal/byon/activate", {
      connectionId: entry.id, groupId: incoming.groupId,
      groupName: String(metadata.subject || "WhatsApp Group").slice(0,191),
      code, adminVerified: true
    });
    try {
      await entry.socket.sendMessage(incoming.groupId, {
        text: accepted ? "✅ W-Bot translation activated for this group." :
          "⚠️ Activation could not be completed. Check the code and account settings."
      }, { quoted: msg });
    } catch { /* reply is optional */ }
  } catch { console.warn("BYON activation metadata check failed"); }
}
async function connect(id, phoneNumber) {
  if (!idValid(id)) throw Error("Invalid connection ID");
  const existing = sessions.get(id);
  if (existing && !existing.stopped) {
    if (existing.status === "PAIRING" && existing.qrUntil &&
        existing.qrUntil < Date.now()) {
      existing.stopped = true;
      try { existing.socket?.end?.(new Error("Expired pairing session")); } catch { /* noop */ }
      sessions.delete(id);
    } else {
      return existing;
    }
  }
  if (sessions.size >= maxSessions) throw Error("SESSION_CAPACITY_REACHED");
  const directory = join(authRoot, id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const { state, saveCreds } = await useMultiFileAuthState(directory);
  const entry = {
    id, socket: null, connected: false, status: "PAIRING",
    pairingCode: null, qrDataUrl: null, qrUntil: 0,
    phoneLast4: null, stopped: false, retry: 0, retryTimer: null,
    phoneNumber: phoneNumber || null, pairingRequested: false
  };
  sessions.set(id, entry);
  function attach() {
    if (entry.stopped) return;
    const ws = makeWASocket({
      auth: state, logger: pino({ level:"silent" }),
      browser: Browsers.windows("Chrome"),
      syncFullHistory: false, markOnlineOnConnect: false
    });
    entry.socket = ws;
    ws.ev.on("creds.update", saveCreds);
    ws.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
      if (entry.socket !== ws || entry.stopped) return;
      if (qr && !ws.authState.creds.registered) {
        entry.status = "PAIRING";
        entry.qrUntil = Date.now() + 60000;
        void QRCode.toDataURL(qr, { width: 250, margin: 1 }).then(data => {
          if (entry.socket === ws) entry.qrDataUrl = data;
        }).catch(() => { entry.qrDataUrl = null; });
        if (entry.phoneNumber && !entry.pairingRequested) {
          entry.pairingRequested = true;
          void ws.requestPairingCode(entry.phoneNumber).then(code => {
            if (entry.socket !== ws || entry.stopped) return;
            entry.pairingCode = code;
            entry.qrUntil = Date.now() + 60000;
          }).catch(() => { entry.pairingRequested = false; });
        }
      }
      if (connection === "open") {
        entry.connected = true; entry.retry = 0;
        entry.status = "CONNECTED";
        entry.pairingCode = null; entry.qrDataUrl = null; entry.phoneNumber = null;
        const number = ws.user?.id?.split("@")[0]?.split(":")[0];
        entry.phoneLast4 = /^[0-9]{8,15}$/.test(number ?? "") ? number.slice(-4) : null;
        void report(id, "CONNECTED", entry.phoneLast4);
        console.info("BYON session connected");
      }
      if (connection === "close") {
        entry.connected = false;
        entry.status = "DISCONNECTED";
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut || code === DisconnectReason.connectionReplaced) {
          entry.status = "REQUIRES_REPAIR";
          entry.stopped = true;
          void report(id, entry.status);
          sessions.delete(id);
          console.warn("BYON linked session requires repair");
          return;
        }
        void report(id, "DISCONNECTED");
        clearTimeout(entry.retryTimer);
        entry.retry++;
        entry.retryTimer = setTimeout(() => {
          if (entry.stopped) return;
          // Reopen with fresh on-disk credentials after any reconnect.
          entry.stopped = true;
          sessions.delete(id);
          void connect(id).catch(() => console.warn("BYON reconnect failed"));
        }, Math.min(60000, 1500 * 2 ** Math.min(entry.retry, 5)));
      }
    });
    ws.ev.on("messages.upsert", ({ messages, type }) => {
      if (entry.socket !== ws || entry.stopped || type !== "notify") return;
      for (const msg of messages) {
        // Never translate messages from the connected account itself.
        const incoming = extractLiveMessage(msg, type);
        if (incoming) {
          const code = parseActivationCommand(incoming.text);
          if (code) void activation(entry, msg, incoming, code);
          else void post("/internal/byon/message", { connectionId: id, ...incoming });
        } else if (msg?.key?.fromMe && isGroupJid(msg.key.remoteJid)) {
          // An activation command from the customer's other linked device is
          // accepted ONLY if current WhatsApp group-admin metadata verifies it.
          const text = msg.message?.conversation ??
            msg.message?.extendedTextMessage?.text ?? "";
          const code = parseActivationCommand(text);
          if (code && typeof msg.key.id === "string") {
            void activation(entry, msg, {
              groupId: msg.key.remoteJid, messageId: msg.key.id,
              senderId: ws.user?.id ?? "", text
            }, code);
          }
        }
      }
    });
  }
  attach();
  void report(id, "PAIRING");
  return entry;
}
async function revoke(id) {
  const entry = sessions.get(id);
  if (entry) {
    entry.stopped = true;
    clearTimeout(entry.retryTimer);
    sessions.delete(id);
    try { await entry.socket?.logout(); } catch { /* unlink may be offline */ }
    try { entry.socket?.end?.(new Error("Connection revoked")); } catch { /* noop */ }
  }
  // Delete ONLY this customer's dedicated auth dir, never shared W-Bot credentials.
  await rm(join(authRoot, id), { recursive: true, force: true });
}
const server = createServer(async (req, res) => {
  if (!auth(req)) return respond(res,401,{error:"Unauthorized"});
  try {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    const match = /^\/connections\/(c[a-z0-9]{18,35})\/(start|status|groups|send|revoke)$/.exec(pathname);
    if (!match) return respond(res,404,{error:"Not found"});
    const [,id,action] = match;
    if (req.method === "POST" && action === "start") {
      const input = await body(req);
      if (input.phoneNumber && !phoneValid(input.phoneNumber))
        return respond(res,400,{error:"Invalid pairing number"});
      await connect(id, input.phoneNumber);
      return respond(res,202,{started:true});
    }
    if (req.method === "POST" && action === "revoke") {
      await revoke(id);
      return respond(res,200,{revoked:true});
    }
    const entry = sessions.get(id);
    if (!entry || entry.stopped) return respond(res,503,{error:"Session unavailable"});
    if (req.method === "GET" && action === "status")
      return respond(res,200,{
        status:entry.status, phoneLast4:entry.phoneLast4,
        pairingCode:Date.now() < entry.qrUntil ? entry.pairingCode : null,
        qrDataUrl:Date.now() < entry.qrUntil ? entry.qrDataUrl : null
      });
    if (!entry.connected || !entry.socket) return respond(res,503,{error:"Not connected"});
    if (req.method === "GET" && action === "groups") {
      const participating = await entry.socket.groupFetchAllParticipating();
      return respond(res,200,{groups:Object.values(participating)
        .filter(g => isGroupJid(g.id))
        .map(g => ({ groupId:g.id,name:g.subject })).slice(0,200)});
    }
    if (req.method === "POST" && action === "send") {
      const input = await body(req);
      if (!isGroupJid(input.groupId) || typeof input.text !== "string" ||
          !input.text.trim() || input.text.length > 3900)
        return respond(res,400,{error:"Invalid outbound message"});
      // Only destinations this linked account has actually joined.
      await entry.socket.groupMetadata(input.groupId);
      const quoted = input.quoted === undefined ? undefined :
        buildQuotedMessage(input.groupId,input.quoted);
      if (input.quoted !== undefined && !quoted)
        return respond(res,400,{error:"Invalid quote"});
      const result = await entry.socket.sendMessage(input.groupId,{ text:input.text },
        quoted ? { quoted } : undefined);
      return result?.key?.id ?
        respond(res,200,{messageId:result.key.id}) :
        respond(res,502,{error:"Send unacknowledged"});
    }
    return respond(res,404,{error:"Not found"});
  } catch {
    return respond(res,503,{error:"Gateway operation unavailable"});
  }
});
server.listen(port,"0.0.0.0",() => console.info("W-Bot isolated customer gateway ready"));
async function synchronize() {
  let allowed;
  try {
    const response = await fetch(apiOrigin + "/internal/byon/bootstrap", {
      headers:{authorization:"Bearer "+token},signal:AbortSignal.timeout(6000)
    });
    if (!response.ok) return;
    const data = await response.json();
    allowed = new Set((data.connectionIds || []).filter(idValid).slice(0,maxSessions));
  } catch {
    console.warn("BYON session policy sync temporarily unavailable");
    return;
  }
  for (const [id, entry] of sessions) {
    if (allowed.has(id)) continue;
    // Pause disabled model types or master switch without deleting credentials;
    // re-enable resumes the linked device without demanding another QR scan.
    entry.stopped = true;
    clearTimeout(entry.retryTimer);
    sessions.delete(id);
    try { entry.socket?.end?.(new Error("Session paused by policy")); } catch { /* noop */ }
    void report(id, "DISCONNECTED");
  }
  for (const id of allowed) {
    if (!sessions.has(id) && sessions.size < maxSessions) {
      void connect(id).catch(() => console.warn("BYON resume failed"));
    }
  }
}
void synchronize();
const syncTimer = setInterval(() => { void synchronize(); }, 60_000);
syncTimer.unref();
