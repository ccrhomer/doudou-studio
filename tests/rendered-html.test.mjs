import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("server-renders the finished bead studio", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>豆豆画室｜图片转拼豆图纸<\/title>/i);
  assert.match(html, /图片只在设备里处理/);
  assert.match(html, /选择一张图片/);
  assert.match(html, /先玩小草莓/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("keeps mobile editing safe and analytics optional", async () => {
  const [studio, css, rum, env] = await Promise.all([
    readFile(new URL("../app/BeadStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/TencentRum.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(studio, /InteractionMode = "view" \| "edit"/);
  assert.match(studio, /色块清晰/);
  assert.match(studio, /裁剪并突出主体/);
  assert.match(studio, /mobile-studio-nav/);
  assert.match(studio, /patternSourceRef/);
  assert.match(studio, /resizePattern\(source\.cells, source\.width, source\.height, nextWidth\)/);
  assert.doesNotMatch(studio, /resizePattern\(cells, gridWidth, gridHeight, nextWidth\)/);
  assert.match(css, /\.pattern-canvas\.view-only/);
  assert.match(css, /\.studio\.mobile-settings/);
  assert.match(rum, /reportApiSpeed: false/);
  assert.match(rum, /clickElementLog: false/);
  assert.match(env, /VITE_TENCENT_RUM_ID=/);
});
