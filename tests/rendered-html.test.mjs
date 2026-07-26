import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the Chess Stage entry experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Chess Stage — Jolin Li<\/title>/i);
  assert.match(html, /opening-sequence/);
  assert.match(html, /chess-stage-intro\.png/);
});

test("ships the physical light and chess state machine", async () => {
  const [experience, canvas, surface, compatibility, packageJson] = await Promise.all([
    readFile(new URL("../app/MorsLightExperience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/light/MorsLightCanvas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/light/MorsPageSurface.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/light/three-html-compatibility.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(experience, /dynamic\(/);
  assert.match(experience, /ssr: false/);
  assert.match(experience, /chess-stage-intro\.png/);
  assert.match(canvas, /new THREE\.HTMLTexture/);
  assert.match(canvas, /new GLTFLoader/);
  assert.match(canvas, /PIECE_DEFINITIONS/);
  assert.match(canvas, /function wakePiece/);
  assert.match(canvas, /function maybeAdvanceFormation/);
  assert.match(canvas, /function triggerFinale/);
  assert.match(canvas, /rippleAge/);
  assert.match(canvas, /id: "secret"/);
  assert.match(canvas, /secretLocked/);
  assert.match(canvas, /WHITE FORMATION/);
  assert.match(canvas, /BLACK FORMATION/);
  assert.match(canvas, /const fixedStep = 1 \/ 120/);
  assert.match(canvas, /event\.button === 2/);
  assert.match(canvas, /shouldCycleColor/);
  assert.match(canvas, /NEXT_PUBLIC_BASE_PATH/);
  assert.match(surface, /BEAM WIDTH/);
  assert.match(surface, /WAKE FORCE/);
  assert.match(surface, /RESET STAGE/);
  assert.match(surface, /DISCOVERY COMBO/);
  assert.match(compatibility, /function installThreeHtmlTextureCompatibility/);
  assert.match(packageJson, /"three-html-render"/);
});

test("includes the six featured GLBs and secret piece", async () => {
  const featured = [
    ["black", "king"], ["black", "queen"], ["white", "bishop"],
    ["white", "knight"], ["black", "rook"], ["white", "pawn"],
  ];
  for (const [side, kind] of featured) {
    await access(new URL(`../public/chess/${side}_${kind}.glb`, import.meta.url));
  }
  await access(new URL("../public/chess/black_bishop.glb", import.meta.url));
  await access(new URL("../public/chess-stage-intro.png", import.meta.url));
});
