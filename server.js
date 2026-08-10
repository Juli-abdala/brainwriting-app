/**
 * Brainwriting en vivo — servidor
 * Momento 2 · Ideación
 *
 * Node + Express + Socket.IO. Estado en memoria (una instancia).
 * Flujo: lobby → priorización de necesidades → asignación al azar → brainwriting → resultados.
 */

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// index.html sin caché para que las actualizaciones se vean siempre
app.use((req, res, next) => {
  if (req.path === "/" || req.path.endsWith("index.html")) {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  }
  next();
});
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true }));

const sessions = new Map();

const DEFAULT_ROUNDS = [
  { label: "Ronda 1 — generar", minutes: 4, prompt: "Escribí 3 ideas de herramienta o servicio que respondan a esta necesidad. Concretas, y por ahora sin preocuparse por la factibilidad ni por el nivel de desarrollo. En silencio." },
  { label: "Ronda 2 — construir", minutes: 4, prompt: "Se pasa la hoja a la derecha. Construí sobre alguna de las ideas que te llegaron: llevala más lejos, combinala, hacela más específica, o pensá qué le falta." },
  { label: "Ronda 3 — construir", minutes: 4, prompt: "Se pasa otra vez, con la misma consigna. La hoja ya tiene capas de aporte, así que lo que se agrega ahora se apoya en algo más enriquecido." },
  { label: "Ronda 4 — construir", minutes: 4, prompt: "Última pasada. Cerrá y potenciá: quedate con lo más prometedor de la hoja y dejá tu mejor aporte para dejarla lista para la siguiente etapa." },
];

const DEFAULT_NEEDS_POOL = [
  { area: "Estrategia y Planeación", text: "El volumen crece poco mientras el retail gana poder (private label, datos propios)" },
  { area: "Estrategia y Planeación", text: "El portafolio de SKUs está inflado y destruye margen" },
  { area: "Estrategia y Planeación", text: "La IA está cambiando cómo el consumidor descubre y compra (agentic commerce, chatbots), y el go-to-market no se adaptó" },
  { area: "Estrategia y Planeación", text: "La entrada a nuevos canales o mercados no tiene criterios claros de pricing ni inversión" },
  { area: "Estrategia y Planeación", text: "Las grandes decisiones de capex (planta, M&A, distribución) se evalúan sin alternativas comparables" },
  { area: "Estrategia y Planeación", text: "Los casos de negocio de alto impacto presentan supuestos débiles de costo y demanda como si fueran certeros" },
  { area: "Estrategia y Planeación", text: "La lentitud para aprobar cierra la ventana de valor en capex, M&A o entrada a mercado" },
  { area: "Finanzas y Contabilidad", text: "El Trade Spend es la segunda línea del P&L y la menos controlada" },
  { area: "Finanzas y Contabilidad", text: "Conciliar deducciones y cargos del retail trae sorpresas todos los meses" },
  { area: "Finanzas y Contabilidad", text: "La rentabilidad por cuenta y canal se conoce tarde" },
  { area: "I+D/Innovación", text: "La tasa de éxito de los lanzamientos es baja y cara" },
  { area: "I+D/Innovación", text: "Reformular por regulación (etiquetado, azúcar, aditivos) tiene un costo alto" },
  { area: "I+D/Innovación", text: "La innovación incremental canibaliza ventas sin sumar margen" },
  { area: "IT/Transformación Digital", text: "Los pilotos de IA no escalan y su gobernanza está dispersa (el ownership está en tech, no en el negocio)" },
  { area: "IT/Transformación Digital", text: "Los datos de sell-out están fragmentados entre cadenas y distribuidores" },
  { area: "Marketing y Ventas", text: "El RGM define lineamientos que la urgencia trimestral termina anulando" },
  { area: "Marketing y Ventas", text: "Promociones e inversión publicitaria corren sin medir bien su retorno (uplift, atribución)" },
  { area: "Marketing y Ventas", text: "El pricing y las condiciones comerciales varían entre cuentas, países y KAMs sin un playbook común, y se negocian más por relación que por dato" },
  { area: "Marketing y Ventas", text: "El ciclo de decisión comercial es lento por reportes manuales y análisis ad-hoc" },
  { area: "Marketing y Ventas", text: "El assortment es igual en todas las tiendas de un formato, sin ajustarse al sell-out local" },
  { area: "Producción/Operaciones", text: "El OEE está por debajo del potencial por demasiados changeovers" },
  { area: "Producción/Operaciones", text: "Hay paros no programados y el mantenimiento es reactivo" },
  { area: "Producción/Operaciones", text: "Las mermas y el desperdicio son altos en categorías de vencimiento corto" },
  { area: "Producción/Operaciones", text: "Los proyectos de mejora continua (Lean, Kaizen, TPM) capturan valor pero se diluyen antes del año" },
  { area: "RRHH", text: "La estructura comercial creció más rápido que la capacidad de coordinarla" },
  { area: "RRHH", text: "Hay alta rotación en mandos medios (“acá no se decide nada”)" },
  { area: "RRHH", text: "La fuerza de ventas no tiene las habilidades para vender con datos" },
  { area: "RRHH", text: "La estrategia no arranca porque nadie tiene ownership claro de la ejecución, ni siquiera después de reorganizar" },
  { area: "RRHH", text: "Las decisiones son lentas: escalan hasta el Country Manager, se revalidan varias veces y los comités debaten sin decidir" },
  { area: "RRHH", text: "La presión por eficiencia no tiene un criterio claro de qué cortar y qué proteger" },
  { area: "Servicio/Atención al cliente", text: "El OTIF se penaliza por quiebres en categorías clave" },
  { area: "Servicio/Atención al cliente", text: "La atención B2B a clientes y distribuidores es manual" },
  { area: "Servicio/Atención al cliente", text: "Gestionar reclamos y devoluciones es costoso" },
  { area: "Supply Chain/Logística", text: "El S&OP informa pero no decide los trade-offs" },
  { area: "Supply Chain/Logística", text: "El forecast tiene MAPE alto y sesgo sistemático" },
  { area: "Supply Chain/Logística", text: "Los inventarios están 25-40% sobre benchmark y hay obsolescencia" },
  { area: "Supply Chain/Logística", text: "Los buffers de almacén están sobredimensionados" },
  { area: "Supply Chain/Logística", text: "El costo de última milla crece por el picking manual y las entregas fraccionadas" },
];

function code4() {
  const ab = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let c = ""; for (let i = 0; i < 4; i++) c += ab[crypto.randomInt(ab.length)];
  return c;
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function newSession() {
  let code; do { code = code4(); } while (sessions.has(code));
  const session = {
    code,
    facilitatorToken: crypto.randomBytes(16).toString("hex"),
    rounds: DEFAULT_ROUNDS.map((r) => ({ ...r })),
    needsPool: DEFAULT_NEEDS_POOL.map((n) => ({ ...n })),
    selectedNeeds: [],
    status: "lobby", // lobby | running | results
    currentRound: 0,
    order: [],
    participants: {},
    sheets: [],
    timer: { running: false, endsAt: null, remainingMs: null },
    resultsView: "mural",
    votesPerPerson: 3,
    votingOpen: false,
    votes: {},
    matrix: {},
    createdAt: Date.now(),
  };
  sessions.set(code, session);
  return session;
}
function normalizeRounds(rounds) {
  if (!Array.isArray(rounds) || rounds.length === 0) return DEFAULT_ROUNDS.map((r) => ({ ...r }));
  return rounds.slice(0, 12).map((r, i) => ({
    label: String(r.label || DEFAULT_ROUNDS[i]?.label || `Ronda ${i + 1}`),
    minutes: clampMinutes(r.minutes),
    prompt: String(r.prompt || DEFAULT_ROUNDS[i]?.prompt || DEFAULT_ROUNDS[DEFAULT_ROUNDS.length - 1].prompt),
  }));
}
function clampMinutes(m) { const n = Number(m); if (!isFinite(n) || n <= 0) return 4; return Math.min(60, Math.max(1, Math.round(n * 100) / 100)); }
function sheetIndexFor(p, r, n) { return (((p - (r - 1)) % n) + n) % n; }

function publicState(session) {
  const n = session.order.length;
  return {
    code: session.code,
    rounds: session.rounds,
    needsPool: session.needsPool,
    selectedNeeds: session.selectedNeeds,
    status: session.status,
    currentRound: session.currentRound,
    totalRounds: session.rounds.length,
    order: session.order,
    participants: Object.values(session.participants).map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
    sheets: session.sheets.map((s) => ({ id: s.id, need: s.need, contributions: s.contributions })),
    timer: session.timer,
    resultsView: session.resultsView,
    votesPerPerson: session.votesPerPerson,
    votingOpen: session.votingOpen,
    votes: session.votes,
    voteTally: voteTally(session),
    matrix: session.matrix,
    holdings: session.status === "running" && n > 0
      ? session.order.map((pid, p) => ({ participantId: pid, sheetIndex: sheetIndexFor(p, session.currentRound, n) }))
      : [],
    serverNow: Date.now(),
  };
}
function broadcast(session) { io.to(session.code).emit("state", publicState(session)); }

const timers = new Map();
function startRoundTimer(session) {
  const round = session.rounds[session.currentRound - 1];
  const durationMs = Math.round(round.minutes * 60 * 1000);
  session.timer = { running: true, endsAt: Date.now() + durationMs, remainingMs: durationMs };
  scheduleExpiry(session);
}
function scheduleExpiry(session) {
  clearTimer(session.code);
  if (!session.timer.running || !session.timer.endsAt) return;
  const ms = Math.max(0, session.timer.endsAt - Date.now());
  const handle = setTimeout(() => {
    session.timer.running = false; session.timer.endsAt = null; session.timer.remainingMs = 0; broadcast(session);
  }, ms + 50);
  timers.set(session.code, handle);
}
function clearTimer(code) { const h = timers.get(code); if (h) clearTimeout(h); timers.delete(code); }
function pauseTimer(session) { if (!session.timer.running) return; const rem = Math.max(0, (session.timer.endsAt || 0) - Date.now()); session.timer = { running: false, endsAt: null, remainingMs: rem }; clearTimer(session.code); }
function resumeTimer(session) { if (session.timer.running) return; const rem = session.timer.remainingMs || 0; if (rem <= 0) return; session.timer = { running: true, endsAt: Date.now() + rem, remainingMs: rem }; scheduleExpiry(session); }

function isFacilitator(session, token) { return session && token && session.facilitatorToken === token; }
function getSession(code) { return sessions.get(String(code || "").toUpperCase()); }
function contributionFor(sheet, round, pid) { return sheet.contributions.find((c) => c.round === round && c.participantId === pid); }
function voteTally(session) {
  const t = {}; session.sheets.forEach((s) => (t[s.id] = 0));
  Object.values(session.votes || {}).forEach((list) => (list || []).forEach((sid) => { if (sid in t) t[sid] += 1; }));
  return t;
}
function finishToResults(session) {
  session.status = "results"; session.resultsView = "mural";
  session.timer = { running: false, endsAt: null, remainingMs: null }; clearTimer(session.code);
}

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, s] of sessions) if (s.createdAt < cutoff && Object.keys(s.participants).length === 0) { clearTimer(code); sessions.delete(code); }
}, 30 * 60 * 1000);

io.on("connection", (socket) => {
  socket.data = { role: null, code: null, participantId: null };
  const ack = (cb, p) => { if (typeof cb === "function") cb(p); };

  socket.on("createSession", (_p = {}, cb) => {
    const s = newSession(); socket.data.role = "facilitator"; socket.data.code = s.code; socket.join(s.code);
    ack(cb, { ok: true, code: s.code, facilitatorToken: s.facilitatorToken, state: publicState(s) });
  });
  socket.on("facilitatorRejoin", ({ code, token } = {}, cb) => {
    const s = getSession(code); if (!isFacilitator(s, token)) return ack(cb, { ok: false, error: "Sesión o clave inválida." });
    socket.data.role = "facilitator"; socket.data.code = s.code; socket.join(s.code);
    ack(cb, { ok: true, state: publicState(s) });
  });
  socket.on("joinSession", ({ code, name, participantId } = {}, cb) => {
    const s = getSession(code); if (!s) return ack(cb, { ok: false, error: "No existe una sala con ese código." });
    if (participantId && s.participants[participantId]) {
      const p = s.participants[participantId]; p.connected = true; if (name && name.trim()) p.name = name.trim().slice(0, 40);
      socket.data.role = "participant"; socket.data.code = s.code; socket.data.participantId = participantId; socket.join(s.code);
      broadcast(s); return ack(cb, { ok: true, participantId, state: publicState(s) });
    }
    if (s.status !== "lobby") return ack(cb, { ok: false, error: "El taller ya arrancó. Pedile al facilitador que te sume." });
    const name2 = String(name || "").trim().slice(0, 40); if (!name2) return ack(cb, { ok: false, error: "Ingresá tu nombre." });
    const id = crypto.randomBytes(8).toString("hex");
    s.participants[id] = { id, name: name2, connected: true };
    socket.data.role = "participant"; socket.data.code = s.code; socket.data.participantId = id; socket.join(s.code);
    broadcast(s); ack(cb, { ok: true, participantId: id, state: publicState(s) });
  });

  socket.on("setSelectedNeeds", ({ code, token, needs } = {}, cb) => {
    const s = getSession(code); if (!isFacilitator(s, token)) return ack(cb, { ok: false });
    if (s.status !== "lobby") return ack(cb, { ok: false });
    s.selectedNeeds = Array.isArray(needs) ? [...new Set(needs.map((t) => String(t || "").trim()).filter(Boolean))].slice(0, 20) : [];
    broadcast(s); ack(cb, { ok: true });
  });
  socket.on("addCustomNeed", ({ code, token, text } = {}, cb) => {
    const s = getSession(code); if (!isFacilitator(s, token)) return ack(cb, { ok: false });
    if (s.status !== "lobby") return ack(cb, { ok: false });
    const t = String(text || "").trim().slice(0, 240); if (!t) return ack(cb, { ok: false });
    if (!s.needsPool.some((n) => n.text === t)) s.needsPool.push({ area: "Agregada", text: t });
    if (!s.selectedNeeds.includes(t)) s.selectedNeeds.push(t);
    broadcast(s); ack(cb, { ok: true });
  });
  socket.on("setRounds", ({ code, token, rounds } = {}, cb) => {
    const s = getSession(code); if (!isFacilitator(s, token)) return ack(cb, { ok: false });
    if (s.status !== "lobby") return ack(cb, { ok: false, error: "Solo antes de arrancar." });
    s.rounds = normalizeRounds(rounds); broadcast(s); ack(cb, { ok: true });
  });
  socket.on("removeParticipant", ({ code, token, participantId } = {}, cb) => {
    const s = getSession(code); if (!isFacilitator(s, token)) return ack(cb, { ok: false });
    if (s.status !== "lobby") return ack(cb, { ok: false });
    delete s.participants[participantId]; broadcast(s); ack(cb, { ok: true });
  });

  socket.on("startWorkshop", ({ code, token } = {}, cb) => {
    const s = getSession(code); if (!isFacilitator(s, token)) return ack(cb, { ok: false });
    const ids = Object.keys(s.participants);
    if (ids.length < 2) return ack(cb, { ok: false, error: "Necesitás al menos 2 participantes." });
    if (!s.selectedNeeds.length) return ack(cb, { ok: false, error: "Elegí al menos una necesidad." });
    const chosen = shuffle(s.selectedNeeds.slice());
    s.order = shuffle(ids.slice());
    s.sheets = s.order.map((_, i) => ({ id: "hoja-" + (i + 1), need: chosen[i % chosen.length], contributions: [] }));
    s.status = "running"; s.currentRound = 1; startRoundTimer(s); broadcast(s); ack(cb, { ok: true });
  });

  socket.on("pauseTimer", ({ code, token } = {}, cb) => { const s = getSession(code); if (!isFacilitator(s, token)) return ack(cb, { ok: false }); pauseTimer(s); broadcast(s); ack(cb, { ok: true }); });
  socket.on("resumeTimer", ({ code, token } = {}, cb) => { const s = getSession(code); if (!isFacilitator(s, token)) return ack(cb, { ok: false }); resumeTimer(s); broadcast(s); ack(cb, { ok: true }); });
  socket.on("restartRoundTimer", ({ code, token } = {}, cb) => { const s = getSession(code); if (!isFacilitator(s, token)) return ack(cb, { ok: false }); if (s.status !== "running") return ack(cb, { ok: false }); startRoundTimer(s); broadcast(s); ack(cb, { ok: true }); });
  socket.on("nextRound", ({ code, token } = {}, cb) => {
    const s = getSession(code); if (!isFacilitator(s, token)) return ack(cb, { ok: false });
    if (s.status !== "running") return ack(cb, { ok: false });
    if (s.currentRound >= s.rounds.length) finishToResults(s);
    else { s.currentRound += 1; startRoundTimer(s); }
    broadcast(s); ack(cb, { ok: true });
  });
  socket.on("finishWorkshop", ({ code, token } = {}, cb) => { const s = getSession(code); if (!isFacilitator(s, token)) return ack(cb, { ok: false }); finishToResults(s); broadcast(s); ack(cb, { ok: true }); });
  socket.on("resetWorkshop", ({ code, token, keepParticipants } = {}, cb) => {
    const s = getSession(code); if (!isFacilitator(s, token)) return ack(cb, { ok: false });
    s.status = "lobby"; s.currentRound = 0; s.order = []; s.sheets = [];
    s.timer = { running: false, endsAt: null, remainingMs: null };
    s.resultsView = "mural"; s.votingOpen = false; s.votes = {}; s.matrix = {};
    clearTimer(s.code); if (!keepParticipants) s.participants = {};
    broadcast(s); ack(cb, { ok: true });
  });

  socket.on("updateContribution", ({ code, participantId, text } = {}, cb) => {
    const s = getSession(code); if (!s || s.status !== "running") return ack(cb, { ok: false });
    const p = s.participants[participantId]; if (!p) return ack(cb, { ok: false });
    const running = s.timer.running && s.timer.endsAt && Date.now() < s.timer.endsAt + 1000;
    if (!running) return ack(cb, { ok: false, error: "La ronda no está activa." });
    const n = s.order.length; const pIndex = s.order.indexOf(participantId); if (pIndex < 0) return ack(cb, { ok: false });
    const sheet = s.sheets[sheetIndexFor(pIndex, s.currentRound, n)]; if (!sheet) return ack(cb, { ok: false });
    let contrib = contributionFor(sheet, s.currentRound, participantId); const clean = String(text || "").slice(0, 4000);
    if (contrib) { contrib.text = clean; contrib.updatedAt = Date.now(); }
    else { sheet.contributions.push({ round: s.currentRound, participantId, name: p.name, text: clean, updatedAt: Date.now() }); }
    broadcast(s); ack(cb, { ok: true });
  });

  socket.on("setResultsView", ({ code, token, view } = {}, cb) => {
    const s = getSession(code); if (!isFacilitator(s, token)) return ack(cb, { ok: false });
    if (s.status !== "results") return ack(cb, { ok: false });
    if (["mural", "vote", "matrix", "skeptic"].includes(view)) s.resultsView = view;
    broadcast(s); ack(cb, { ok: true });
  });
  socket.on("setVotingOpen", ({ code, token, open } = {}, cb) => { const s = getSession(code); if (!isFacilitator(s, token)) return ack(cb, { ok: false }); s.votingOpen = !!open; broadcast(s); ack(cb, { ok: true }); });
  socket.on("setVotesPerPerson", ({ code, token, n } = {}, cb) => {
    const s = getSession(code); if (!isFacilitator(s, token)) return ack(cb, { ok: false });
    const v = Math.min(10, Math.max(1, parseInt(n, 10) || 3)); s.votesPerPerson = v;
    Object.keys(s.votes).forEach((pid) => { if (s.votes[pid].length > v) s.votes[pid] = s.votes[pid].slice(0, v); });
    broadcast(s); ack(cb, { ok: true });
  });
  socket.on("castVote", ({ code, participantId, sheetId } = {}, cb) => {
    const s = getSession(code); if (!s || s.status !== "results") return ack(cb, { ok: false });
    if (!s.votingOpen) return ack(cb, { ok: false, error: "La votación está cerrada." });
    if (!s.participants[participantId]) return ack(cb, { ok: false });
    if (!s.sheets.some((x) => x.id === sheetId)) return ack(cb, { ok: false });
    const cur = s.votes[participantId] || []; const idx = cur.indexOf(sheetId);
    if (idx >= 0) cur.splice(idx, 1);
    else { if (cur.length >= s.votesPerPerson) return ack(cb, { ok: false, error: "Ya usaste todos tus votos." }); cur.push(sheetId); }
    s.votes[participantId] = cur; broadcast(s); ack(cb, { ok: true });
  });
  socket.on("setMatrixPos", ({ code, token, sheetId, x, y } = {}, cb) => {
    const s = getSession(code); if (!isFacilitator(s, token)) return ack(cb, { ok: false });
    if (!s.sheets.some((x2) => x2.id === sheetId)) return ack(cb, { ok: false });
    if (x === null || y === null) delete s.matrix[sheetId];
    else { const cx = Math.min(1, Math.max(0, Number(x))); const cy = Math.min(1, Math.max(0, Number(y))); if (isFinite(cx) && isFinite(cy)) s.matrix[sheetId] = { x: cx, y: cy }; }
    broadcast(s); ack(cb, { ok: true });
  });

  socket.on("disconnect", () => {
    const { code, participantId, role } = socket.data;
    if (role === "participant" && code && participantId) {
      const s = getSession(code);
      if (s && s.participants[participantId]) { s.participants[participantId].connected = false; broadcast(s); }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Brainwriting escuchando en http://localhost:${PORT}`));
