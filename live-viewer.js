const config = window.ATOM_LIVE;
const video = document.getElementById("live-video");
const empty = document.getElementById("live-empty");
const stateLabel = document.getElementById("live-state");
const title = document.getElementById("live-title");
const count = document.getElementById("viewer-count");
const dot = document.getElementById("live-dot");
const sound = document.getElementById("live-sound");
const message = document.getElementById("live-message");
const peerConfig = {
  iceServers: [
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.l.google.com:19302" },
  ],
};

let signal;
let peer;
let reconnectTimer;
let remoteStream;

function socketUrl() {
  const url = new URL(config.signalBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.searchParams.set("role", "viewer");
  return url.href;
}

function setLive(value) {
  dot.classList.toggle("on", value);
  empty.hidden = value;
  stateLabel.textContent = value ? "Live now" : "The stream is not live yet.";
  if (!value) {
    video.srcObject = null;
    remoteStream = null;
  }
}

function updateState(state) {
  title.textContent = state.title || "atomEDU Live";
  count.textContent = String(state.displayViewers ?? state.viewers ?? 0);
  if (!state.live) setLive(false);
  else if (!remoteStream)
    stateLabel.textContent = "Connecting to the live video…";
}

function closePeer() {
  peer?.close();
  peer = null;
  remoteStream = null;
  video.srcObject = null;
}

async function waitForIce(connection) {
  if (connection.iceGatheringState === "complete") return;
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    connection.addEventListener("icegatheringstatechange", () => {
      if (connection.iceGatheringState === "complete") {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

async function receiveOffer(data) {
  closePeer();
  peer = new RTCPeerConnection(peerConfig);
  remoteStream = new MediaStream();
  video.srcObject = remoteStream;
  peer.addEventListener("track", (event) => {
    for (const track of event.streams[0]?.getTracks() || [event.track]) {
      if (!remoteStream.getTracks().some((item) => item.id === track.id))
        remoteStream.addTrack(track);
    }
    setLive(true);
    video.play().catch(() => {
      sound.hidden = false;
    });
  });
  peer.addEventListener("icecandidate", (event) => {
    if (event.candidate && signal?.readyState === WebSocket.OPEN) {
      signal.send(
        JSON.stringify({ type: "ice", to: "host", candidate: event.candidate }),
      );
    }
  });
  peer.addEventListener("connectionstatechange", () => {
    if (["failed", "closed"].includes(peer?.connectionState)) setLive(false);
  });
  await peer.setRemoteDescription(data.sdp);
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  await waitForIce(peer);
  signal.send(
    JSON.stringify({ type: "answer", to: "host", sdp: peer.localDescription }),
  );
}

async function onSignal(event) {
  let data;
  try {
    data = JSON.parse(event.data);
  } catch {
    return;
  }
  if (data.type === "state") updateState(data);
  else if (data.type === "offer") await receiveOffer(data);
  else if (data.type === "ice" && peer && data.candidate)
    await peer.addIceCandidate(data.candidate).catch(() => {});
}

function connect() {
  clearTimeout(reconnectTimer);
  message.textContent = "Connecting…";
  signal = new WebSocket(socketUrl());
  signal.addEventListener("open", () => {
    message.textContent = "";
  });
  signal.addEventListener("message", onSignal);
  signal.addEventListener("close", () => {
    closePeer();
    setLive(false);
    message.textContent = "Trying to reconnect…";
    reconnectTimer = setTimeout(connect, 2000);
  });
  signal.addEventListener("error", () => {
    message.textContent = "Trying to reconnect…";
  });
}

sound.addEventListener("click", async () => {
  try {
    video.muted = false;
    await video.play();
    sound.hidden = true;
  } catch {
    // The browser will keep the explicit sound control visible.
  }
});
window.addEventListener("beforeunload", () => {
  clearTimeout(reconnectTimer);
  signal?.close(1000, "Viewer left");
  closePeer();
});

connect();
