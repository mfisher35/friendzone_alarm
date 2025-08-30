// Configure your MP3 & station name here:
//const MP3_URL = "https://friendzone.best/alarm.mp3"; 
const MP3_URL = "alarm.mp3"; 
const STATION_LABEL = "My Station — Track A";

const audio = document.getElementById("audio");
const unmuteBtn = document.getElementById("unmute");
const statusEl = document.getElementById("status");
document.getElementById("track").textContent = STATION_LABEL;

audio.src = MP3_URL;

// --- WebSocket clock sync (offset) ---
const ws = new WebSocket("ws://localhost:8080");
let serverOffsetMs = 0;
let state = null;
let durationSec = null;

function measureOffset() {
  const echo = performance.now();
  ws.send(JSON.stringify({ type: "ping", echo }));
}

ws.onopen = () => {
  // keep offset fresh for driftless playback
  setInterval(() => { if (ws.readyState === 1) measureOffset(); }, 3000);
};

ws.onmessage = (evt) => {
  const msg = JSON.parse(evt.data);
  if (msg.type === "hello") {
    serverOffsetMs = msg.serverNow - Date.now();
    state = msg.state;
    durationSec = state.durationSec;
    startPlaybackLoop(); // begin immediately (muted)
  }
  if (msg.type === "pong") {
    const t1 = performance.now();
    const approxClientMid = (msg.echo + t1) / 2;
    serverOffsetMs = msg.serverNow - (performance.timeOrigin + approxClientMid);
  }
};

// --- Core "radio" math ---
function serverNowMs() {
  return Date.now() + serverOffsetMs;
}

// Always playing, loop every durationSec, anchored at state.startAtEpochMs
function desiredPositionSec() {
  if (!state || durationSec == null) return 0;
  const t = (serverNowMs() - state.startAtEpochMs) / 1000;
  // modulo loop
  return ((t % durationSec) + durationSec) % durationSec;
}

// --- Playback: start muted, sync in background, let user unmute ---
let rafId = null;

async function startPlaybackLoop() {
  // attempt autoplay in muted mode; most browsers allow this
  try {
    audio.muted = true;
    await audio.play().catch(()=>{});
  } catch {}

  // Keep tightly aligned without visible controls/UI
  const loop = () => {
    if (!durationSec) { rafId = requestAnimationFrame(loop); return; }

    const want = desiredPositionSec();
    const have = audio.currentTime || 0;
    const err = want - have;

    // Hard-correct if far off; otherwise nudge with playbackRate (±3%)
    if (audio.paused) {
      if (Math.abs(err) > 0.2) audio.currentTime = want;
      audio.play().catch(()=>{});
      audio.playbackRate = 1.0;
    } else {
      if (Math.abs(err) > 0.75) {
        audio.currentTime = want;
        audio.playbackRate = 1.0;
      } else {
        const correction = Math.max(-0.03, Math.min(0.03, err * 0.25));
        audio.playbackRate = 1.0 + correction;
      }
    }

    // Simple status text
    statusEl.textContent = audio.muted
      ? "Live (muted). Tap to unmute."
      : "Live";

    rafId = requestAnimationFrame(loop);
  };

  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

unmuteBtn.addEventListener("click", async () => {
  try {
    audio.muted = false;
    await audio.play().catch(()=>{});
    unmuteBtn.disabled = true;
    unmuteBtn.textContent = "Playing";
    statusEl.textContent = "Live";
  } catch {}
});

