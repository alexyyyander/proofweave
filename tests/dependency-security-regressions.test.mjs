import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { z } from "zod";
import { imageSize } from "image-size";
import { createServer } from "node:http";
import { once } from "node:events";
import { Sandbox } from "e2b";
import { readFile } from "node:fs/promises";

test("Controller export uses the same reviewed SDK and Node range as the application", async () => {
  const [application, controller] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../deploy/huggingface-runner/package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(controller.dependencies.e2b, application.dependencies.e2b);
  assert.equal(controller.engines.node, application.engines.node);
});

test("Updated E2B SDK preserves private no-egress creation on the wire", async () => {
  let requestBody;
  const server = createServer(async (request, response) => {
    assert.equal(request.url, "/v2/sandboxes");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(201, { "content-type": "application/json" });
    response.end(JSON.stringify({ sandboxID: "local-sdk-fixture", templateID: "local-template", envdVersion: "0.3.0", envdAccessToken: "local-test-token", clientID: "local-client", domain: "localhost" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    await Sandbox.create("local-template:9420e83e-3c6d-48b8-94fe-a73807af5797", {
      apiKey: "local-fixture-key-no-provider-access",
      apiUrl: `http://127.0.0.1:${address.port}`,
      requestTimeoutMs: 2_000,
      timeoutMs: 60_000,
      secure: true,
      allowInternetAccess: false,
      network: { allowPublicTraffic: false, denyOut: ["0.0.0.0/0"] },
      lifecycle: { onTimeout: "kill" },
    });
    assert.equal(requestBody.allow_internet_access, false);
    assert.equal(requestBody.network.allowPublicTraffic, false);
    assert.deepEqual(requestBody.network.denyOut, ["0.0.0.0/0"]);
    assert.equal(requestBody.autoPause, false);
    assert.equal(requestBody.templateID, "local-template:9420e83e-3c6d-48b8-94fe-a73807af5797");
    assert.equal(requestBody.envVars, undefined);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("Zod rejects oversized collections before iterating attacker-controlled values", () => {
  const input = new Set(["first", "second"]);
  input[Symbol.iterator] = () => { throw new Error("Oversized collection must not be iterated."); };
  const result = z.set(z.string()).max(1).safeParse(input);
  assert.equal(result.success, false);
  assert.equal(result.error.issues[0].code, "too_big");
  assert.deepEqual(z.set(z.string()).max(1).parse(new Set(["ok"])), new Set(["ok"]));
});

test("Patched image parser rejects a zero-length ICNS chunk without looping", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { imageSize } from "image-size";
    const bytes = Buffer.alloc(16);
    bytes.write("icns", 0);
    bytes.writeUInt32BE(16, 4);
    bytes.write("ic07", 8);
    bytes.writeUInt32BE(0, 12);
    assert.throws(() => imageSize(bytes), /Invalid ICNS/);
  `], { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 2_000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

test("Patched image parser preserves ordinary PNG dimensions", () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nAAAAABJRU5ErkJggg==", "base64");
  const result = imageSize(png);
  assert.equal(result.width, 1);
  assert.equal(result.height, 1);
  assert.equal(result.type, "png");
});
