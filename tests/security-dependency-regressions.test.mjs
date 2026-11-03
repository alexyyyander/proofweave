import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { z } from "zod";

const root = fileURLToPath(new URL("../", import.meta.url));

// Isolate process-crash regressions and bind servers only to loopback.
// These probes never use a provider API or production credentials.
function assertProbeSurvives(source) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: root, encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.signal ?? ""}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /probe survived/);
}

test("body-parser survives compressed trailing bytes and still parses the next request", () => {
  assertProbeSurvives(`
    import assert from "node:assert/strict";
    import http from "node:http";
    import { createRequire } from "node:module";
    import { gzipSync } from "node:zlib";
    const require = createRequire(process.cwd() + "/package.json");
    const expressRequire = createRequire(require.resolve("express"));
    const parser = expressRequire("body-parser").json();
    const server = http.createServer((req, res) => parser(req, res, error => {
      res.statusCode = error ? 400 : 200;
      res.end(error ? "invalid body" : JSON.stringify(req.body));
    }));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    async function post(body, encoding) {
      return new Promise((resolve, reject) => {
        const req = http.request({ hostname: "127.0.0.1", port: server.address().port,
          method: "POST", agent: false, headers: { "content-type": "application/json",
            "content-length": body.length, ...(encoding ? { "content-encoding": encoding } : {}) },
        }, res => {
          let text = "";
          res.setEncoding("utf8").on("data", chunk => { text += chunk; });
          res.on("end", () => resolve({ status: res.statusCode, text }));
          res.on("error", reject);
        });
        req.on("error", reject);
        req.end(body);
      });
    }
    try {
      const malformed = Buffer.concat([gzipSync('{"probe":true}'), Buffer.from([0]), Buffer.alloc(96 * 1024, 90)]);
      const response = await post(malformed, "gzip");
      assert.deepEqual(response, { status: 200, text: '{"probe":true}' });
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.deepEqual(await post(Buffer.from('{"alive":true}')), { status: 200, text: '{"alive":true}' });
      console.log("probe survived");
    } finally { await new Promise(resolve => server.close(resolve)); }
  `);
});

for (const packageName of ["undici", "undici8"]) {
  test(`${packageName} rejects an excessive encoding chain without an unhandled stream error`, () => {
    assertProbeSurvives(`
      import assert from "node:assert/strict";
      import net from "node:net";
      import { createRequire } from "node:module";
      const require = createRequire(process.cwd() + "/package.json");
      const { fetch, Agent } = require(${JSON.stringify(packageName)});
      const agent = new Agent({ connections: 1 });
      const sockets = new Set();
      const server = net.createServer(socket => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => {});
        socket.once("data", request => {
          if (request.toString().startsWith("GET /bad ")) {
            socket.end("HTTP/1.1 200 OK\\r\\nContent-Encoding: gzip, gzip, gzip, gzip, gzip, gzip\\r\\nContent-Length: 100\\r\\nConnection: close\\r\\n\\r\\n");
          } else {
            socket.end("HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\nConnection: close\\r\\n\\r\\nok");
          }
        });
      });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const origin = "http://127.0.0.1:" + server.address().port;
      try {
        await assert.rejects(fetch(origin + "/bad", { dispatcher: agent }), TypeError);
        await new Promise(resolve => setTimeout(resolve, 50));
        const response = await fetch(origin + "/healthy", { dispatcher: agent });
        assert.equal(await response.text(), "ok");
        console.log("probe survived");
      } finally {
        await agent.close();
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
      }
    `);
  });
}

test("Zod rejects oversized bounded collections before visiting elements", async () => {
  let visited = 0;
  const element = z.preprocess(value => { visited++; return value; }, z.string());
  const entries = Array.from({ length: 2048 }, (_, index) => `item-${index}`);
  for (const [schema, oversized, valid] of [
    [z.array(element).max(2), entries, ["a", "b"]],
    [z.set(element).max(2), new Set(entries), new Set(["a", "b"])],
    [z.map(element, element).max(2), new Map(entries.map(value => [value, value])), new Map([["a", "b"]])],
  ]) {
    for (const parse of [value => schema.safeParse(value), value => schema.safeParseAsync(value)]) {
      visited = 0;
      const result = await parse(oversized);
      assert.equal(result.success, false);
      assert.equal(result.error.issues.length, 1);
      assert.equal(result.error.issues[0].code, "too_big");
      assert.equal(visited, 0, "size checks must run before element validation");
      assert.equal((await parse(valid)).success, true);
      assert.ok(visited > 0, "within-bound values must still be validated");
    }
  }
});
