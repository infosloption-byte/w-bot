import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword, verifyPassword, digest, sessionCookie, SESSION_COOKIE
} from "../src/portal-auth.js";

test("customer passwords use unique salted scrypt hashes", async () => {
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.equal(await verifyPassword("correct horse battery staple", first), true);
  assert.equal(await verifyPassword("incorrect password", first), false);
  assert.equal(await verifyPassword("correct horse battery staple", "broken"), false);
});

test("session cookie is HttpOnly, strict SameSite, scoped and Secure by default", () => {
  const cookie = sessionCookie("secret-token", true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/portal/);
  assert.match(cookie, /Secure/);
  assert.ok(cookie.startsWith(SESSION_COOKIE + "="));
  assert.doesNotMatch(sessionCookie("secret-token", false), /; Secure/);
  assert.match(sessionCookie("", true, 0), /Max-Age=0/);
});

test("session identifiers are never stored as plaintext", () => {
  assert.equal(digest("token").length, 64);
  assert.notEqual(digest("token"), digest("other-token"));
});
