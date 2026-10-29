import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { isGroupJid, extractLiveMessage, isPairingPhoneNumber } from "./validation.mjs";

process.umask(0o077);
const token = process.env.WEB_GATEWAY_TOKEN || "";
const ingressUrl = process.env.API_INGRESS_URL || "http://api:9028/internal/web/message";
const directory = process.env.WEB_AUTH_DIR || "/data/auth";
const port = Number(process.env.PORT || "9029");
const pairingPhone = process.env.WEB_PAIRING_PHONE_NUMBER?.trim() || "";
if (token.length < 32) throw new Error("WEB_GATEWAY_TOKEN must be at least 32 characters");
if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("Invalid port");
if (pairingPhone && !isPairingPhoneNumber(pairingPhone)) {
  throw new Error("WEB_PAIRING_PHONE_NUMBER must include country code and 8-15 digits only, no + or spaces");
}

let socket = null;
let connected = false;
let reconnectCount = 0;
let manuallyLoggedOut = false;
let reconnectTimer = null;
let lastDisconnectCode = null;
let lastConnectionPhase = "starting";

function authorized(req) {
  const authorization = req.headers.authorization || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const a = Buffer.from(supplied), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function bodyJson(req) {
  let buffer = "";
  for await (const chunk of req) {
    buffer += chunk.toString("utf8");
    if (Buffer.byteLength(buffer) > 8_192) throw new Error("Request too large");
  }
  return JSON.parse(buffer);
}

async function ingress(msg) {
  // Bounded retry protects against short API restarts. It does not guarantee
  // durable inbound delivery if the process crashes; add a persistent spool later.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = await fetch(ingressUrl, {
        method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify(msg),
        signal: AbortSignal.timeout(10000)
      });
      if (result.ok) return;
      if (result.status === 401 || result.status === 400 || result.status === 403) {
        console.error("Web gateway ingress configuration rejected:", result.status);
        return;
      }
    } catch {
      // Retry after a temporary Docker network or API restart.
    }
    await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
  }
  console.error("Web gateway could not enqueue an incoming message after retries.");
}

async function connect() {
  if (manuallyLoggedOut) return;
  const { state, saveCreds } = await useMultiFileAuthState(directory);
  const ws = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    browser: Browsers.windows("Chrome"),
    markOnlineOnConnect: false,
    syncFullHistory: false
  });
  socket = ws;
  lastConnectionPhase = ws.authState.creds.registered ? "reconnecting" : "awaiting_pairing";
  let pairingRequested = false;
  ws.ev.on("creds.update", saveCreds);
  ws.ev.on("connection.update", ({ connection, qr, lastDisconnect, isNewLogin }) => {
    if (isNewLogin) console.log("WhatsApp pairing accepted; persisting credentials and reconnecting if requested.");
    if (ws !== socket) return; // ignore events from an older socket
    if (qr && pairingPhone && !ws.authState.creds.registered && !pairingRequested) {
      // Use phone-number pairing if Docker logs do not render QR graphics.
      // Baileys requires waiting until the socket emits its connection/QR event.
      pairingRequested = true;
      void ws.requestPairingCode(pairingPhone).then(code => {
        if (ws !== socket) return;
        console.log("=== W-BOT LINKED-DEVICE PAIRING CODE (PRIVATE) ===");
        console.log(code);
        console.log("On the dedicated WhatsApp phone: Linked devices > Link a device > Link with phone number instead.");
        console.log("Do not share this code or the logs. The pairing code expires.");
      }).catch(() => {
        pairingRequested = false;
        console.error("Could not request WhatsApp pairing code. Check number format, connectivity and retry after reconnect.");
      });
    } else if (qr && !pairingPhone) {
      console.log("=== W-BOT LINKED-DEVICE QR (SECRET; DO NOT SHARE) ===");
      qrcode.generate(qr, { small: true });
      console.log("Scan on the dedicated WhatsApp phone: Linked devices > Link a device.");
    }
    if (connection === "open") {
      connected = true;
      manuallyLoggedOut = false;
      lastDisconnectCode = null;
      lastConnectionPhase = "connected";
      reconnectCount = 0;
      console.log("W-Bot Web gateway connected.");
    }
    if (connection === "close") {
      connected = false;
      if (socket === ws) socket = null;
      const rawCode = lastDisconnect?.error?.output?.statusCode;
      const code = typeof rawCode === "number" ? rawCode : null;
      lastDisconnectCode = code;
      lastConnectionPhase = "disconnected";
      console.warn("W-Bot Web gateway disconnected", {
        code,
        authRegistered: Boolean(ws.authState?.creds?.registered)
      });
      if (code === DisconnectReason.loggedOut) {
        manuallyLoggedOut = true;
        lastConnectionPhase = "requires_repair";
        console.error("WhatsApp rejected/revoked the linked session (401). Stop the gateway, archive stale auth with the documented reset command, then request a new pairing code. Do not retry the rejected credentials.");
        return;
      }
      if (code === DisconnectReason.connectionReplaced) {
        lastConnectionPhase = "replaced";
        console.error("Session replaced by another Web client (440); stop duplicate connections before restarting.");
        return;
      }
      reconnectCount++;
      const delayMs = code === DisconnectReason.restartRequired
        ? 1500 : Math.min(60_000, 3000 * 2 ** Math.min(reconnectCount, 4));
      console.warn("Web gateway will retry connection", { code, delayMs });
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => { void connect().catch(() => console.error("Reconnect failed")); }, delayMs);
    }
  });
  ws.ev.on("messages.upsert", ({ messages, type }) => {
    for (const message of messages) {
      const incoming = extractLiveMessage(message, type);
      if (incoming) void ingress(incoming);
    }
  });
}

createServer(async (req, res) => {
  if (!authorized(req)) return json(res, 401, { error: "Unauthorized" });
  if (req.method === "GET" && req.url === "/status") {
    return json(res, 200, { connected, loggedOut: manuallyLoggedOut, disconnectCode: lastDisconnectCode, phase: lastConnectionPhase });
  }
  if (req.method === "GET" && req.url === "/groups") {
    if (!connected || !socket) return json(res, 503, { error: "Disconnected" });
    try {
      const groups = await socket.groupFetchAllParticipating();
      return json(res, 200, {
        groups: Object.values(groups).map(group => ({ groupId: group.id, name: group.subject }))
      });
    } catch { return json(res, 503, { error: "Group discovery failed" }); }
  }
  if (req.method !== "POST" || req.url !== "/send") return json(res, 404, { error: "Not found" });
  if (!connected || !socket) return json(res, 503, { error: "Disconnected" });
  try {
    const input = await bodyJson(req);
    if (!isGroupJid(input?.groupId) || typeof input?.text !== "string" ||
        !input.text.trim() || input.text.length > 3900) {
      return json(res, 400, { error: "Invalid message" });
    }
    const response = await socket.sendMessage(input.groupId, { text: input.text });
    if (!response?.key?.id) return json(res, 502, { error: "Send not acknowledged" });
    return json(res, 200, { messageId: response.key.id });
  } catch {
    return json(res, 502, { error: "Unable to send message" });
  }
}).listen(port, "0.0.0.0", () => {
  console.log("W-Bot Web gateway private HTTP service started on port", port);
});
void connect().catch(() => console.error("Initial Web gateway connection failed"));
