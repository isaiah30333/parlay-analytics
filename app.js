/* Parlay Analytics — static app, no build step.
   Data: ESPN public site API (CORS-enabled). */

const API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const STORE_KEY = "parlay-analytics:v1";
const REFRESH_MS = 20000;

// Prop stats. `parts` are box-score columns that get added together.
const STATS = {
  PTS: { label: "Points", parts: ["PTS"] },
  REB: { label: "Rebounds", parts: ["REB"] },
  AST: { label: "Assists", parts: ["AST"] },
  "3PM": { label: "3-pointers made", parts: ["3PM"] },
  PRA: { label: "Pts + Reb + Ast", parts: ["PTS", "REB", "AST"] },
  PR: { label: "Pts + Reb", parts: ["PTS", "REB"] },
  PA: { label: "Pts + Ast", parts: ["PTS", "AST"] },
  RA: { label: "Reb + Ast", parts: ["REB", "AST"] },
  STL: { label: "Steals", parts: ["STL"] },
  BLK: { label: "Blocks", parts: ["BLK"] },
  SB: { label: "Steals + Blocks", parts: ["STL", "BLK"] },
  TO: { label: "Turnovers", parts: ["TO"] },
};

// ---------- state ----------
let legs = loadLegs();
const games = {};      // gameId -> normalized game
let timer = null;

function loadLegs() {
  // A shared link (#p=...) wins over local storage.
  const m = location.hash.match(/^#p=(.+)$/);
  if (m) {
    try {
      const fromLink = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
      if (Array.isArray(fromLink)) return fromLink;
    } catch (_) { /* bad link, fall through */ }
  }
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (_) { return []; }
}
function saveLegs() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(legs)); } catch (_) {}
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtLine = (n) => (n > 0 ? "+" : "") + n;
const ymd = (d) => d.toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 10);

async function getJSON(url) {
  // No custom headers or cache modes: those trigger a CORS preflight that ESPN rejects.
  // A throwaway query param keeps the browser from serving a stale copy.
  const r = await fetch(url + (url.includes("?") ? "&" : "?") + "_=" + Date.now());
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function localDateStr(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return ymd(z);
}

// ---------- data: game summary ----------
async function fetchGame(gameId) {
  const d = await getJSON(`${API}/summary?event=${gameId}`);
  const comp = d.header.competitions[0];
  const st = comp.status;
  const teams = comp.competitors.map((c) => ({
    id: c.team.id,
    abbr: c.team.abbreviation,
    name: c.team.displayName,
    logo: c.team.logos?.[0]?.href || "",
    score: c.score != null ? Number(c.score) : 0,
    homeAway: c.homeAway,
  }));
  // Players: id -> { stats, onCourt, starter, dnp, teamId }
  const players = {};
  for (const tp of d.boxscore?.players || []) {
    const sec = tp.statistics?.[0];
    if (!sec) continue;
    const names = sec.names || sec.labels || [];
    for (const a of sec.athletes || []) {
      const raw = {};
      names.forEach((n, i) => (raw[n] = a.stats?.[i]));
      players[a.athlete.id] = {
        id: a.athlete.id,
        name: a.athlete.displayName,
        short: a.athlete.shortName,
        headshot: a.athlete.headshot?.href || "",
        teamId: tp.team.id,
        onCourt: !!a.active,
        starter: !!a.starter,
        dnp: !!a.didNotPlay || !a.stats?.length,
        reason: a.reason || "",
        raw,
        num: parseStats(raw),
      };
    }
  }
  return {
    id: gameId,
    state: st.type.state,            // pre | in | post
    detail: st.type.shortDetail || st.type.detail || "",
    date: comp.date,
    teams,
    players,
  };
}

function parseStats(raw) {
  const n = (v) => (v == null || v === "" || v === "--" ? 0 : Number(v) || 0);
  const made = (v) => n(String(v ?? "0-0").split("-")[0]);
  return {
    MIN: n(raw.MIN), PTS: n(raw.PTS), REB: n(raw.REB), AST: n(raw.AST),
    STL: n(raw.STL), BLK: n(raw.BLK), TO: n(raw.TO), PF: n(raw.PF),
    "3PM": made(raw["3PT"]),
  };
}

// ---------- grading ----------
// Returns { cls: won|lost|live|pending|push|void, label, current?, target? }
function grade(leg, g) {
  if (!g) return { cls: "pending", label: "Loading" };
  const startLabel = g.state === "pre" ? "Starts " + new Date(g.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const final = g.state === "post";

  if (leg.type === "ml" || leg.type === "spread") {
    const mine = g.teams.find((t) => t.id === leg.teamId);
    const opp = g.teams.find((t) => t.id !== leg.teamId);
    if (!mine || !opp) return { cls: "void", label: "Team not found" };
    if (g.state === "pre") return { cls: "pending", label: startLabel };
    const margin = mine.score - opp.score + (leg.type === "spread" ? leg.line : 0);
    if (final) return margin > 0 ? { cls: "won", label: "Won" } : margin < 0 ? { cls: "lost", label: "Lost" } : { cls: "push", label: "Push" };
    if (leg.type === "ml") {
      const d = mine.score - opp.score;
      return { cls: "live", label: d > 0 ? `Up ${d}` : d < 0 ? `Down ${-d}` : "Tied" };
    }
    return { cls: "live", label: margin > 0 ? `Covering by ${margin}` : margin < 0 ? `Short by ${-margin}` : "On the number" };
  }

  if (leg.type === "total") {
    const sum = g.teams.reduce((s, t) => s + t.score, 0);
    return overUnder(leg, sum, g, startLabel);
  }

  if (leg.type === "prop") {
    const p = g.players[leg.playerId];
    if (g.state === "pre" || !p) {
      if (final && !p) return { cls: "void", label: "Did not play" };
      return { cls: "pending", label: g.state === "pre" ? startLabel : "Not in box score yet", current: 0, target: leg.line };
    }
    if (final && p.dnp) return { cls: "void", label: "Did not play" };
    const val = STATS[leg.stat].parts.reduce((s, k) => s + (p.num[k] || 0), 0);
    return overUnder(leg, val, g, startLabel);
  }
  return { cls: "void", label: "Unknown bet" };
}

function overUnder(leg, val, g, startLabel) {
  const base = { current: val, target: leg.line };
  if (g.state === "pre") return { ...base, cls: "pending", label: startLabel };
  const final = g.state === "post";
  if (leg.side === "over") {
    if (val > leg.line) return { ...base, cls: "won", label: final ? "Won" : "Hit" };
    if (final) return { ...base, cls: val === leg.line ? "push" : "lost", label: val === leg.line ? "Push" : "Lost" };
    const need = Math.floor(leg.line) + 1 - val;
    return { ...base, cls: "live", label: `Needs ${need} more` };
  }
  // under
  if (val > leg.line) return { ...base, cls: "lost", label: "Lost" };
  if (final) return { ...base, cls: val === leg.line ? "push" : "won", label: val === leg.line ? "Push" : "Won" };
  return { ...base, cls: "live", label: `${+(leg.line - val).toFixed(1)} under` };
}

// ---------- rendering ----------
function pickText(leg, g) {
  const team = g?.teams.find((t) => t.id === leg.teamId);
  const tName = team?.name || leg.teamName || "Team";
  switch (leg.type) {
    case "ml": return `${tName} to win`;
    case "spread": return `${tName} ${fmtLine(leg.line)}`;
    case "total": return `Game total ${leg.side === "over" ? "over" : "under"} ${leg.line}`;
    case "prop": return `${leg.side === "over" ? "Over" : "Under"} ${leg.line} ${STATS[leg.stat].label.toLowerCase()}`;
  }
  return "";
}

function gameStrip(g) {
  if (!g) return "";
  const [a, b] = sortAwayHome(g.teams);
  return `<div class="gamestrip">
    <div class="score">
      <img src="${esc(a.logo)}" alt=""> ${esc(a.abbr)} <b>${g.state === "pre" ? "" : a.score}</b>
      <span class="muted">${g.state === "pre" ? "at" : "–"}</span>
      <b>${g.state === "pre" ? "" : b.score}</b> ${esc(b.abbr)} <img src="${esc(b.logo)}" alt="">
    </div>
    <div class="clock ${g.state}">${esc(g.detail)}</div>
  </div>`;
}

function sortAwayHome(teams) {
  return [...teams].sort((x, y) => (x.homeAway === "away" ? -1 : 1) - (y.homeAway === "away" ? -1 : 1));
}

function onFloor(g) {
  if (g.state !== "in") return "";
  const rows = sortAwayHome(g.teams).map((t) => {
    const five = Object.values(g.players).filter((p) => p.teamId === t.id && p.onCourt).map((p) => esc(p.short));
    return five.length ? `<div><b>${esc(t.abbr)} on the floor:</b> ${five.join(", ")}</div>` : "";
  }).join("");
  return rows ? `<div class="floor">${rows}</div>` : "";
}

function renderProp(leg, g, res) {
  const p = g?.players[leg.playerId];
  const face = p?.headshot || leg.headshot || "";
  let badge = "";
  if (p && g.state === "in") badge = p.onCourt ? `<span class="pill oncourt">On the floor</span>` : `<span class="pill">On the bench</span>`;
  else if (p && g.state === "post" && p.dnp) badge = `<span class="pill">DNP</span>`;

  const pct = res.target ? Math.min(100, (res.current / res.target) * 100) : 0;
  const progress = `<div class="progress">
      <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
      <div class="nums"><span><b>${res.current ?? 0}</b> ${esc(STATS[leg.stat].label.toLowerCase())}</span><span class="muted">line ${leg.line}</span></div>
    </div>`;

  let grid = "";
  if (p && !p.dnp) {
    const hl = new Set(STATS[leg.stat].parts);
    const cells = [
      ["MIN", p.raw.MIN], ["PTS", p.raw.PTS], ["REB", p.raw.REB], ["AST", p.raw.AST],
      ["3PM", p.raw["3PT"]], ["FG", p.raw.FG], ["FT", p.raw.FT], ["STL", p.raw.STL],
      ["BLK", p.raw.BLK], ["TO", p.raw.TO], ["PF", p.raw.PF], ["+/-", p.raw["+/-"]],
    ];
    grid = `<div class="statgrid">${cells.map(([k, v]) =>
      `<div class="stat ${hl.has(k) ? "hl" : ""}"><div class="k">${k}</div><div class="v">${esc(v ?? "0")}</div></div>`).join("")}</div>`;
  } else if (p && p.dnp && g.state !== "pre") {
    grid = `<p class="muted small">${esc(p.reason || "Has not played")}</p>`;
  }

  return `
    <div class="leg-head">
      ${face ? `<img class="face" src="${esc(face)}" alt="">` : ""}
      <div class="leg-title">
        <div class="name">${esc(p?.name || leg.playerName)}</div>
        <div class="pick">${esc(pickText(leg, g))}</div>
      </div>
      <div class="leg-right">
        <span class="pill ${res.cls}">${esc(res.label)}</span>
        ${badge}
      </div>
    </div>
    ${progress}
    ${grid}
    ${gameStrip(g)}`;
}

function renderTeamLeg(leg, g, res) {
  const mine = g?.teams.find((t) => t.id === leg.teamId);
  const head = `
    <div class="leg-head">
      ${mine?.logo ? `<img class="logo" src="${esc(mine.logo)}" alt="">` : ""}
      <div class="leg-title">
        <div class="name">${esc(leg.type === "total" ? gameName(g) : mine?.name || leg.teamName)}</div>
        <div class="pick">${esc(pickText(leg, g))}</div>
      </div>
      <div class="leg-right"><span class="pill ${res.cls}">${esc(res.label)}</span></div>
    </div>`;
  if (!g) return head;
  const [a, b] = sortAwayHome(g.teams);
  const team = (t) => `<div class="team ${t.id === leg.teamId ? "mine" : ""}">
      <img src="${esc(t.logo)}" alt=""><div class="abbr">${esc(t.abbr)}</div>
      <div class="pts">${g.state === "pre" ? "–" : t.score}</div></div>`;
  const totalLine = leg.type === "total" && g.state !== "pre"
    ? `<div class="muted small" style="text-align:center;margin-top:6px">Combined: <b style="color:var(--text)">${res.current}</b> (line ${leg.line})</div>` : "";
  return `${head}
    <div class="bigscore">${team(a)}<div class="clock ${g.state}">${esc(g.detail)}</div>${team(b)}</div>
    ${totalLine}
    ${onFloor(g)}`;
}

function gameName(g) {
  if (!g) return "Game";
  const [a, b] = sortAwayHome(g.teams);
  return `${a.abbr} at ${b.abbr}`;
}

function render() {
  const box = $("#legs");
  $("#empty").hidden = legs.length > 0;
  $("#clearBtn").hidden = legs.length === 0;
  $("#shareBtn").hidden = legs.length === 0;

  const results = legs.map((leg) => grade(leg, games[leg.gameId]));
  box.innerHTML = legs.map((leg, i) => {
    const g = games[leg.gameId];
    const res = results[i];
    const body = leg.type === "prop" ? renderProp(leg, g, res) : renderTeamLeg(leg, g, res);
    return `<article class="leg ${res.cls}" data-id="${leg.id}">
      <button class="remove" title="Remove leg" data-remove="${leg.id}" style="float:right">×</button>
      ${body}
    </article>`;
  }).join("");

  renderSummary(results);
}

function renderSummary(results) {
  const s = $("#summary");
  if (!results.length) { s.hidden = true; return; }
  const c = (k) => results.filter((r) => r.cls === k).length;
  const won = c("won"), lost = c("lost"), live = c("live"), pending = c("pending"), voided = c("void") + c("push");
  const counted = results.length - voided;
  let title;
  if (lost) title = "Parlay lost";
  else if (won === counted && counted > 0 && !live && !pending) title = "Parlay hit";
  else title = `${won} of ${counted} legs hit`;
  s.hidden = false;
  s.innerHTML = `<h2>${title}</h2><div class="pills">
    ${won ? `<span class="pill won">${won} hit</span>` : ""}
    ${live ? `<span class="pill live">${live} live</span>` : ""}
    ${pending ? `<span class="pill pending">${pending} not started</span>` : ""}
    ${lost ? `<span class="pill lost">${lost} lost</span>` : ""}
    ${voided ? `<span class="pill void">${voided} void/push</span>` : ""}
  </div>`;
}

// ---------- refresh loop ----------
async function refresh() {
  const ids = [...new Set(legs.map((l) => l.gameId))];
  await Promise.all(ids.map(async (id) => {
    try { games[id] = await fetchGame(id); } catch (e) { console.warn("game", id, e); }
  }));
  $("#updated").textContent = ids.length ? "Updated " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "";
  render();
  schedule();
}

function schedule() {
  clearTimeout(timer);
  const anyLive = legs.some((l) => {
    const g = games[l.gameId];
    return !g || g.state === "in" || (g.state === "pre" && new Date(g.date) - Date.now() < 15 * 60000);
  });
  timer = setTimeout(refresh, anyLive ? REFRESH_MS : 5 * 60000);
}

document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

// ---------- add-leg dialog ----------
const dlg = $("#addDialog");
let sel = { game: null, type: "prop", rosters: [] };

function openDialog() {
  if (!$("#dateInput").value) $("#dateInput").value = localDateStr();
  sel = { game: null, type: "prop", rosters: [] };
  $("#typeStep").hidden = true;
  $("#saveLeg").disabled = true;
  $("#formErr").textContent = "";
  setType("prop");
  loadGames();
  dlg.showModal();
}

async function loadGames() {
  const list = $("#gameList");
  list.innerHTML = `<p class="muted small">Loading games…</p>`;
  const date = $("#dateInput").value.replaceAll("-", "");
  try {
    const d = await getJSON(`${API}/scoreboard?dates=${date}`);
    if (!d.events?.length) { list.innerHTML = `<p class="muted small">No NBA games on this date.</p>`; return; }
    list.innerHTML = d.events.map((e) => {
      const c = e.competitions[0];
      const [a, h] = sortAwayHome(c.competitors.map((x) => ({ ...x, id: x.team.id })));
      const st = e.status.type;
      const right = st.state === "pre"
        ? new Date(e.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : `${a.score}–${h.score} · ${st.shortDetail}`;
      const payload = esc(JSON.stringify({
        id: e.id,
        teams: [a, h].map((t) => ({ id: t.team.id, name: t.team.displayName, abbr: t.team.abbreviation })),
      }));
      return `<button type="button" class="game-opt" data-game="${payload}">
        <span class="teams"><img src="${esc(a.team.logo)}" alt="">${esc(a.team.abbreviation)} <span class="muted">at</span>
        <img src="${esc(h.team.logo)}" alt="">${esc(h.team.abbreviation)}</span>
        <span class="muted small">${esc(right)}</span></button>`;
    }).join("");
  } catch (e) {
    list.innerHTML = `<p class="err small">Couldn't load games. Check your connection and try again.</p>`;
  }
}

async function chooseGame(btn) {
  document.querySelectorAll(".game-opt").forEach((b) => b.classList.toggle("sel", b === btn));
  sel.game = JSON.parse(btn.dataset.game);
  $("#typeStep").hidden = false;
  $("#teamSel").innerHTML = sel.game.teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("");
  $("#playerSel").innerHTML = `<option value="">Loading players…</option>`;
  validate();
  try {
    sel.rosters = await Promise.all(sel.game.teams.map(async (t) => {
      const r = await getJSON(`${API}/teams/${t.id}/roster`);
      return { team: t, players: (r.athletes || []).map((a) => ({ id: a.id, name: a.displayName, pos: a.position?.abbreviation || "", headshot: a.headshot?.href || "" })) };
    }));
    $("#playerSel").innerHTML = `<option value="">Choose a player</option>` + sel.rosters.map((r) =>
      `<optgroup label="${esc(r.team.name)}">${r.players.sort((x, y) => x.name.localeCompare(y.name))
        .map((p) => `<option value="${p.id}">${esc(p.name)}${p.pos ? " · " + esc(p.pos) : ""}</option>`).join("")}</optgroup>`).join("");
  } catch (e) {
    $("#playerSel").innerHTML = `<option value="">Couldn't load players</option>`;
  }
  validate();
}

function setType(type) {
  sel.type = type;
  document.querySelectorAll("#typeTabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.type === type));
  document.querySelectorAll(".fields label").forEach((l) => (l.hidden = !l.dataset.for.split(" ").includes(type)));
  const hints = {
    prop: "Tip: \"5 or more threes\" is Over 4.5.",
    ml: "",
    spread: "Use a minus line for the favorite, e.g. -6.5. Plus for the underdog, e.g. +6.5.",
    total: "Combined points for both teams.",
  };
  $("#formHint").textContent = hints[type];
  validate();
}

function validate() {
  const err = $("#formErr");
  err.textContent = "";
  let ok = !!sel.game;
  const line = $("#lineInput").value;
  if (sel.type === "prop") ok = ok && !!$("#playerSel").value && line !== "";
  if (sel.type === "spread" || sel.type === "total") ok = ok && line !== "";
  $("#saveLeg").disabled = !ok;
  return ok;
}

function buildLeg() {
  const leg = { id: uid(), type: sel.type, gameId: sel.game.id };
  const line = parseFloat($("#lineInput").value);
  if (sel.type === "ml" || sel.type === "spread") {
    const t = sel.game.teams.find((x) => x.id === $("#teamSel").value);
    leg.teamId = t.id; leg.teamName = t.name;
  }
  if (sel.type === "spread") leg.line = line;
  if (sel.type === "total") { leg.line = line; leg.side = $("#sideSel").value; }
  if (sel.type === "prop") {
    const pid = $("#playerSel").value;
    const p = sel.rosters.flatMap((r) => r.players).find((x) => x.id === pid);
    Object.assign(leg, { playerId: pid, playerName: p?.name || "", headshot: p?.headshot || "", stat: $("#statSel").value, side: $("#sideSel").value, line });
  }
  return leg;
}

$("#statSel").innerHTML = Object.entries(STATS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");

$("#addBtn").onclick = openDialog;
$("#closeDlg").onclick = $("#cancelDlg").onclick = () => dlg.close();
$("#dateInput").onchange = loadGames;
const shiftDay = (n) => {
  const d = new Date($("#dateInput").value + "T12:00:00");
  d.setDate(d.getDate() + n);
  $("#dateInput").value = ymd(d);
  loadGames();
};
$("#prevDay").onclick = () => shiftDay(-1);
$("#nextDay").onclick = () => shiftDay(1);
$("#gameList").onclick = (e) => { const b = e.target.closest(".game-opt"); if (b) chooseGame(b); };
$("#typeTabs").onclick = (e) => { const t = e.target.closest(".tab"); if (t) setType(t.dataset.type); };
["#playerSel", "#lineInput", "#teamSel", "#statSel", "#sideSel"].forEach((s) => $(s).addEventListener("input", validate));

$("#addForm").onsubmit = (e) => {
  e.preventDefault();
  if (!validate()) return;
  legs.push(buildLeg());
  saveLegs();
  dlg.close();
  render();
  refresh();
};

$("#legs").onclick = (e) => {
  const id = e.target.dataset?.remove;
  if (!id) return;
  legs = legs.filter((l) => l.id !== id);
  saveLegs();
  render();
};
$("#clearBtn").onclick = () => {
  if (!confirm("Remove every leg from this parlay?")) return;
  legs = [];
  saveLegs();
  render();
};
$("#refreshBtn").onclick = refresh;
$("#shareBtn").onclick = async () => {
  const code = btoa(unescape(encodeURIComponent(JSON.stringify(legs))));
  const url = `${location.origin}${location.pathname}#p=${code}`;
  try { await navigator.clipboard.writeText(url); $("#shareBtn").textContent = "Link copied"; }
  catch (_) { prompt("Copy this link:", url); }
  setTimeout(() => ($("#shareBtn").textContent = "Share"), 2000);
};

// ---------- start ----------
if (location.hash.startsWith("#p=")) { try { localStorage.setItem(STORE_KEY, JSON.stringify(legs)); } catch (_) {} }
render();
if (legs.length) refresh();
