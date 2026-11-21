import http from "node:http";
import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

const port = Number(process.env.PORT || 3001);
const apiKey = required("LIVEKIT_API_KEY");
const apiSecret = required("LIVEKIT_API_SECRET");
const streamKey = required("LIVE_STREAM_KEY");
if (apiSecret.length < 32)
  throw new Error("LIVEKIT_API_SECRET must contain at least 32 characters");
if (streamKey.length < 24)
  throw new Error("LIVE_STREAM_KEY must contain at least 24 characters");
const internalUrl = process.env.LIVEKIT_INTERNAL_URL || "http://127.0.0.1:7880";
const publicUrl = required("LIVEKIT_PUBLIC_URL");
const roomName = process.env.LIVEKIT_ROOM || "atomedu-live";
const statePath = process.env.LIVE_STATE_PATH || "/data/live-state.json";
const allowed = new Set(
  (
    process.env.ALLOWED_ORIGINS ||
    "https://atom-edu.org,http://localhost:4173,http://127.0.0.1:4173"
  )
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean),
);
const rooms = new RoomServiceClient(internalUrl, apiKey, apiSecret);
const limits = new Map();
let state = await loadState();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function originHeaders(request) {
  const origin = request.headers.origin || "";
  return origin && allowed.has(origin)
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "Content-Type, X-Stream-Key",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        Vary: "Origin",
      }
    : {};
}
function send(response, status, data, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(data));
}
async function readJson(request) {
  let value = "";
  for await (const chunk of request) {
    value += chunk;
    if (value.length > 20000) throw new Error("Request too large");
  }
  return value ? JSON.parse(value) : {};
}
function rateLimited(request) {
  const remote = request.socket.remoteAddress || "unknown";
  const forwarded = String(request.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  const key =
    forwarded && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)
      ? forwarded
      : remote;
  const now = Date.now();
  if (limits.size > 10000) {
    for (const [address, entry] of limits)
      if (now - entry.start > 60000) limits.delete(address);
  }
  const item = limits.get(key) || { start: now, count: 0 };
  if (now - item.start > 60000) {
    item.start = now;
    item.count = 0;
  }
  item.count++;
  limits.set(key, item);
  return item.count > 90;
}
async function loadState() {
  try {
    const saved = JSON.parse(await readFile(statePath, "utf8"));
    return {
      title: String(saved.title || "atomEDU Live").slice(0, 120),
      viewerOverride: Number.isInteger(saved.viewerOverride)
        ? saved.viewerOverride
        : null,
    };
  } catch {
    return { title: "atomEDU Live", viewerOverride: null };
  }
}
async function saveState() {
  await mkdir(dirname(statePath), { recursive: true });
  const temp = `${statePath}.tmp`;
  await writeFile(temp, JSON.stringify(state));
  await rename(temp, statePath);
}
function roomMetadata() {
  return JSON.stringify(state);
}
async function ensureRoom() {
  try {
    await rooms.createRoom({
      name: roomName,
      emptyTimeout: 3600,
      maxParticipants: 3000,
      metadata: roomMetadata(),
    });
  } catch (error) {
    if (!/already exists/i.test(String(error))) throw error;
  }
}
async function syncMetadata() {
  await ensureRoom();
  await rooms.updateRoomMetadata(roomName, roomMetadata());
}
async function participants() {
  try {
    return await rooms.listParticipants(roomName);
  } catch {
    return [];
  }
}
async function token(role) {
  await ensureRoom();
  const host = role === "host";
  const identity = host ? "atomedu-host" : `viewer-${crypto.randomUUID()}`;
  const access = new AccessToken(apiKey, apiSecret, {
    identity,
    name: host ? "atomEDU Studio" : "Viewer",
    ttl: host ? "12h" : "4h",
  });
  access.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: host,
    canSubscribe: !host,
    canPublishData: host,
    roomAdmin: host,
  });
  return await access.toJwt();
}

const server = http.createServer(async (request, response) => {
  const headers = originHeaders(request);
  if (request.method === "OPTIONS") return send(response, 204, {}, headers);
  if (request.headers.origin && !Object.keys(headers).length)
    return send(response, 403, { error: "Origin not allowed" });
  if (rateLimited(request))
    return send(response, 429, { error: "Too many requests" }, headers);
  const url = new URL(request.url, "http://localhost");
  try {
    if (url.pathname === "/health")
      return send(
        response,
        200,
        { ok: true, service: "atomedu-live" },
        headers,
      );
    if (url.pathname === "/api/status" && request.method === "GET") {
      const list = await participants();
      return send(
        response,
        200,
        {
          ...state,
          live: list.some(
            (p) => p.identity === "atomedu-host" && p.tracks?.length,
          ),
          viewers: list.filter((p) => p.identity !== "atomedu-host").length,
        },
        headers,
      );
    }
    if (url.pathname === "/api/token" && request.method === "POST") {
      const body = await readJson(request);
      const role = body.role === "host" ? "host" : "viewer";
      if (
        role === "host" &&
        !safeEqual(request.headers["x-stream-key"] || "", streamKey)
      )
        return send(response, 403, { error: "Incorrect stream key" }, headers);
      return send(
        response,
        200,
        { token: await token(role), serverUrl: publicUrl, roomName },
        headers,
      );
    }
    if (url.pathname === "/api/metadata" && request.method === "POST") {
      if (!safeEqual(request.headers["x-stream-key"] || "", streamKey))
        return send(response, 403, { error: "Incorrect stream key" }, headers);
      const body = await readJson(request);
      state.title =
        String(body.title || state.title || "atomEDU Live")
          .trim()
          .slice(0, 120) || "atomEDU Live";
      if (Object.hasOwn(body, "viewerOverride"))
        state.viewerOverride = Number.isInteger(body.viewerOverride)
          ? Math.max(0, Math.min(1000000, body.viewerOverride))
          : null;
      await saveState();
      await syncMetadata();
      return send(response, 200, state, headers);
    }
    return send(response, 404, { error: "Not found" }, headers);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "live_service_error",
        path: url.pathname,
        message: String(error),
      }),
    );
    const clientError =
      error instanceof SyntaxError || /Request too large/.test(String(error));
    return send(response, clientError ? 400 : 503, {
      error: clientError ? "Invalid request" : "Live service unavailable",
    }, headers);
  }
});
server.listen(port, "0.0.0.0", () =>
  console.log(JSON.stringify({ event: "live_service_ready", port, roomName })),
);
