import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { providers } from "tronweb";

async function fixture(t, handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test("TronWeb preserves JSON RPC requests with the patched Axios dependency", async t => {
  let received;
  const origin = await fixture(t, async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = { method: request.method, url: request.url, body: JSON.parse(Buffer.concat(chunks)) };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ block_header: { raw_data: { number: 123 } } }));
  });
  const provider = new providers.HttpProvider(origin, 2_000);
  assert.deepEqual(await provider.request("wallet/getnowblock", { visible: true }, "post"), {
    block_header: { raw_data: { number: 123 } },
  });
  assert.deepEqual(received, { method: "POST", url: "/wallet/getnowblock", body: { visible: true } });
});

test("Patched TronWeb Axios fetch adapter honors disabled redirects", async t => {
  let redirectedRequests = 0;
  const origin = await fixture(t, (request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/must-not-be-fetched" });
    } else {
      redirectedRequests += 1;
      response.writeHead(200);
    }
    response.end();
  });
  const provider = new providers.HttpProvider(origin, 2_000);
  const response = await provider.instance.request({
    url: "/redirect", adapter: "fetch", maxRedirects: 0,
    validateStatus: status => status === 302,
  });
  assert.equal(response.status, 302);
  assert.equal(redirectedRequests, 0);
});
