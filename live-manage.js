const config = window.ATOM_LIVE;
const $ = (id) => document.getElementById(id);
const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const peerConfig = {
  iceServers: [
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.l.google.com:19302" },
  ],
};

let signal;
let signalPromise;
let stream;
let recorder;
let chunks = [];
let streamKey = "";
let reconnectTimer;
let lastState = {};
const peers = new Map();
const waitingViewers = new Set();

function showError(message = "") {
  $("manager-error").hidden = !message;
  $("manager-error").textContent = message;
}

function socketUrl(role, ticket = "") {
  const url = new URL(config.signalBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.searchParams.set("role", role);
  if (ticket) url.searchParams.set("ticket", ticket);
  return url.href;
}

async function hostTicket() {
  streamKey = $("stream-key").value.trim() || streamKey;
  if (!streamKey) throw new Error("Enter the private stream key.");
  const response = await fetch(`${config.signalBase}/host-ticket`, {
    method: "POST",
    headers: { "X-Stream-Key": streamKey },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || "The live service is unavailable.");
  return data.ticket;
}

async function ensureSignal() {
  if (signal?.readyState === WebSocket.OPEN) return signal;
  if (signalPromise) return signalPromise;
  signalPromise = (async () => {
    const ticket = await hostTicket();
    const socket = new WebSocket(socketUrl("host", ticket));
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Live signaling timed out.")),
        10_000,
      );
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          reject(new Error("Could not connect to live signaling."));
        },
        { once: true },
      );
    });
    signal = socket;
    signal.addEventListener("message", onSignal);
    signal.addEventListener("close", onSignalClose);
    return signal;
  })();
  try {
    return await signalPromise;
  } finally {
    signalPromise = null;
  }
}

function send(data) {
  if (signal?.readyState === WebSocket.OPEN) signal.send(JSON.stringify(data));
}

async function waitForIce(peer) {
  if (peer.iceGatheringState === "complete") return;
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    peer.addEventListener("icegatheringstatechange", () => {
      if (peer.iceGatheringState === "complete") {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

function updateState(state) {
  lastState = state;
  if (state.title) {
    $("preview-title").textContent = state.title;
    if (document.activeElement !== $("stream-title"))
      $("stream-title").value = state.title;
  }
  $("manager-viewers").textContent = String(
    state.displayViewers ?? state.viewers ?? 0,
  );
}

async function tunePeers() {
  const viewers = Math.max(1, waitingViewers.size);
  const maxBitrate =
    viewers <= 4 ? 1_500_000 : viewers <= 10 ? 900_000 : 500_000;
  const updates = [];
  for (const peer of peers.values()) {
    for (const sender of peer.getSenders()) {
      if (sender.track?.kind !== "video") continue;
      const parameters = sender.getParameters();
      parameters.encodings ||= [{}];
      parameters.encodings[0].maxBitrate = maxBitrate;
      parameters.encodings[0].maxFramerate = 30;
      updates.push(sender.setParameters(parameters).catch(() => {}));
    }
  }
  await Promise.all(updates);
}

async function createPeer(viewerId) {
  waitingViewers.add(viewerId);
  if (!stream || peers.has(viewerId)) {
    return;
  }
  const peer = new RTCPeerConnection(peerConfig);
  peers.set(viewerId, peer);
  for (const track of stream.getTracks()) peer.addTrack(track, stream);
  await tunePeers();
  peer.addEventListener("icecandidate", (event) => {
    if (event.candidate)
      send({ type: "ice", to: viewerId, candidate: event.candidate });
  });
  peer.addEventListener("connectionstatechange", () => {
    if (["failed", "closed"].includes(peer.connectionState))
      closePeer(viewerId);
  });
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  await tunePeers();
  await waitForIce(peer);
  send({ type: "offer", to: viewerId, sdp: peer.localDescription });
}

function closePeer(viewerId) {
  peers.get(viewerId)?.close();
  peers.delete(viewerId);
}

async function onSignal(event) {
  let data;
  try {
    data = JSON.parse(event.data);
  } catch {
    return;
  }
  if (data.type === "state") updateState(data);
  else if (data.type === "viewer-joined") await createPeer(data.viewerId);
  else if (data.type === "viewer-left") {
    closePeer(data.viewerId);
    waitingViewers.delete(data.viewerId);
    await tunePeers();
  } else if (data.type === "answer" && peers.has(data.from)) {
    await peers.get(data.from).setRemoteDescription(data.sdp);
  } else if (data.type === "ice" && peers.has(data.from) && data.candidate) {
    await peers
      .get(data.from)
      .addIceCandidate(data.candidate)
      .catch(() => {});
  }
}

function onSignalClose() {
  signal = null;
  for (const viewerId of peers.keys()) closePeer(viewerId);
  if (!stream) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    ensureSignal()
      .then(async () => {
        await publishMetadata();
        send({ type: "live-start" });
      })
      .catch((cause) => showError(cause.message));
  }, 1500);
}

async function publishMetadata(extra = {}) {
  await ensureSignal();
  const title = $("stream-title").value.trim() || "atomEDU Live";
  send({ type: "metadata", title, ...extra });
  $("preview-title").textContent = title;
  if (Number.isInteger(extra.viewerOverride))
    $("manager-viewers").textContent = String(extra.viewerOverride);
}

async function captureDisplay() {
  if (local && new URLSearchParams(location.search).get("synthetic") === "1") {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d");
    let frame = 0;
    const draw = () => {
      frame += 1;
      context.fillStyle = "#142333";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#ffffff";
      context.font = "700 64px sans-serif";
      context.fillText("atomEDU Live end-to-end test", 150, 330);
      context.fillStyle = "#74a9e8";
      context.fillRect(150, 380, frame % 900, 16);
    };
    draw();
    const timer = setInterval(draw, 50);
    const testStream = canvas.captureStream(20);
    testStream
      .getVideoTracks()[0]
      .addEventListener("ended", () => clearInterval(timer), { once: true });
    return testStream;
  }
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: 30, max: 60 },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: true,
    preferCurrentTab: false,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    systemAudio: "include",
  });
}

async function goLive() {
  try {
    showError();
    await ensureSignal();
    stream = await captureDisplay();
    const videoTrack = stream.getVideoTracks()[0];
    videoTrack.addEventListener("ended", stopLive, { once: true });
    $("preview-video").srcObject = stream;
    $("preview-empty").hidden = true;
    $("manager-status").textContent = "Live";
    $("video-signal").textContent = "Screen video live";
    $("audio-signal").textContent = stream.getAudioTracks().length
      ? "Tab audio live"
      : "No shared audio";
    $("start-live").disabled = true;
    $("stop-live").disabled = false;
    $("start-recording").disabled = false;
    await publishMetadata();
    send({ type: "live-start" });
    for (const viewerId of waitingViewers) await createPeer(viewerId);
  } catch (cause) {
    showError(
      cause.name === "NotAllowedError"
        ? "Screen sharing was cancelled or not permitted."
        : cause.message,
    );
  }
}

function stopLive() {
  if (recorder?.state === "recording") stopRecording();
  send({ type: "live-stop" });
  for (const viewerId of peers.keys()) closePeer(viewerId);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  $("preview-video").srcObject = null;
  $("preview-empty").hidden = false;
  $("manager-status").textContent = "Offline";
  $("video-signal").textContent = "No video";
  $("audio-signal").textContent = "No shared audio";
  $("start-live").disabled = false;
  $("stop-live").disabled = true;
  $("start-recording").disabled = true;
}

function bestMime() {
  return (
    [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ].find((type) => MediaRecorder.isTypeSupported(type)) || ""
  );
}

function startRecording() {
  if (!stream) return;
  chunks = [];
  const mimeType = bestMime();
  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onstop = downloadRecording;
  recorder.start(1000);
  $("record-signal").textContent = "Recording locally";
  $("start-recording").disabled = true;
  $("stop-recording").disabled = false;
}

function stopRecording() {
  if (recorder?.state === "recording") recorder.stop();
  $("record-signal").textContent = "Not recording";
  $("start-recording").disabled = !stream;
  $("stop-recording").disabled = true;
}

function downloadRecording() {
  const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `atomedu-live-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  chunks = [];
}

async function loadStatus() {
  try {
    const response = await fetch(`${config.signalBase}/status`);
    if (response.ok) updateState(await response.json());
  } catch {
    // The connection state is shown when the presenter starts the broadcast.
  }
}

$("start-live").addEventListener("click", goLive);
$("stop-live").addEventListener("click", stopLive);
$("start-recording").addEventListener("click", startRecording);
$("stop-recording").addEventListener("click", stopRecording);
$("stream-title").addEventListener("change", () => {
  if (signal?.readyState === WebSocket.OPEN)
    publishMetadata().catch((cause) => showError(cause.message));
});

document.addEventListener("keydown", (event) => {
  if (
    local &&
    event.key === "\\" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    event.preventDefault();
    $("override-count").value = Number.isInteger(lastState.viewerOverride)
      ? lastState.viewerOverride
      : "";
    $("viewer-override").showModal();
  }
});
$("push-override").addEventListener("click", (event) => {
  event.preventDefault();
  const value = $("override-count").value.trim();
  publishMetadata({
    viewerOverride:
      value === ""
        ? null
        : Math.max(0, Math.min(1_000_000, Number(value) || 0)),
  })
    .then(() => $("viewer-override").close())
    .catch((cause) => showError(cause.message));
});
window.addEventListener("beforeunload", () => {
  stream?.getTracks().forEach((track) => track.stop());
  signal?.close(1000, "Manager closed");
  for (const viewerId of peers.keys()) closePeer(viewerId);
});

loadStatus();
