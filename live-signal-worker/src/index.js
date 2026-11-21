import { DurableObject } from "cloudflare:workers";

const ROOM_NAME = "atomedu-live";
const MAX_VIEWERS = 50;
const MAX_MESSAGE = 96_000;

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function sameSecret(provided, expected) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(left, right);
}

function cors(origin, allowed) {
  const valid =
    origin === allowed ||
    /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
  return valid
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "Content-Type, X-Stream-Key",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      }
    : {};
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export class LiveRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          title TEXT NOT NULL,
          override_count INTEGER,
          live INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO room_state (id, title, override_count, live)
        VALUES (1, 'atomEDU Live', NULL, 0);
        CREATE TABLE IF NOT EXISTS host_tickets (
          token TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL
        );
      `);
    });
  }

  state() {
    const row = this.ctx.storage.sql
      .exec("SELECT title, override_count, live FROM room_state WHERE id = 1")
      .one();
    const viewers = this.sockets("viewer").length;
    return {
      type: "state",
      title: row.title,
      viewerOverride: row.override_count,
      viewers,
      displayViewers: Number.isInteger(row.override_count)
        ? row.override_count
        : viewers,
      live: Boolean(row.live) && this.sockets("host").length > 0,
    };
  }

  sockets(role) {
    return this.ctx
      .getWebSockets()
      .filter(
        (socket) =>
          socket.readyState === WebSocket.OPEN &&
          socket.deserializeAttachment()?.role === role,
      );
  }

  send(socket, value) {
    try {
      socket.send(JSON.stringify(value));
    } catch {
      // A close event will clean up the socket.
    }
  }

  broadcast(value) {
    for (const socket of this.ctx.getWebSockets()) this.send(socket, value);
  }

  async issueHostTicket() {
    const token = randomToken();
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "DELETE FROM host_tickets WHERE expires_at < ?",
      now,
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO host_tickets (token, expires_at) VALUES (?, ?)",
      token,
      now + 60_000,
    );
    return token;
  }

  async getPublicState() {
    return this.state();
  }

  consumeTicket(token) {
    const row = this.ctx.storage.sql
      .exec("SELECT expires_at FROM host_tickets WHERE token = ?", token)
      .toArray()[0];
    this.ctx.storage.sql.exec(
      "DELETE FROM host_tickets WHERE token = ?",
      token,
    );
    return Boolean(row && row.expires_at >= Date.now());
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "WebSocket required" }, 426);
    }
    const url = new URL(request.url);
    const role = url.searchParams.get("role") === "host" ? "host" : "viewer";
    if (
      role === "host" &&
      !this.consumeTicket(url.searchParams.get("ticket") || "")
    ) {
      return json({ error: "Invalid or expired host ticket" }, 403);
    }
    if (role === "viewer" && this.sockets("viewer").length >= MAX_VIEWERS) {
      return json({ error: "This live room is full" }, 429);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id =
      role === "host" ? crypto.randomUUID() : `viewer-${crypto.randomUUID()}`;
    server.serializeAttachment({ role, id });
    this.ctx.acceptWebSocket(server, [role]);

    if (role === "host") {
      for (const previous of this.sockets("host")) {
        if (previous !== server)
          previous.close(4001, "Broadcast opened elsewhere");
      }
      for (const viewer of this.sockets("viewer")) {
        const attachment = viewer.deserializeAttachment();
        this.send(server, { type: "viewer-joined", viewerId: attachment.id });
      }
    } else {
      for (const host of this.sockets("host")) {
        this.send(host, { type: "viewer-joined", viewerId: id });
      }
    }
    this.send(server, this.state());
    this.broadcast(this.state());
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, message) {
    if (typeof message !== "string" || message.length > MAX_MESSAGE) {
      socket.close(1009, "Message too large");
      return;
    }
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    const sender = socket.deserializeAttachment();
    if (!sender?.role || typeof data?.type !== "string") return;
    const now = Date.now();
    if (!sender.rateStartedAt || now - sender.rateStartedAt > 60_000) {
      sender.rateStartedAt = now;
      sender.rateCount = 0;
    }
    sender.rateCount += 1;
    socket.serializeAttachment(sender);
    if (sender.rateCount > 240) {
      socket.close(1008, "Too many signaling messages");
      return;
    }

    if (sender.role === "host") {
      if (data.type === "metadata") {
        const title = cleanText(data.title, 120) || "atomEDU Live";
        const override = Number.isInteger(data.viewerOverride)
          ? Math.max(0, Math.min(1_000_000, data.viewerOverride))
          : null;
        this.ctx.storage.sql.exec(
          "UPDATE room_state SET title = ?, override_count = ? WHERE id = 1",
          title,
          override,
        );
        this.broadcast(this.state());
        return;
      }
      if (data.type === "live-start" || data.type === "live-stop") {
        this.ctx.storage.sql.exec(
          "UPDATE room_state SET live = ? WHERE id = 1",
          data.type === "live-start" ? 1 : 0,
        );
        this.broadcast(this.state());
        return;
      }
      if (["offer", "ice"].includes(data.type) && typeof data.to === "string") {
        const viewer = this.sockets("viewer").find(
          (candidate) => candidate.deserializeAttachment()?.id === data.to,
        );
        if (viewer) this.send(viewer, { ...data, from: "host" });
      }
      return;
    }

    if (["answer", "ice"].includes(data.type)) {
      for (const host of this.sockets("host")) {
        this.send(host, { ...data, from: sender.id, to: "host" });
      }
    }
  }

  async webSocketClose(socket, code, reason) {
    const sender = socket.deserializeAttachment();
    if (
      code >= 1000 &&
      code < 5000 &&
      ![1004, 1005, 1006, 1015].includes(code)
    ) {
      socket.close(code, reason);
    } else {
      socket.close();
    }
    if (sender?.role === "viewer") {
      for (const host of this.sockets("host")) {
        this.send(host, { type: "viewer-left", viewerId: sender.id });
      }
    } else if (sender?.role === "host" && this.sockets("host").length === 0) {
      this.ctx.storage.sql.exec("UPDATE room_state SET live = 0 WHERE id = 1");
    }
    this.broadcast(this.state());
  }

  async webSocketError(socket) {
    socket.close();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const headers = cors(origin, env.ALLOWED_ORIGIN);
    if (request.method === "OPTIONS") {
      return Object.keys(headers).length
        ? new Response(null, { status: 204, headers })
        : json({ error: "Origin not allowed" }, 403);
    }
    if (origin && !Object.keys(headers).length)
      return json({ error: "Origin not allowed" }, 403);
    const room = env.LIVE_ROOM.getByName(ROOM_NAME, { locationHint: "wnam" });

    try {
      if (url.pathname === "/health")
        return json({ ok: true, service: "atom-live-signal" }, 200, headers);
      if (url.pathname === "/status" && request.method === "GET") {
        return json(await room.getPublicState(), 200, headers);
      }
      if (url.pathname === "/host-ticket" && request.method === "POST") {
        const limited = await env.HOST_AUTH_LIMITER.limit({
          key: request.headers.get("CF-Connecting-IP") || "unknown",
        });
        if (!limited.success)
          return json({ error: "Too many attempts" }, 429, headers);
        const supplied = request.headers.get("X-Stream-Key") || "";
        if (!(await sameSecret(supplied, env.LIVE_STREAM_KEY))) {
          return json({ error: "Incorrect stream key" }, 403, headers);
        }
        return json({ ticket: await room.issueHostTicket() }, 200, headers);
      }
      if (url.pathname === "/ws") return room.fetch(request);
      return json({ error: "Not found" }, 404, headers);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "live_signal_error",
          path: url.pathname,
          error: String(error),
        }),
      );
      return json({ error: "Live signaling unavailable" }, 503, headers);
    }
  },
};
