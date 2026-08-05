import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "bitedle-biteball-discord-"));
process.env.NODE_ENV = "test";
delete process.env.BITEDLE_BITEBALL_FINAL_EDIT_DELAY_MS;

const sharp = require("sharp");
const { BITEBALL_ANSWERS } = require(path.join(repoRoot, "src", "lib", "biteball.ts"));
const renderer = require(
  path.join(repoRoot, "src", "lib", "biteball-discord-renderer.tsx"),
);
const delivery = require(path.join(repoRoot, "src", "lib", "biteball-discord.ts"));

const question = "Will @everyone approve *this* Biteball animation today?";
const answer = BITEBALL_ANSWERS.find(
  (candidate) => candidate.text === "Concentrate and ask again",
);
assert.ok(answer);

const assets = await renderer.renderBiteballDiscordAssets(question, answer);
assert.equal(assets.animation.subarray(0, 6).toString("ascii"), "GIF89a");
assert.deepEqual([...assets.still.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.equal(assets.durationMs, renderer.BITEBALL_DISCORD_ANIMATION_MS);
assert.ok(assets.durationMs >= 4_000, "Biteball reveal should run for at least four seconds");

const gifMetadata = await sharp(assets.animation, { animated: true }).metadata();
assert.ok((gifMetadata.pages ?? 0) > 1, "Biteball GIF must contain multiple frames");
assert.equal(gifMetadata.width, renderer.BITEBALL_DISCORD_WIDTH);
assert.equal(gifMetadata.pageHeight, renderer.BITEBALL_DISCORD_HEIGHT);
assert.equal(
  gifMetadata.delay.reduce((total, delay) => total + delay, 0),
  renderer.BITEBALL_DISCORD_ANIMATION_MS,
);
const pngMetadata = await sharp(assets.still).metadata();
assert.deepEqual(
  { format: pngMetadata.format, width: pngMetadata.width, height: pngMetadata.height },
  {
    format: "png",
    width: renderer.BITEBALL_DISCORD_WIDTH,
    height: renderer.BITEBALL_DISCORD_HEIGHT,
  },
);

const gifPath = path.join(outputDir, renderer.BITEBALL_DISCORD_GIF_FILENAME);
const pngPath = path.join(outputDir, renderer.BITEBALL_DISCORD_PNG_FILENAME);
const firstFramePath = path.join(outputDir, "biteball-first-frame.png");
const clippingCheckPath = path.join(outputDir, "biteball-clipping-check.png");
fs.writeFileSync(gifPath, assets.animation);
fs.writeFileSync(pngPath, assets.still);
await sharp(assets.animation, { page: 0 }).png().toFile(firstFramePath);
const clippingCheckAnswer = BITEBALL_ANSWERS.find(
  (candidate) => candidate.text === "Outlook not so good",
);
assert.ok(clippingCheckAnswer);
const clippingCheck = await renderer.renderBiteballDiscordStill(
  "Is it going to rain in NYC tonight?",
  clippingCheckAnswer,
);
fs.writeFileSync(clippingCheckPath, clippingCheck);
const clippingCheckMetadata = await sharp(clippingCheck).metadata();
assert.deepEqual(
  { width: clippingCheckMetadata.width, height: clippingCheckMetadata.height },
  { width: renderer.BITEBALL_DISCORD_WIDTH, height: renderer.BITEBALL_DISCORD_HEIGHT },
);

const requests = [];
const server = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    requests.push({
      method: request.method,
      url: request.url,
      contentType: request.headers["content-type"] ?? "",
      body: Buffer.concat(chunks),
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "original-interaction-message" }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
process.env.BITEDLE_DISCORD_API_BASE_URL = `http://127.0.0.1:${address.port}`;

function multipartPayload(request) {
  const boundaryMatch = /boundary=(.+)$/i.exec(request.contentType);
  assert.ok(boundaryMatch, "multipart request must include a boundary");
  const body = request.body.toString("utf8");
  const nameIndex = body.indexOf('name="payload_json"');
  assert.notEqual(nameIndex, -1);
  const valueStart = body.indexOf("\r\n\r\n", nameIndex) + 4;
  const valueEnd = body.indexOf(`\r\n--${boundaryMatch[1]}`, valueStart);
  assert.ok(valueStart > 3 && valueEnd > valueStart);
  return JSON.parse(body.slice(valueStart, valueEnd));
}

const sleeps = [];
await delivery.deliverBiteballResponse({
  applicationId: "500000000000000001",
  token: "biteball-test-token",
  question,
  answer,
  attachmentSizeLimit: 8 * 1024 * 1024,
  sleep: async (milliseconds) => {
    sleeps.push(milliseconds);
  },
});

assert.equal(requests.length, 2, "delivery must edit one message twice");
assert.deepEqual(requests.map((request) => request.method), ["PATCH", "PATCH"]);
assert.equal(requests[0].url, requests[1].url);
assert.equal(
  requests[0].url,
  "/webhooks/500000000000000001/biteball-test-token/messages/@original",
);
assert.equal(requests.some((request) => request.method === "POST"), false);
assert.equal(sleeps.length, 1);
assert.equal(
  sleeps[0],
  renderer.BITEBALL_DISCORD_ANIMATION_MS + 180,
  "the still must replace the GIF only after its one-shot timeline",
);

const animationPayload = multipartPayload(requests[0]);
const finalPayload = multipartPayload(requests[1]);
assert.deepEqual(animationPayload.allowed_mentions, { parse: [] });
assert.deepEqual(finalPayload.allowed_mentions, { parse: [] });
assert.deepEqual(animationPayload.components, []);
assert.deepEqual(finalPayload.components, []);
assert.equal(animationPayload.attachments.length, 1);
assert.equal(animationPayload.attachments[0].filename, "biteball-reveal.gif");
assert.equal(finalPayload.attachments.length, 1);
assert.equal(finalPayload.attachments[0].filename, "biteball-answer.png");
assert.equal(animationPayload.content.includes(answer.text), false);
assert.equal(finalPayload.content.includes(answer.text), true);
assert.equal(animationPayload.content.includes("@everyone"), false);
assert.equal(finalPayload.content.includes("@everyone"), false);
assert.equal(requests[0].body.includes(Buffer.from("GIF89a")), true);
assert.equal(requests[1].body.includes(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), true);

requests.length = 0;
sleeps.length = 0;
await delivery.deliverBiteballResponse({
  applicationId: "500000000000000001",
  token: "small-limit-token",
  question: "Will the text fallback work?",
  answer,
  attachmentSizeLimit: 1,
  sleep: async (milliseconds) => {
    sleeps.push(milliseconds);
  },
});
assert.equal(requests.length, 1);
assert.match(requests[0].contentType, /^application\/json/);
const fallbackPayload = JSON.parse(requests[0].body.toString("utf8"));
assert.equal(fallbackPayload.content.includes(answer.text), true);
assert.deepEqual(fallbackPayload.allowed_mentions, { parse: [] });
assert.deepEqual(fallbackPayload.components, []);
assert.deepEqual(fallbackPayload.attachments, []);
assert.deepEqual(sleeps, []);

await new Promise((resolve, reject) =>
  server.close((error) => (error ? reject(error) : resolve())),
);

const commandSource = fs.readFileSync(
  path.join(repoRoot, "scripts", "register-discord-commands.mjs"),
  "utf8",
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "api", "discord", "interactions", "route.ts"),
  "utf8",
);
assert.match(commandSource, /name: "biteball"[\s\S]*?type: 1/);
assert.match(commandSource, /name: "question"[\s\S]*?required: true[\s\S]*?max_length: 200/);
assert.doesNotMatch(commandSource, /name: "biteball"[\s\S]*?type: 4/);
assert.match(routeSource, /body\?\.data\?\.name === "biteball"/);
assert.match(routeSource, /return handleBiteball\(body\)/);
assert.match(routeSource, /body\.data\?\.name !== "biteball"/);
const handlerSource = routeSource.slice(
  routeSource.indexOf("function handleBiteball"),
  routeSource.indexOf("export async function POST"),
);
assert.match(handlerSource, /NextResponse\.json\(\{ type: 5 \}\)/);
assert.doesNotMatch(handlerSource, /type: 12|launchActivity|custom_id|recordIntent|getStore/);

console.log("Biteball Discord verification passed.");
console.log(`Rendered GIF: ${gifPath}`);
console.log(`Rendered first frame: ${firstFramePath}`);
console.log(`Rendered final still: ${pngPath}`);
console.log(`Rendered clipping check: ${clippingCheckPath}`);
