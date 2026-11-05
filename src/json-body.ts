/**
 * Preserve exact JSON bytes for WhatsApp webhook signature checks while
 * accepting an empty DELETE from previously deployed portal builds.
 * Malformed JSON is a 400 client error, never an unhandled 500.
 */
export function parseRequestJson(method: string, raw: Buffer): unknown {
  if (method === "DELETE" && raw.length === 0) return undefined;
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    const error = new SyntaxError("Malformed JSON request body") as SyntaxError & { statusCode: number };
    error.statusCode = 400;
    throw error;
  }
}
