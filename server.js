/**
 * Brainwriting en vivo — servidor
 * Momento 2 · Ideación
 *
 * Node + Express + Socket.IO. Estado en memoria (una instancia).
 * Roles: facilitador (control total) y participantes (escriben su hoja).
 */

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

/** @type {Map<string, Session>} */
const sessions = new Map();

const DEFAULT_ROUNDS = [
  {
    label: "Ronda 1 — generar",
    minutes: 4,
    prompt:
      "Escribí 3 ideas de herramienta o servicio que respondan a esta necesidad. Concretas, y por ahora sin preocuparse por la factibilidad ni por el nivel de desarrollo. En silencio.",
  },
  {
    label: "Ronda 2 — construir",
    minutes: 4,
    prompt:
      "Se pasa la hoja a la derecha. Construí sobre alguna de las ideas que te llegaron: llevala más lejos, combinala, hacela más específica, o pensá qué le falta.",
  },
  {
    label: "Ronda 3 — construir",
    minutes: 4,
    prompt:
      "Se pasa otra vez, con la misma consigna. La hoja ya tiene dos capas de aporte, así que lo que se agrega ahora se apoya en algo más enriquecido.",
  },
];

function code4() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sin O/0/I/1/L
  let c = "";
  for (let i = 0; i < 4; i++) {
    c += alphabet[crypto.randomInt(alphabet.length)];
  }
  return c;
}

function newSession(need, rounds) {
  let code;
  do {
    code = code4();
  } while (sessions.has(code));

  const session = {
    code,
    facilitatorToken: crypto.randomBytes(16).toString("hex"),
    need: (need || "").trim(),
    rounds: normalizeRounds(rounds),
    status: "lobby", // lobby | running | finished
    currentRound: 0, // 0 = no empezó; 1..N
    order: [], // ids de participantes, bloqueado al arrancar
    participants: {}, // id -> {id, name, connected}
    sheets: [], // [{id, contributions:[{round, participantId, name, text, updatedAt}]}]
    timer: { running: false, endsAt: null, remainingMs: null },
    createdAt: Date.now(),
  };
  sessions.set(code, session);
  return session;
}

function normalizeRounds(rounds) {
  if (!Array.isArray(rounds) || rounds.length === 0) {
    return DEFAULT_ROUNDS.map((r) => ({ ...r }));
  }
  return rounds.slice(0, 12).map((r, i) => ({
    label: String(r.label || DEFAULT_ROUNDS[i]?.label || `Ronda ${i + 1}`),
    minutes: clampMinutes(r.minutes),
    prompt: String(r.prompt || DEFAULT_ROUNDS[i]?.prompt || ""),
  }));
}

function clampMinutes(m) {
  const n = Number(m);
  if (!isFinite(n) || n <= 0) return 4;
  return Math.min(60, Math.max(1, Math.round(n * 100) / 100));
}

// index de la hoja que sostiene el participante `p` en la ronda `r` (1-based)
// Las hojas se pasan a la DERECHA, así que cada uno recibe la del vecino izquierdo.
function sheetIndexFor(p, r, n) {
  return (((p - (r - 1)) % n) + n) % n;
}

// ---------------------------------------------------------------------------
// Serialización del estado (lo que se manda a los clientes)
// ---------------------------------------------------------------------------

function publicState(session) {
  const n = session.order.length;
  return {
    code: session.code,
    need: session.need,
    rounds: session.rounds,
    status: session.status,
    currentRound: session.currentRound,
    totalRounds: session.rounds.length,
    order: session.order,
    participants: Object.values(session.participants).map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
    })),
    sheets: session.sheets.map((s) => ({
      id: s.id,
      contributions: s.contributions,
    })),
    timer: session.timer,
    // mapa: para la ronda actual, qué hoja tiene cada participante
    holdings:
      session.status === "running" && n > 0
        ? session.order.map((pid, p) => ({
            participantId: pid,
            sheetIndex: sheetIndexFor(p, session.currentRound, n),
          }))
        : [],
    serverNow: Date.now(),
  };
}

function broadcast(session) {
  io.to(session.code).emit("state", publicState(session));
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

const timers = new Map(); // code -> timeout handle

function startRoundTimer(session) {
  const round = session.rounds[session.currentRound - 1];
  const durationMs = Math.round(round.minutes * 60 * 1000);
  session.timer = {
    running: true,
    endsAt: Date.now() + durationMs,
    remainingMs: durationMs,
  };
  scheduleExpiry(session);
}

function scheduleExpiry(session) {
  clearTimer(session.code);
  if (!session.timer.running || !session.timer.endsAt) return;
  const ms = Math.max(0, session.timer.endsAt - Date.now());
  const handle = setTimeout(() => {
    session.timer.running = false;
    session.timer.endsAt = null;
    session.timer.remainingMs = 0;
    broadcast(session);
  }, ms + 50);
  timers.set(session.code, handle);
}

function clearTimer(code) {
  const h = timers.get(code);
  if (h) clearTimeout(h);
  timers.delete(code);
}

function pauseTimer(session) {
  if (!session.timer.running) return;
  const remaining = Math.max(0, (session.timer.endsAt || 0) - Date.now());
  session.timer = { running: false, endsAt: null, remainingMs: remaining };
  clearTimer(session.code);
}

function resumeTimer(session) {
  if (session.timer.running) return;
  const remaining = session.timer.remainingMs || 0;
  if (remaining <= 0) return;
  session.timer = {
    running: true,
    endsAt: Date.now() + remaining,
    remainingMs: remaining,
  };
  scheduleExpiry(session);
}

// ---------------------------------------------------------------------------
// Helpers de sesión
// ---------------------------------------------------------------------------

function isFacilitator(session, token) {
  return session && token && session.facilitatorToken === token;
}

function getSession(code) {
  return sessions.get(String(code || "").toUpperCase());
}

function contributionFor(sheet, round, participantId) {
  return sheet.contributions.find(
    (c) => c.round === round && c.participantId === participantId
  );
}

// Limpieza de sesiones viejas (6 h sin actividad)
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, s] of sessions) {
    if (s.createdAt < cutoff && Object.keys(s.participants).length === 0) {
      clearTimer(code);
      sessions.delete(code);
    }
  }
}, 30 * 60 * 1000);

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

io.on("connection", (socket) => {
  socket.data.role = null; // 'facilitator' | 'participant'
  socket.data.code = null;
  socket.data.participantId = null;

  function ack(cb, payload) {
    if (typeof cb === "function") cb(payload);
  }

  // ---- Crear sesión (facilitador) ----
  socket.on("createSession", (payload = {}, cb) => {
    const session = newSession(payload.need, payload.rounds);
    socket.data.role = "facilitator";
    socket.data.code = session.code;
    socket.join(session.code);
    ack(cb, {
      ok: true,
      code: session.code,
      facilitatorToken: session.facilitatorToken,
      state: publicState(session),
    });
  });

  // ---- Reconectar como facilitador ----
  socket.on("facilitatorRejoin", ({ code, token } = {}, cb) => {
    const session = getSession(code);
    if (!isFacilitator(session, token)) {
      return ack(cb, { ok: false, error: "Sesión o clave inválida." });
    }
    socket.data.role = "facilitator";
    socket.data.code = session.code;
    socket.join(session.code);
    ack(cb, { ok: true, state: publicState(session) });
  });

  // ---- Unirse como participante ----
  socket.on("joinSession", ({ code, name, participantId } = {}, cb) => {
    const session = getSession(code);
    if (!session) return ack(cb, { ok: false, error: "No existe una sala con ese código." });

    // Reconexión por id existente
    if (participantId && session.participants[participantId]) {
      const p = session.participants[participantId];
      p.connected = true;
      if (name && name.trim()) p.name = name.trim().slice(0, 40);
      socket.data.role = "participant";
      socket.data.code = session.code;
      socket.data.participantId = participantId;
      socket.join(session.code);
      broadcast(session);
      return ack(cb, { ok: true, participantId, state: publicState(session) });
    }

    // Alta nueva: solo permitida en lobby
    if (session.status !== "lobby") {
      return ack(cb, {
        ok: false,
        error: "El taller ya arrancó. Pedile al facilitador que te sume o esperá a la próxima ronda.",
      });
    }
    const cleanName = String(name || "").trim().slice(0, 40);
    if (!cleanName) return ack(cb, { ok: false, error: "Ingresá tu nombre." });

    const id = crypto.randomBytes(8).toString("hex");
    session.participants[id] = { id, name: cleanName, connected: true };
    socket.data.role = "participant";
    socket.data.code = session.code;
    socket.data.participantId = id;
    socket.join(session.code);
    broadcast(session);
    ack(cb, { ok: true, participantId: id, state: publicState(session) });
  });

  // ---- Config en lobby (facilitador) ----
  socket.on("setNeed", ({ code, token, need } = {}, cb) => {
    const session = getSession(code);
    if (!isFacilitator(session, token)) return ack(cb, { ok: false });
    session.need = String(need || "").trim();
    broadcast(session);
    ack(cb, { ok: true });
  });

  socket.on("setRounds", ({ code, token, rounds } = {}, cb) => {
    const session = getSession(code);
    if (!isFacilitator(session, token)) return ack(cb, { ok: false });
    if (session.status !== "lobby")
      return ack(cb, { ok: false, error: "Solo se puede configurar antes de arrancar." });
    session.rounds = normalizeRounds(rounds);
    broadcast(session);
    ack(cb, { ok: true });
  });

  socket.on("removeParticipant", ({ code, token, participantId } = {}, cb) => {
    const session = getSession(code);
    if (!isFacilitator(session, token)) return ack(cb, { ok: false });
    if (session.status !== "lobby")
      return ack(cb, { ok: false, error: "Solo antes de arrancar." });
    delete session.participants[participantId];
    broadcast(session);
    ack(cb, { ok: true });
  });

  // ---- Arrancar taller (facilitador) ----
  socket.on("startWorkshop", ({ code, token } = {}, cb) => {
    const session = getSession(code);
    if (!isFacilitator(session, token)) return ack(cb, { ok: false });
    const ids = Object.keys(session.participants);
    if (ids.length < 2)
      return ack(cb, { ok: false, error: "Necesitás al menos 2 participantes para rotar hojas." });
    if (!session.need.trim())
      return ack(cb, { ok: false, error: "Escribí la necesidad antes de arrancar." });

    session.order = ids;
    session.sheets = ids.map((_, i) => ({
      id: "hoja-" + (i + 1),
      contributions: [],
    }));
    session.status = "running";
    session.currentRound = 1;
    startRoundTimer(session);
    broadcast(session);
    ack(cb, { ok: true });
  });

  // ---- Control de timer / rondas (facilitador) ----
  socket.on("pauseTimer", ({ code, token } = {}, cb) => {
    const session = getSession(code);
    if (!isFacilitator(session, token)) return ack(cb, { ok: false });
    pauseTimer(session);
    broadcast(session);
    ack(cb, { ok: true });
  });

  socket.on("resumeTimer", ({ code, token } = {}, cb) => {
    const session = getSession(code);
    if (!isFacilitator(session, token)) return ack(cb, { ok: false });
    resumeTimer(session);
    broadcast(session);
    ack(cb, { ok: true });
  });

  socket.on("restartRoundTimer", ({ code, token } = {}, cb) => {
    const session = getSession(code);
    if (!isFacilitator(session, token)) return ack(cb, { ok: false });
    if (session.status !== "running") return ack(cb, { ok: false });
    startRoundTimer(session);
    broadcast(session);
    ack(cb, { ok: true });
  });

  socket.on("nextRound", ({ code, token } = {}, cb) => {
    const session = getSession(code);
    if (!isFacilitator(session, token)) return ack(cb, { ok: false });
    if (session.status !== "running") return ack(cb, { ok: false });
    if (session.currentRound >= session.rounds.length) {
      session.status = "finished";
      session.timer = { running: false, endsAt: null, remainingMs: null };
      clearTimer(session.code);
    } else {
      session.currentRound += 1;
      startRoundTimer(session);
    }
    broadcast(session);
    ack(cb, { ok: true });
  });

  socket.on("finishWorkshop", ({ code, token } = {}, cb) => {
    const session = getSession(code);
    if (!isFacilitator(session, token)) return ack(cb, { ok: false });
    session.status = "finished";
    session.timer = { running: false, endsAt: null, remainingMs: null };
    clearTimer(session.code);
    broadcast(session);
    ack(cb, { ok: true });
  });

  socket.on("resetWorkshop", ({ code, token, keepParticipants } = {}, cb) => {
    const session = getSession(code);
    if (!isFacilitator(session, token)) return ack(cb, { ok: false });
    session.status = "lobby";
    session.currentRound = 0;
    session.order = [];
    session.sheets = [];
    session.timer = { running: false, endsAt: null, remainingMs: null };
    clearTimer(session.code);
    if (!keepParticipants) session.participants = {};
    broadcast(session);
    ack(cb, { ok: true });
  });

  // ---- Aporte del participante ----
  socket.on("updateContribution", ({ code, participantId, text } = {}, cb) => {
    const session = getSession(code);
    if (!session || session.status !== "running")
      return ack(cb, { ok: false });
    const p = session.participants[participantId];
    if (!p) return ack(cb, { ok: false });

    // solo se escribe con el timer corriendo (con 1s de gracia)
    const running =
      session.timer.running &&
      session.timer.endsAt &&
      Date.now() < session.timer.endsAt + 1000;
    if (!running) return ack(cb, { ok: false, error: "La ronda no está activa." });

    const n = session.order.length;
    const pIndex = session.order.indexOf(participantId);
    if (pIndex < 0) return ack(cb, { ok: false }); // no está en la rotación
    const sIndex = sheetIndexFor(pIndex, session.currentRound, n);
    const sheet = session.sheets[sIndex];
    if (!sheet) return ack(cb, { ok: false });

    let contrib = contributionFor(sheet, session.currentRound, participantId);
    const clean = String(text || "").slice(0, 4000);
    if (contrib) {
      contrib.text = clean;
      contrib.updatedAt = Date.now();
    } else {
      contrib = {
        round: session.currentRound,
        participantId,
        name: p.name,
        text: clean,
        updatedAt: Date.now(),
      };
      sheet.contributions.push(contrib);
    }
    broadcast(session);
    ack(cb, { ok: true });
  });

  socket.on("disconnect", () => {
    const { code, participantId, role } = socket.data;
    if (role === "participant" && code && participantId) {
      const session = getSession(code);
      if (session && session.participants[participantId]) {
        session.participants[participantId].connected = false;
        broadcast(session);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Brainwriting escuchando en http://localhost:${PORT}`);
});
