import * as LiveKit from './vendor/livekit-client/livekit-client.esm.mjs';

const config = window.ATOM_LIVE;
const $ = id => document.getElementById(id);
let room, stream, videoTrack, audioTrack, recorder, chunks = [], streamKey = '';

function error(message='') { $('manager-error').hidden = !message; $('manager-error').textContent = message; }
function metadata() { try { return JSON.parse(room?.metadata || '{}'); } catch (_) { return {}; } }
function updateViewers() { const meta = metadata(); const real = room ? [...room.remoteParticipants.values()].filter(p => p.identity !== 'atomedu-host').length : 0; $('manager-viewers').textContent = String(Number.isInteger(meta.viewerOverride) ? meta.viewerOverride : real); }
async function api(path, options={}) {
  const currentKey = streamKey || $('stream-key')?.value.trim() || '';
  const response = await fetch(`${config.apiBase}${path}`, { ...options, headers:{'Content-Type':'application/json','X-Stream-Key':currentKey,...options.headers} });
  const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'The live service could not complete that request.'); return data;
}
async function ensureRoom() {
  streamKey = $('stream-key').value.trim(); if (!streamKey) throw new Error('Enter the private stream key.');
  if (room?.state === LiveKit.ConnectionState.Connected) return;
  const data = await api('/api/token', {method:'POST',body:JSON.stringify({role:'host'})});
  room = new LiveKit.Room({dynacast:true,adaptiveStream:true});
  room.on(LiveKit.RoomEvent.ParticipantConnected, updateViewers).on(LiveKit.RoomEvent.ParticipantDisconnected, updateViewers).on(LiveKit.RoomEvent.RoomMetadataChanged, () => { updateViewers(); $('preview-title').textContent = metadata().title || $('stream-title').value; });
  await room.connect(data.serverUrl, data.token, {autoSubscribe:false}); updateViewers();
}
async function publishMetadata(extra={}) { const title = $('stream-title').value.trim() || 'atomEDU Live'; const updated = await api('/api/metadata',{method:'POST',body:JSON.stringify({title,...extra})}); $('preview-title').textContent=title; if(Number.isInteger(updated.viewerOverride)) $('manager-viewers').textContent=String(updated.viewerOverride); else if(room) updateViewers(); }
async function loadStatus() { try { const response=await fetch(`${config.apiBase}/api/status`); if(!response.ok)return; const status=await response.json(); if(status.title){$('stream-title').value=status.title;$('preview-title').textContent=status.title} $('manager-viewers').textContent=String(Number.isInteger(status.viewerOverride)?status.viewerOverride:(status.viewers||0)); } catch (_) {} }
async function goLive() {
  try {
    error(); await ensureRoom(); await publishMetadata();
    stream = await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:30,max:60},width:{ideal:1920},height:{ideal:1080}},audio:true,preferCurrentTab:false,selfBrowserSurface:'exclude',surfaceSwitching:'include',systemAudio:'include'});
    const rawVideo = stream.getVideoTracks()[0]; const rawAudio = stream.getAudioTracks()[0];
    videoTrack = new LiveKit.LocalVideoTrack(rawVideo); await room.localParticipant.publishTrack(videoTrack,{source:LiveKit.Track.Source.ScreenShare,simulcast:true});
    if (rawAudio) { audioTrack = new LiveKit.LocalAudioTrack(rawAudio); await room.localParticipant.publishTrack(audioTrack,{source:LiveKit.Track.Source.ScreenShareAudio}); }
    rawVideo.addEventListener('ended', stopLive, {once:true});
    $('preview-video').srcObject=stream; $('preview-empty').hidden=true; $('manager-status').textContent='Live'; $('video-signal').textContent='Screen video live'; $('audio-signal').textContent=rawAudio?'Tab audio live':'No shared audio';
    $('start-live').disabled=true; $('stop-live').disabled=false; $('start-recording').disabled=false;
  } catch (cause) { error(cause.name === 'NotAllowedError' ? 'Screen sharing was cancelled or not permitted.' : cause.message); }
}
async function stopLive() {
  try {
    if (recorder?.state === 'recording') stopRecording();
    if (videoTrack) await room?.localParticipant.unpublishTrack(videoTrack); if (audioTrack) await room?.localParticipant.unpublishTrack(audioTrack);
    stream?.getTracks().forEach(track=>track.stop()); videoTrack=null; audioTrack=null; stream=null; $('preview-video').srcObject=null; $('preview-empty').hidden=false;
    $('manager-status').textContent='Offline'; $('video-signal').textContent='No video'; $('audio-signal').textContent='No shared audio'; $('start-live').disabled=false; $('stop-live').disabled=true; $('start-recording').disabled=true;
  } catch (cause) { error(cause.message); }
}
function bestMime() { return ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type)) || ''; }
function startRecording() { if (!stream) return; chunks=[]; recorder=new MediaRecorder(stream,bestMime()?{mimeType:bestMime()}:undefined); recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}; recorder.onstop=downloadRecording; recorder.start(1000); $('record-signal').textContent='Recording locally'; $('start-recording').disabled=true; $('stop-recording').disabled=false; }
function stopRecording() { if (recorder?.state === 'recording') recorder.stop(); $('record-signal').textContent='Not recording'; $('start-recording').disabled=!stream; $('stop-recording').disabled=true; }
function downloadRecording() { const blob=new Blob(chunks,{type:recorder.mimeType||'video/webm'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); const stamp=new Date().toISOString().replace(/[:.]/g,'-'); a.href=url;a.download=`atomedu-live-${stamp}.webm`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);chunks=[]; }

$('start-live').addEventListener('click',goLive); $('stop-live').addEventListener('click',stopLive); $('start-recording').addEventListener('click',startRecording); $('stop-recording').addEventListener('click',stopRecording);
$('stream-title').addEventListener('change',()=>{if(room)publishMetadata().catch(cause=>error(cause.message))});
const local=/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
document.addEventListener('keydown',event=>{if(local&&event.key==='\\'&&!event.metaKey&&!event.ctrlKey&&!event.altKey){event.preventDefault();$('override-count').value=Number.isInteger(metadata().viewerOverride)?metadata().viewerOverride:'';$('viewer-override').showModal();}});
$('push-override').addEventListener('click',event=>{event.preventDefault();const value=$('override-count').value.trim();publishMetadata({viewerOverride:value===''?null:Math.max(0,Math.min(1000000,Number(value)||0))}).then(()=>$('viewer-override').close()).catch(cause=>error(cause.message));});
window.addEventListener('beforeunload',()=>{stream?.getTracks().forEach(track=>track.stop());room?.disconnect()});
loadStatus();
