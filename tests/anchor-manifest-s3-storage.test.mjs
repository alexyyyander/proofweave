// tests/anchor-manifest-s3-storage.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import {
  buildCanonicalRequest,
  createS3ManifestStorage,
  s3SigningKey,
} from "../services/anchoring/anchor-manifest-s3-storage.mjs";
import { canonicalUtf8 } from "../packages/protocol/canonical-json.mjs";

test("SigV4 signing core is deterministic and follows the canonical form", () => {
  const canonical = buildCanonicalRequest({
    method: "PUT",
    path: "/bucket/anchors/sha256-abc",
    host: "account.r2.cloudflarestorage.com",
    payloadHash: "abc123",
    amzDate: "20261014T000000Z",
  });
  assert.equal(canonical, [
    "PUT",
    "/bucket/anchors/sha256-abc",
    "",
    "content-type:application/json",
    "host:account.r2.cloudflarestorage.com",
    "x-amz-content-sha256:abc123",
    "x-amz-date:20261014T000000Z",
    "",
    "content-type;host;x-amz-content-sha256;x-amz-date",
    "abc123",
  ].join("\n"));

  const key = s3SigningKey({ secret: "wJalr", date: "20261014", region: "auto", service: "s3" });
  const key2 = s3SigningKey({ secret: "wJalr", date: "20261014", region: "auto", service: "s3" });
  assert.equal(Buffer.from(key).toString("hex"), Buffer.from(key2).toString("hex"));
  assert.equal(key.byteLength, 32);
});

test("s3 manifest storage PUTs and GETs via SigV4 against a live local server", async () => {
  const seen = [];
  const stored = new Map();
  const server = createServer((request, response) => {
    let body = [];
    request.on("data", (chunk) => body.push(chunk));
    request.on("end", () => {
      const bytes = Buffer.concat(body);
      seen.push({
        method: request.method,
        url: request.url,
        host: request.headers.host,
        authorization: request.headers.authorization ?? "",
        amzDate: request.headers["x-amz-date"] ?? "",
        payloadSha: request.headers["x-amz-content-sha256"] ?? "",
      });
      if (request.method === "PUT") stored.set(request.url, bytes);
      response.statusCode = request.method === "GET" && !stored.has(request.url) ? 404 : 200;
      response.end(request.method === "GET" && stored.has(request.url) ? stored.get(request.url) : "");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const storage = createS3ManifestStorage({
    endpoint: `http://127.0.0.1:${port}`,
    bucket: "manifests",
    accessKeyId: "test-key",
    secretAccessKey: "test-secret",
    prefix: "anchors",
  });
  const manifest = {
    protocolVersion: "pw-anchor-manifest-v1", batchId: "b", root: `sha256:${"1".repeat(64)}`,
    leafCount: 0, prevBatchId: null, prevRoot: null, createdAt: "t", leaves: [],
  };
  const put = await storage.put(manifest);
  assert.match(put.key, /^anchors\/sha256:[a-f0-9]{64}$/);
  assert.equal(put.manifestHash, put.key.slice("anchors/".length));

  const roundTrip = await storage.get(put.key);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(roundTrip)), manifest);

  // SigV4 头形态
  assert.equal(seen[0].method, "PUT");
  assert.match(seen[0].url, /^\/manifests\/anchors\/sha256:[a-f0-9]{64}$/);
  assert.match(seen[0].authorization, /^AWS4-HMAC-SHA256 Credential=test-key\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/);
  assert.match(seen[0].amzDate, /^\d{8}T\d{6}Z$/);
  assert.equal(seen[0].payloadSha, await sha256Hex(canonicalUtf8(manifest))); // 哈希的是 canonical JSON 字节

  const missing = await storage.get("anchors/sha256:missing");
  assert.equal(missing, null);

  server.close();
});

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
