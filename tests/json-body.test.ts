import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { parseRequestJson } from "../src/json-body.js";

test("empty JSON DELETE from cached portal is accepted without parsing failure", async () => {
  assert.equal(parseRequestJson("DELETE", Buffer.alloc(0)), undefined);
  const app = Fastify();
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    try { done(null, parseRequestJson(request.method, body as Buffer)); }
    catch (error) { done(error as Error, undefined); }
  });
  app.delete("/portal/api/connections/test", async () => ({ removed: true }));
  try {
    const response = await app.inject({
      method: "DELETE", url: "/portal/api/connections/test",
      headers: { "content-type": "application/json", "x-wbot-request": "1" }
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { removed: true });
  } finally {
    await app.close();
  }
});

test("JSON parser preserves valid bodies and raw bytes for webhook HMAC handling", () => {
  const bytes = Buffer.from('{"message":"ok","count":1}', "utf8");
  assert.deepEqual(parseRequestJson("POST", bytes), { message: "ok", count: 1 });
  assert.equal(bytes.toString("utf8"), '{"message":"ok","count":1}');
});

test("malformed and empty JSON POST are 400 client errors, not internal server errors", async () => {
  for (const value of ["", "{", "not-json"]) {
    assert.throws(
      () => parseRequestJson("POST", Buffer.from(value, "utf8")),
      (error: unknown) => {
        const failure = error as Error & { statusCode?: number };
        assert.equal(failure.statusCode, 400);
        assert.equal(failure.message, "Malformed JSON request body");
        return true;
      }
    );
  }
  const app = Fastify();
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    try { done(null, parseRequestJson(request.method, body as Buffer)); }
    catch (error) { done(error as Error, undefined); }
  });
  app.post("/portal/api/connections", async () => ({ created: true }));
  try {
    const response = await app.inject({
      method: "POST", url: "/portal/api/connections",
      headers: { "content-type": "application/json" }, payload: "{"
    });
    assert.equal(response.statusCode, 400);
  } finally { await app.close(); }
});
