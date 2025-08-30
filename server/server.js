// Always-on "radio" clock: one track that loops forever.
import http from "http";
import { WebSocketServer } from "ws";

// === SET THIS ONCE ===
// Exact MP3 length in seconds (e.g., 214.62). Use your true duration.
const MP3_DURATION_SEC = 4920;

// Anchor start to a fixed timestamp so restarts don't change phase.
// 0 = Jan 1, 1970. Any constant works.
const STATION_START_EPOCH_MS = 0;

const server = http.createServer();

const wss = new WebSocketServer({ server, path: "/alarm/ws" });
const nowMs = () => Date.now();

wss.on("connection", (ws) => {
  // On connect, tell the client "we started at X and loop every duration"
  ws.send(
    JSON.stringify({
      type: "hello",
      serverNow: nowMs(),
      state: {
        // always playing; clients should ignore pause/seek
        isPaused: false,
        startAtEpochMs: STATION_START_EPOCH_MS,
        durationSec: MP3_DURATION_SEC,
      },
    })
  );

  // Simple clock offset ping/pong for better sync
  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", serverNow: nowMs(), echo: msg.echo }));
    }
  });
});

server.listen(8080, () => {
  console.log("Radio WS on http://localhost:8080");
});

