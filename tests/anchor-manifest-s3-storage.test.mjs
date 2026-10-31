// tests/anchor-manifest-s3-storage.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createHash, createHmac } from "node:crypto";
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

test("s3 manifest storage authenticates PUT and GET with an independent SigV4 verifier", async (t) => {
  const seen = [];
  const stored = new Map();
  const server = createServer((request, response) => {
    let body = [];
    request.on("data", (chunk) => body.push(chunk));
    request.on("end", () => {
      const bytes = Buffer.concat(body);
      if (!validSignature(request, bytes)) {
        response.writeHead(403).end("SignatureDoesNotMatch");
        return;
      }
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
  t.after(() => { server.closeAllConnections(); server.close(); });
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
  assert.match(seen[0].url, /^\/manifests\/anchors\/sha256%3A[a-f0-9]{64}$/);
  assert.match(seen[0].authorization, /^AWS4-HMAC-SHA256 Credential=test-key\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/);
  assert.match(seen[0].amzDate, /^\d{8}T\d{6}Z$/);
  assert.equal(seen[0].payloadSha, await sha256Hex(canonicalUtf8(manifest))); // 哈希的是 canonical JSON 字节

  const missing = await storage.get("anchors/sha256:missing");
  assert.equal(missing, null);

  const prefixed = createS3ManifestStorage({ endpoint: `http://127.0.0.1:${port}/api%20v1`, bucket: "manifests",
    accessKeyId: "test-key", secretAccessKey: "test-secret", prefix: "复杂 folder/100% !'()*" });
  const special = await prefixed.put(manifest);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(await prefixed.get(special.key))), manifest);
  assert.match(seen.at(-1).url, /^\/api%20v1\/manifests\/%E5%A4%8D%E6%9D%82%20folder\/100%25%20%21%27%28%29%2A\/sha256%3A/);
});

// Test server derives the signature from received bytes, without calling any
// production canonicalization or signing helper. URI encoding follows SigV4's
// byte-level unreserved set (including uppercase hexadecimal escapes).
function validSignature(request, body) {
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
  const headers = request.headers;
  const date = headers["x-amz-date"];
  const day = date.slice(0, 8);
  const path = request.url.split("/").map((segment) => [...Buffer.from(decodeURIComponent(segment))].map((byte) =>
    /[A-Za-z0-9_.~-]/.test(String.fromCharCode(byte)) ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`,
  ).join("")).join("/");
  const signed = "content-type;host;x-amz-content-sha256;x-amz-date";
  const payload = hash(body);
  const canonical = [request.method, path, "", `content-type:${headers["content-type"]}\nhost:${headers.host}\nx-amz-content-sha256:${payload}\nx-amz-date:${date}\n`, signed, payload].join("\n");
  const scope = `${day}/auto/s3/aws4_request`;
  const key = hmac(hmac(hmac(hmac("AWS4test-secret", day), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).digest("hex");
  return headers["x-amz-content-sha256"] === payload
    && headers.authorization === `AWS4-HMAC-SHA256 Credential=test-key/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("S3 PUT rejects HTTP failures instead of reporting a durable manifest", async (t) => {
  const storage = createS3ManifestStorage({ endpoint: "https://example.invalid", bucket: "test", accessKeyId: "test", secretAccessKey: "test" });
  const manifest = {
    protocolVersion: "pw-anchor-manifest-v1", batchId: "failure-test", root: `sha256:${"1".repeat(64)}`,
    leafCount: 0, prevBatchId: null, prevRoot: null, createdAt: "t", leaves: [],
  };
  let status = 403;
  t.mock.method(globalThis, "fetch", async () => new Response("not persisted", { status }));
  for (status of [403, 429, 500, 503]) {
    await assert.rejects(() => storage.put(manifest), new RegExp(`S3 PUT failed with status ${status}`));
  }
});
