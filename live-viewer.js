import * as LiveKit from './vendor/livekit-client/livekit-client.esm.mjs';

const config = window.ATOM_LIVE;
const video = document.getElementById('live-video');
const empty = document.getElementById('live-empty');
const stateLabel = document.getElementById('live-state');
const title = document.getElementById('live-title');
const count = document.getElementById('viewer-count');
const dot = document.getElementById('live-dot');
const sound = document.getElementById('live-sound');
const message = document.getElementById('live-message');
let room;

function parseMetadata() { try { return JSON.parse(room?.metadata || '{}'); } catch (_) { return {}; } }
function realViewers() { return room ? 1 + [...room.remoteParticipants.values()].filter(p => p.identity !== 'atomedu-host').length : 0; }
function updateDetails() {
  const metadata = parseMetadata();
  title.textContent = metadata.title || 'atomEDU Live';
  const override = Number.isInteger(metadata.viewerOverride) ? metadata.viewerOverride : null;
  count.textContent = String(override ?? realViewers());
}
function setLive(value) {
  dot.classList.toggle('on', value);
  empty.hidden = value;
  stateLabel.textContent = value ? 'Live now' : 'The stream is not live yet.';
}
function attachTrack(track) {
  if (track.kind === LiveKit.Track.Kind.Video) { track.attach(video); setLive(true); }
  else if (track.kind === LiveKit.Track.Kind.Audio) {
    track.attach(video);
    video.play().catch(() => { sound.hidden = false; });
  }
}
async function connect() {
  try {
    const response = await fetch(`${config.apiBase}/api/token`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ role:'viewer' }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The stream service is unavailable.');
    room = new LiveKit.Room({ adaptiveStream:true, dynacast:true });
    room.on(LiveKit.RoomEvent.TrackSubscribed, attachTrack);
    room.on(LiveKit.RoomEvent.TrackUnsubscribed, track => { track.detach(); if (track.kind === LiveKit.Track.Kind.Video) setLive(false); });
    room.on(LiveKit.RoomEvent.ParticipantConnected, updateDetails);
    room.on(LiveKit.RoomEvent.ParticipantDisconnected, updateDetails);
    room.on(LiveKit.RoomEvent.RoomMetadataChanged, updateDetails);
    room.on(LiveKit.RoomEvent.Disconnected, () => { setLive(false); message.textContent = 'Reconnecting…'; setTimeout(connect, 1500); });
    await room.connect(data.serverUrl, data.token, { autoSubscribe:true });
    updateDetails();
    room.remoteParticipants.forEach(participant => participant.trackPublications.forEach(publication => { if (publication.track) attachTrack(publication.track); }));
    message.textContent = '';
  } catch (error) {
    stateLabel.textContent = 'The live stream is currently offline.';
    message.textContent = 'Trying to reconnect…';
    setTimeout(connect, 4000);
  }
}
sound.addEventListener('click', async () => { try { await room.startAudio(); await video.play(); sound.hidden = true; } catch (_) {} });
window.addEventListener('beforeunload', () => room?.disconnect());
connect();
