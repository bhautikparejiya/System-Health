import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyGhlWebhook } from "../lib/webhook-verify.ts";

const body = JSON.stringify({ type: "ContactCreate", locationId: "x", timestamp: new Date().toISOString() });

test("rejects webhooks without a signature", () => {
  assert.equal(verifyGhlWebhook(body, new Headers()), false);
});

test("rejects forged Ed25519 and RSA signatures", () => {
  const fake = Buffer.alloc(64, 7).toString("base64");
  assert.equal(verifyGhlWebhook(body, new Headers({ "x-ghl-signature": fake })), false);
  assert.equal(verifyGhlWebhook(body, new Headers({ "x-wh-signature": "bm90LWEtc2lnbmF0dXJl" })), false);
});
