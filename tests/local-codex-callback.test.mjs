import assert from "node:assert/strict";
import test from "node:test";
import { localCodexCallbackUri } from "../packages/protocol/local-codex-callback.mjs";

test("local pairing preserves the default and exact unprivileged loopback callback", () => {
  assert.equal(localCodexCallbackUri(), "http://127.0.0.1:44765/callback");
  for (const port of [1024, 44766, 65535]) {
    const uri = `http://127.0.0.1:${port}/callback`;
    assert.equal(localCodexCallbackUri(uri), uri);
  }
});

test("local pairing rejects redirects that leave or normalize beyond the narrow callback", () => {
  for (const uri of [
    "http://127.0.0.1:1023/callback", "http://127.0.0.1:65536/callback",
    "http://127.0.0.1:044765/callback", "http://localhost:44765/callback",
    "https://127.0.0.1:44765/callback", "http://[::1]:44765/callback",
    "http://127.1:44765/callback", "http://2130706433:44765/callback",
    "http://127.0.0.1:44765/callback?x=1", "http://127.0.0.1:44765/callback#x",
    "http://user@127.0.0.1:44765/callback", "http://127.0.0.1:44765/./callback",
    "http://127.0.0.1:44765/%63allback", "http://example.test:44765/callback",
    "http://127.0.0.1:44765/callback/", " http://127.0.0.1:44765/callback",
    "http://127.0.0.1:44765/callback\n", "", null, 44765,
  ]) assert.throws(() => localCodexCallbackUri(uri), /redirectUri/, String(uri));
});
