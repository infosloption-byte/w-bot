import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { isGroupJid, extractLiveMessage } from "./validation.mjs";

process.umask(0o077);
const token = process.env.WEB_GATEWAY_TOKEN || "";
const ingressUrl = process.env.API_INGRESS_URL || "http://api:9028/internal/web/message";
const directory = process.env.WEB_AUTH_DIR || "/data/auth";
const port = Number(process.env.PORT || "9029");
if (token.length < 32) throw new Error("WEB_GATEWAY_TOKEN must be at least 32 characters");
if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("Invalid port");

let socket = null;
let connected = false;
let reconnectCount = 0;
let manuallyLoggedOut = false;
let reconnectTimer = null;

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
    browser: Browsers.ubuntu("W-Bot Translator"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    printQRInTerminal: false
  });
  socket = ws;
  ws.ev.on("creds.update", saveCreds);
  ws.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
    if (ws !== socket) return; // ignore events from an older socket
    if (qr) {
      console.log("=== W-BOT LINKED-DEVICE QR (SECRET; DO NOT SHARE) ===");
      qrcode.generate(qr, { small: true });
      console.log("Scan on the dedicated WhatsApp phone: Linked devices > Link a device.");
    }
    if (connection === "open") {
      connected = true;
      reconnectCount = 0;
      console.log("W-Bot Web gateway connected.");
    }
    if (connection === "close") {
      connected = false;
      if (socket === ws) socket = null;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        manuallyLoggedOut = true;
        console.error("W-Bot Web gateway logged out; relink manually. Session files are kept.");
        return;
      }
      reconnectCount++;
      const delayMs = Math.min(60_000, 3000 * 2 ** Math.min(reconnectCount, 4));
      console.warn("Web gateway disconnected; scheduling reconnect.");
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
    return json(res, 200, { connected, loggedOut: manuallyLoggedOut });
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
