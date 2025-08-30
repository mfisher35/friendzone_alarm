// Always-on "radio" clock: one track that loops forever.
import http from "http";
import { WebSocketServer } from "ws";

// ======= CONFIG =======
// Exact MP3 length in seconds (e.g., 214.62). Use your true duration.
// You can override via env: MP3_DURATION_SEC=4920 node server.js
const MP3_DURATION_SEC = Number(process.env.MP3_DURATION_SEC ?? 4920);

// Anchor start to a fixed timestamp so restarts don't change phase.
// 0 = Jan 1, 1970. Any fixed constant works.
// You can override via env: STATION_START_EPOCH_MS=0
const STATION_START_EPOCH_MS = Number(process.env.STATION_START_EPOCH_MS ?? 0);

// Listen interface/port (keep on localhost if you proxy via Nginx)
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 8080);

// ======= HTTP SERVER (with /healthz) =======
const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    const body = JSON.stringify({
      ok: true,
      serverNow: Date.now(),
      durationSec: MP3_DURATION_SEC,
      startAtEpochMs: STATION_START_EPOCH_MS,
      uptimeSec: Math.floor(process.uptime()),
    });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(body);
    return;
  }
  res.statusCode = 404;
  res.end("Not found");
});

// ======= WEBSOCKET SERVER =======
const wss = new WebSocketServer({ server, path: "/alarm/ws" });
const nowMs = () => Date.now();

function sendHello(ws) {
  ws.send(
    JSON.stringify({
      type: "hello",
      serverNow: nowMs(),
      state: {
        // always playing; clients compute loop position as:
        // ((serverNow - startAtEpochMs)/1000) % durationSec
        isPaused: false,
        startAtEpochMs: STATION_START_EPOCH_MS,
        durationSec: MP3_DURATION_SEC,
      },
    })
  );
}

// Heartbeat to kill dead connections and keep proxies happy
function heartbeat() {
  this.isAlive = true;
}

wss.on("connection", (ws, req) => {
  ws.isAlive = true;
  ws.on("pong", heartbeat);

  // On connect, tell the client "we started at X and loop every duration"
  sendHello(ws);

  // App-level ping/pong for clock-offset estimation
  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }
    if (msg?.type === "ping") {
      ws.send(
        JSON.stringify({
          type: "pong",
          serverNow: nowMs(),
          echo: msg.echo, // mirror their timestamp for mid-point calc
        })
      );
    }
  });
});

// WS ping (protocol-level) every 30s
const pingInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch {}
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 30000);

// ======= START / SHUTDOWN =======
server.listen(PORT, HOST, () => {
  console.log(
    `Radio WS on http://${HOST}:${PORT}  (path: /alarm/ws, duration: ${MP3_DURATION_SEC}s, startAtEpochMs: ${STATION_START_EPOCH_MS})`
  );
});

function shutdown(sig) {
  console.log(`\n${sig} received, shutting down...`);
  clearInterval(pingInterval);
  wss.close(() => {
    server.close(() => process.exit(0));
  });
  // Failsafe
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

