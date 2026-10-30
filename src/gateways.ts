import type { Config } from "./config.js";
import { sendGroupText } from "./whatsapp.js";
import { byonRequest } from "./byon-shared.js";

export type GatewayKind = "OFFICIAL" | "WEB";

export type QuoteReference = {
  messageId: string;
  senderId: string;
  text: string;
};

export class GatewayUnavailableError extends Error {
  constructor(public readonly gateway: GatewayKind, public readonly reason: string) {
    super(gateway + " gateway temporarily unavailable (" + reason + ")");
    this.name = "GatewayUnavailableError";
  }
}

export const isWebGroupId = (id: string): boolean =>
  /^[0-9][0-9-]{5,}@g\.us$/.test(id);

export function validateGroupDestination(gateway: GatewayKind, id: string): void {
  if (gateway === "WEB" && !isWebGroupId(id)) {
    throw new Error("Web group ID must be a valid @g.us JID");
  }
}

export async function sendGatewayText(config: Config, gateway: GatewayKind, groupId: string, text: string, quoted?: QuoteReference, connectionId?: string | null): Promise<string | null> {
  if (config.dryRun) return null;
  if (gateway === "OFFICIAL") {
    if (!config.WHATSAPP_ACCESS_TOKEN || !config.WHATSAPP_PHONE_NUMBER_ID) {
      throw new GatewayUnavailableError(gateway, "NOT_CONFIGURED");
    }
    return sendGroupText(config, groupId, text, quoted?.messageId);
  }
  validateGroupDestination(gateway, groupId);
  if (connectionId) {
    let response: Response;
    try {
      response = await byonRequest(config, "/connections/" + connectionId + "/send", "POST", {
        groupId, text, quoted
      });
    } catch { throw new GatewayUnavailableError("WEB", "CUSTOMER_CONNECTION_UNAVAILABLE"); }
    if (response.status === 503) throw new GatewayUnavailableError("WEB", "CUSTOMER_DISCONNECTED");
    if (!response.ok) throw new Error("Customer gateway send HTTP " + response.status);
    const body = await response.json() as { messageId?: string };
    if (!body.messageId) throw new Error("Customer gateway did not acknowledge send");
    return body.messageId;
  }
  if (!config.webEnabled || !config.WEB_GATEWAY_TOKEN) {
    throw new GatewayUnavailableError(gateway, "DISABLED");
  }

  let response: Response;
  try {
    response = await fetch(config.WEB_GATEWAY_URL + "/send", {
      method: "POST",
      headers: {
        authorization: "Bearer " + config.WEB_GATEWAY_TOKEN,
        "content-type": "application/json"
      },
      body: JSON.stringify({ groupId, text, quoted }),
      signal: AbortSignal.timeout(12000)
    });
  } catch {
    throw new GatewayUnavailableError("WEB", "CONNECTION_FAILED");
  }
  if (response.status === 503) throw new GatewayUnavailableError("WEB", "DISCONNECTED");
  if (!response.ok) throw new Error("Web gateway send HTTP " + response.status);
  const data = await response.json() as { messageId?: string };
  if (!data.messageId || typeof data.messageId !== "string") {
    throw new Error("Web gateway did not acknowledge send");
  }
  return data.messageId;
}
