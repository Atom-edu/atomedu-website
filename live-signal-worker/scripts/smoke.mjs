const base = process.env.LIVE_SIGNAL_URL || "https://atom-live-signal.archimedes-api1.workers.dev";
const key = process.env.LIVE_SMOKE_KEY;
if (!key) throw new Error("LIVE_SMOKE_KEY is required");

function socketUrl(role, ticket = "") {
  const url = new URL(base);
  url.protocol = "wss:";
  url.pathname = "/ws";
  url.searchParams.set("role", role);
  if (ticket) url.searchParams.set("ticket", ticket);
  return url;
}

function opened(socket) {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
}

function nextMessage(socket, predicate, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for signaling message")), timeoutMs);
    const listener = (event) => {
      const data = JSON.parse(event.data);
      if (!predicate(data)) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", listener);
      resolve(data);
    };
    socket.addEventListener("message", listener);
  });
}

const ticketResponse = await fetch(`${base}/host-ticket`, {
  method: "POST",
  headers: { Origin: "https://atom-edu.org", "X-Stream-Key": key },
});
if (!ticketResponse.ok) throw new Error(`Host ticket failed: ${ticketResponse.status}`);
const { ticket } = await ticketResponse.json();

const host = new WebSocket(socketUrl("host", ticket));
await opened(host);
const joined = nextMessage(host, (data) => data.type === "viewer-joined");
const viewer = new WebSocket(socketUrl("viewer"));
await opened(viewer);
const { viewerId } = await joined;

const viewerOffer = nextMessage(viewer, (data) => data.type === "offer");
host.send(JSON.stringify({ type: "offer", to: viewerId, sdp: { type: "offer", sdp: "smoke-offer" } }));
if ((await viewerOffer).sdp.sdp !== "smoke-offer") throw new Error("Offer was not routed");

const hostAnswer = nextMessage(host, (data) => data.type === "answer");
viewer.send(JSON.stringify({ type: "answer", to: "host", sdp: { type: "answer", sdp: "smoke-answer" } }));
if ((await hostAnswer).sdp.sdp !== "smoke-answer") throw new Error("Answer was not routed");

const liveState = nextMessage(viewer, (data) => data.type === "state" && data.title === "atomEDU Live smoke test" && data.live);
host.send(JSON.stringify({ type: "metadata", title: "atomEDU Live smoke test", viewerOverride: 17 }));
host.send(JSON.stringify({ type: "live-start" }));
const state = await liveState;
if (state.displayViewers !== 17) throw new Error("Viewer override was not broadcast");

host.send(JSON.stringify({ type: "metadata", title: "atomEDU Live", viewerOverride: null }));
host.send(JSON.stringify({ type: "live-stop" }));
viewer.close(1000, "Smoke test complete");
host.close(1000, "Smoke test complete");
console.log("Live signaling smoke test passed.");
