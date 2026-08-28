import assert from "node:assert/strict";
import test from "node:test";

const portalUrl = "https://edusense-cloud.ojasprm.workers.dev/portal";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the production EDUSENSE website", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<h1[^>]*>[\s\S]*?EDUSENSE AI[\s\S]*?<\/h1>/i);
  assert.match(html, /Have a device\? Use now/);
  assert.match(html, /Open your school portal/);
  assert.match(html, /Public site/);
  assert.match(html, /No live classroom data/);
});

test("links every device-login entry point to the secure cloud portal", async () => {
  const html = await (await render()).text();
  const escaped = portalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const links = html.match(new RegExp(`href=["']${escaped}["']`, "g")) ?? [];
  assert.ok(links.length >= 3, `expected at least three portal links, found ${links.length}`);
  assert.doesNotMatch(html, /192\.168\.1\.31|10\.42\.0\.1/);
});
