/* =====================================================================
   DASHBOARDS — user-built boards of panels. Each panel = a data source
   (scores, odds, standings, team results, player game log, player
   comparison, team leaders, my parlay, note) + a visualization (table,
   bar, line, big number, cards, list). Saved in the browser; shareable.
   Data: ESPN's public APIs (same rules as app.js: no fetch headers,
   cache-buster is "pa=", never "_=<timestamp>").
   ===================================================================== */
(function () {
  "use strict";

  const API = "https://site.api.espn.com/apis/site/v2/sports/";
  const STD = "https://site.api.espn.com/apis/v2/sports/";
  const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/";
  const WEB2 = "https://site.web.api.espn.com/apis/site/v2/sports/";
  const STORE = "pa-dashboards:v1";
  const SPORTS = window.SPORTS, FAMILIES = window.FAMILIES;

  // ---------------------------------------------------------------- helpers
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  };
  const ymdLocal = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const num0 = (v) => parseFloat(String(v ?? "").replace(/,/g, "")) || 0;
  const numOrNull = (v) => { const n = parseFloat(String(v ?? "").replace(/,/g, "").replace(/^\+/, "")); return isFinite(n) ? n : null; };
  const fmtOdds = (a) => (a == null || isNaN(a) ? "" : a > 0 ? "+" + a : String(a));
  const fmtNum = (n) => (n == null || isNaN(n) ? "–" : Math.abs(n) >= 100 ? Math.round(n).toLocaleString() : Math.abs(n) >= 10 ? +n.toFixed(1) : +n.toFixed(2));
  const fmtWhen = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return ymdLocal(d) === ymdLocal() ? t : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + ", " + t;
  };
  const shortDate = (iso) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

  async function getJSON(url) {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "pa=" + Date.now().toString(36));
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  // cache with a time-to-live; stale data stays on screen while a refresh is in flight
  const cache = {};
  function load(url, ttl = 120000) {
    let c = cache[url];
    if (c && (c.busy || (c.data && Date.now() - c.at < ttl))) return c;
    const prev = c;
    c = cache[url] = { at: Date.now(), data: prev?.data, err: false, busy: true };
    c.p = getJSON(url).then((d) => { c.data = d; c.at = Date.now(); c.busy = false; return d; },
      (e) => { c.err = !c.data; c.busy = false; throw e; });
    c.p.catch(() => {});
    return c;
  }

  // ---------------------------------------------------------------- leagues
  const LEAGUES = SPORTS.filter((s) => s.kind === "team").flatMap((s) =>
    s.leagues ? s.leagues.map((l, i) => ({ id: `${s.key}|${i}`, label: l.label, path: l.path, sport: s, logo: l.logo || s.logo }))
      : [{ id: `${s.key}|0`, label: s.label, path: s.path, sport: s, logo: s.logo }]);
  const lgOf = (id) => LEAGUES.find((l) => l.id === id) || LEAGUES.find((l) => l.id === "nba|0");
  const famOf = (lg) => FAMILIES[lg.sport.family];
  const groupsQ = (lg, key) => (lg.sport.groups ? `${key}=${lg.sport.groups}` : "");

  // ---------------------------------------------------------- shared parsers
  function addVals(vals, k, v) {
    if (k === "innings" || k === "fullInnings.partInnings") {
      const [f, p] = String(v ?? "0").split(".");
      vals.outs = num0(f) * 3 + num0(p);
    }
    const sep = k.includes("/") ? "/" : k.includes("-") ? "-" : null;
    if (sep && String(v).includes(sep)) { const vs = String(v).split(sep); k.split(sep).forEach((kk, i) => (vals[kk] = num0(vs[i]))); }
    else vals[k] = num0(v);
  }
  const LOG_ALIAS = { rebounds: "totalRebounds" };
  function logVal(row, part) {
    const k = part.split(".").pop();
    if (row.vals[k] !== undefined) return row.vals[k];
    return LOG_ALIAS[k] ? row.vals[LOG_ALIAS[k]] : undefined;
  }
  function parseLog(d, prev) {
    const names = d.names || [];
    const rows = [], seen = new Set();
    (d.seasonTypes || []).forEach((st) => {
      if (/preseason|spring/i.test(st.displayName || "")) return;
      (st.categories || []).forEach((c) => (c.events || []).forEach((ev) => {
        if (!ev.eventId || seen.has(ev.eventId)) return;
        seen.add(ev.eventId);
        const meta = d.events?.[ev.eventId] || {};
        const raw = {}, vals = {};
        names.forEach((k, i) => { raw[k] = ev.stats?.[i]; addVals(vals, k, ev.stats?.[i]); });
        rows.push({ id: ev.eventId, date: meta.gameDate, atVs: meta.atVs || "", opp: meta.opponent || {}, result: meta.gameResult || "", score: meta.score || "", raw, vals, prev: !!prev });
      }));
    });
    return rows.sort((a, b) => new Date(b.date) - new Date(a.date));
  }
  // a player's games, newest first; adds last season when this one has fewer than `need`
  function playerRows(lg, pid, need = 10) {
    const cur = load(`${WEB}${lg.path}/athletes/${pid}/gamelog`, 300000);
    if (!cur.data) return cur.err ? { err: true } : { pending: cur };
    let rows = parseLog(cur.data);
    const so = (cur.data.filters || []).find((f) => f.name === "season");
    if (rows.length < need && so?.options?.length > 1) {
      const i = so.options.findIndex((o) => String(o.value) === String(so.value));
      const prev = i >= 0 ? so.options[i + 1] : null;
      if (prev) {
        const pc = load(`${WEB}${lg.path}/athletes/${pid}/gamelog?season=${prev.value}`, 3600000);
        if (!pc.data && !pc.err) return { pending: pc };
        if (pc.data) rows = rows.concat(parseLog(pc.data, true));
      }
    }
    return { rows, names: cur.data.names || [], labels: cur.data.labels || [] };
  }
  function standingsGroups(d, lg) {
    const out = [];
    const walk = (n) => {
      if (n.standings?.entries?.length) {
        const teams = n.standings.entries.map((e) => {
          const v = {}, dv = {};
          (e.stats || []).forEach((s) => { const k = s.name || s.type; v[k] = s.value; dv[k] = s.displayValue; });
          return {
            id: String(e.team.id), name: e.team.displayName, short: e.team.shortDisplayName || e.team.abbreviation,
            abbr: e.team.abbreviation, logo: e.team.logos?.[0]?.href || "", v, dv,
            record: dv.overall || [dv.wins, dv.ties, dv.losses].filter((x) => x != null).join("-"),
          };
        });
        const bySeed = teams.every((t) => t.v.playoffSeed > 0);
        teams.sort((a, b) => (bySeed ? a.v.playoffSeed - b.v.playoffSeed : (b.v.winPercent ?? 0) - (a.v.winPercent ?? 0) || (b.v.points ?? 0) - (a.v.points ?? 0)));
        out.push({ name: n.name || n.abbreviation || lg.label, teams });
      }
      (n.children || []).forEach(walk);
    };
    walk(d);
    return out;
  }
  function teamStatsList(d) {
    const m = {};
    (d?.results || []).forEach((c) => (c.leaders || []).forEach((l) => {
      const id = String(l.athlete?.id || "");
      if (!id) return;
      const p = (m[id] ||= { id, name: l.athlete.displayName, cats: {} });
      const vals = {};
      (l.statistics || []).forEach((g) => (g.stats || []).forEach((s) => { if (vals[s.name] == null) vals[s.name] = { v: s.value, d: s.displayValue }; }));
      p.cats[c.name] = vals;
    }));
    return Object.values(m);
  }
  function parseOdds(o, teams) {
    if (!o) return null;
    const n = (v) => { if (v == null || v === "") return null; if (/even/i.test(String(v))) return 100; const x = Number(String(v).replace(/^[ou]/i, "")); return isFinite(x) ? x : null; };
    const home = teams.find((t) => t.homeAway === "home"), away = teams.find((t) => t.homeAway === "away");
    return {
      provider: o.provider?.displayName || o.provider?.name || "",
      mlH: n(o.moneyline?.home?.close?.odds ?? o.homeTeamOdds?.moneyLine), mlA: n(o.moneyline?.away?.close?.odds ?? o.awayTeamOdds?.moneyLine),
      spH: n(o.pointSpread?.home?.close?.line), spA: n(o.pointSpread?.away?.close?.line),
      spHo: n(o.pointSpread?.home?.close?.odds), spAo: n(o.pointSpread?.away?.close?.odds),
      total: n(o.total?.over?.close?.line) ?? n(o.overUnder), draw: n(o.drawOdds?.moneyLine),
      details: o.details || "", home, away,
    };
  }
  const teamOf = (c) => ({
    id: String(c.team?.id ?? c.id), abbr: c.team?.abbreviation || "", name: c.team?.displayName || "",
    logo: c.team?.logo || c.team?.logos?.[0]?.href || "", homeAway: c.homeAway,
    score: c.score?.displayValue ?? c.score ?? "", winner: c.winner, record: c.records?.[0]?.summary || "",
  });
  const awayHome = (ts) => [...ts].sort((a, b) => (a.homeAway === "away" ? -1 : 1) - (b.homeAway === "away" ? -1 : 1));

  // stats offered for a player, by position (same idea as the bet builder)
  const NO_PROPS_FB = /^(OT|OG|G|C|T|OL|LT|LG|RG|RT|LS|H|P)$/;
  function propsFor(fam, pos) {
    const P = String(pos || "").toUpperCase();
    const pick = (keys) => keys.map((k) => fam.props.find((p) => p.k === k)).filter(Boolean);
    if (fam === FAMILIES.football) {
      if (P === "QB") return pick(["PYD", "PTD", "CMP", "ATT", "INT", "RYD", "PRY", "CAR", "ATD"]);
      if (/^(RB|FB|HB)$/.test(P)) return pick(["RYD", "CAR", "RRY", "REC", "RCY", "ATD", "TD", "LRUSH"]);
      if (/^(WR|TE)$/.test(P)) return pick(["REC", "RCY", "ATD", "LREC", "RRY", "TD"]);
      if (/^(K|PK)$/.test(P)) return pick(["KPT", "FGM"]);
      if (P) return pick(["TKL", "SCK"]);
    }
    if (fam === FAMILIES.baseball && P) return /^(P|SP|RP|CL)$/.test(P) ? pick(["K", "OUTS", "HA", "ER", "PBB"]) : pick(["H", "HR", "HRR", "RBI", "R", "BB", "BK"]);
    if (fam === FAMILIES.hockey && P) return P === "G" ? pick(["SV", "GA"]) : pick(["SOG", "PTS", "G", "A", "HIT", "BLK"]);
    if (fam === FAMILIES.soccer && P) return /^(G|GK)$/.test(P) ? pick(["SV"]) : pick(["SOT", "SH", "G", "A", "GA", "FC"]);
    return fam.props.filter((p) => !p.yes);
  }
  const propOf = (fam, k) => fam.props.find((p) => p.k === k) || fam.props.find((p) => !p.yes);

  // team-leader stats per family: [category, ESPN stat, label, lower is better]
  const LEADER_STATS = {
    basketball: [["game", "avgPoints", "Points per game"], ["game", "avgRebounds", "Rebounds per game"], ["game", "avgAssists", "Assists per game"], ["game", "avgThreePointFieldGoalsMade", "3-pointers per game"], ["game", "avgMinutes", "Minutes per game"], ["game", "avgSteals", "Steals per game"], ["game", "avgBlocks", "Blocks per game"]],
    football: [["passing", "passingYards", "Passing yards"], ["rushing", "rushingYards", "Rushing yards"], ["receiving", "receivingYards", "Receiving yards"], ["receiving", "receptions", "Receptions"], ["scoring", "totalTouchdowns", "Touchdowns"], ["defensive", "totalTackles", "Tackles"], ["defensive", "sacks", "Sacks"]],
    hockey: [["team", "points", "Points"], ["team", "goals", "Goals"], ["team", "assists", "Assists"], ["team", "shotsTotal", "Shots"], ["goalkeeping", "savePct", "Save %"]],
    baseball: [["batting", "homeRuns", "Home runs"], ["batting", "RBIs", "RBIs"], ["batting", "hits", "Hits"], ["batting", "avg", "Batting average"], ["pitching", "strikeouts", "Strikeouts (pitching)"], ["pitching", "ERA", "ERA", true]],
  };
  const STANDING_METRICS = [["winPercent", "Win %"], ["wins", "Wins"], ["pointDifferential", "Point differential"], ["points", "Points (soccer, NHL)"], ["avgPointsFor", "Points scored per game"]];

  // ---------------------------------------------------------------- sources
  const SOURCES = {
    scores: { label: "Live scores", desc: "Today's games with live scores and lines", vizzes: ["cards", "table"], fields: ["lg"], ttl: 30000 },
    odds: { label: "Odds board", desc: "Spreads, moneylines and totals for upcoming games", vizzes: ["table"], fields: ["lg", "day"], ttl: 120000 },
    standings: { label: "Standings", desc: "A league's table, or ranked as a bar chart", vizzes: ["table", "hbar"], fields: ["lg", "group", "metric"], ttl: 600000 },
    team: { label: "Team results", desc: "A team's recent games: margins, scoring, record", vizzes: ["bar", "line", "table", "single"], fields: ["lg", "team", "n"], ttl: 300000 },
    player: { label: "Player game log", desc: "One player's stat game by game, against a line", vizzes: ["bar", "line", "table", "single"], fields: ["lg", "team", "player", "stat", "n", "line"], ttl: 300000 },
    compare: { label: "Compare players", desc: "Up to five players on the same stat", vizzes: ["hbar", "line", "table"], fields: ["lg", "players", "stat", "n"], ttl: 300000 },
    leaders: { label: "Team leaders", desc: "A team's players ranked by a season stat", vizzes: ["hbar", "table"], fields: ["lg", "team", "leader"], ttl: 600000 },
    parlay: { label: "My parlay", desc: "The slip you're building on the Parlay page", vizzes: ["list"], fields: [], ttl: 0 },
    note: { label: "Note", desc: "Your own text: a plan, a reminder, a lean", vizzes: ["text"], fields: ["text"], ttl: 0 },
  };
  const VIZ_LABEL = { cards: "Cards", table: "Table", hbar: "Ranked bars", bar: "Bar chart", line: "Line chart", single: "Big numbers", list: "List", text: "Text" };
  const WIDTHS = [[4, "S"], [6, "M"], [8, "L"], [12, "Full"]];

  // ------------------------------------------------------------------ state
  let state;            // set after the templates below are defined
  let editing = false;
  let timer = null;
  let lastUpdate = null;

  function loadState() {
    let s = null;
    try { s = JSON.parse(store.get(STORE)); } catch (_) {}
    if (!s || !Array.isArray(s.dashboards) || !s.dashboards.length) {
      const d = TEMPLATES.mine();
      s = { dashboards: [d], active: d.id };
    }
    if (!s.dashboards.some((d) => d.id === s.active)) s.active = s.dashboards[0].id;
    return s;
  }
  function save() { store.set(STORE, JSON.stringify(state)); }
  const dash = () => state.dashboards.find((d) => d.id === state.active);

  // ---------------------------------------------------------------- templates
  // ids are ESPN's; the data stays live, only the selections are preset
  function P(source, viz, w, cfg, title) { return { id: uid(), source, viz, w, cfg: cfg || {}, title: title || "" }; }
  const LILLARD = { id: "6606", name: "Damian Lillard", pos: "G", team: "22" };
  const HERRO = { id: "4395725", name: "Tyler Herro", pos: "G", team: "15" };
  const MAHOMES = { id: "3139477", name: "Patrick Mahomes", pos: "QB", team: "12" };
  const TEMPLATES = {
    mine: () => ({ id: uid(), name: "My dashboard", refresh: 60, panels: [
      P("scores", "cards", 6, { lg: "nba|0" }),
      P("parlay", "list", 6, {}),
      P("player", "bar", 8, { lg: "nba|0", team: LILLARD.team, player: LILLARD, stat: "PTS", n: 10, line: 20.5 }),
      P("player", "single", 4, { lg: "nba|0", team: LILLARD.team, player: LILLARD, stat: "PTS", n: 10, line: 20.5 }),
      P("standings", "hbar", 6, { lg: "nba|0", group: "0", metric: "winPercent" }),
      P("team", "line", 6, { lg: "nfl|0", team: "12", teamName: "Kansas City Chiefs", n: 10 }),
    ] }),
    gameday: () => ({ id: uid(), name: "Game day", refresh: 30, panels: [
      P("scores", "cards", 6, { lg: "nba|0" }),
      P("scores", "cards", 6, { lg: "nfl|0" }),
      P("odds", "table", 8, { lg: "nfl|0", day: 0 }),
      P("parlay", "list", 4, {}),
      P("odds", "table", 6, { lg: "nhl|0", day: 0 }),
      P("note", "text", 6, { text: "Leans for tonight:\n- \n- \n\nTap Edit on this panel to write your own." }),
    ] }),
    research: () => ({ id: uid(), name: "Player prop research", refresh: 0, panels: [
      P("player", "bar", 8, { lg: "nba|0", team: LILLARD.team, player: LILLARD, stat: "PTS", n: 10, line: 20.5 }),
      P("player", "single", 4, { lg: "nba|0", team: LILLARD.team, player: LILLARD, stat: "3PM", n: 10, line: 2.5 }),
      P("compare", "line", 8, { lg: "nba|0", players: [LILLARD, HERRO], stat: "PTS", n: 10 }),
      P("compare", "hbar", 4, { lg: "nba|0", players: [LILLARD, HERRO], stat: "PRA", n: 10 }),
      P("player", "line", 6, { lg: "nfl|0", team: MAHOMES.team, player: MAHOMES, stat: "PYD", n: 10, line: 250.5 }),
      P("leaders", "hbar", 6, { lg: "nfl|0", team: "12", teamName: "Kansas City Chiefs", leader: "receiving.receivingYards" }),
    ] }),
    standings: () => ({ id: uid(), name: "Standings", refresh: 0, panels: [
      P("standings", "table", 6, { lg: "nfl|0", group: "0" }),
      P("standings", "table", 6, { lg: "nfl|0", group: "1" }),
      P("standings", "hbar", 6, { lg: "nba|0", group: "0", metric: "winPercent" }),
      P("standings", "hbar", 6, { lg: "nba|0", group: "1", metric: "winPercent" }),
      P("standings", "table", 6, { lg: "soccer|0", group: "all" }),
      P("standings", "hbar", 6, { lg: "nhl|0", group: "all", metric: "points" }),
    ] }),
    team: () => ({ id: uid(), name: "Team focus", refresh: 0, panels: [
      P("team", "bar", 8, { lg: "nba|0", team: "15", teamName: "Milwaukee Bucks", n: 15 }),
      P("team", "single", 4, { lg: "nba|0", team: "15", teamName: "Milwaukee Bucks", n: 10 }),
      P("leaders", "hbar", 6, { lg: "nba|0", team: "15", teamName: "Milwaukee Bucks", leader: "game.avgPoints" }),
      P("team", "table", 6, { lg: "nba|0", team: "15", teamName: "Milwaukee Bucks", n: 10 }),
    ] }),
  };

  state = loadState();

  // ============================================================ RENDER: page
  function renderTabs() {
    $("#dashTabs").innerHTML = state.dashboards.map((d) =>
      `<button type="button" role="tab" data-dash="${d.id}" aria-selected="${d.id === state.active}">${esc(d.name)}</button>`).join("");
    $("#refreshSel").value = String(dash().refresh || 0);
    const t = $("#editToggle");
    t.setAttribute("aria-pressed", String(editing));
    t.textContent = editing ? "Done" : "Edit layout";
  }

  function renderGrid() {
    const d = dash();
    const grid = $("#dashGrid");
    grid.classList.toggle("is-editing", editing);
    $("#dashEmpty").hidden = d.panels.length > 0;
    grid.innerHTML = d.panels.map(panelShell).join("");
    d.panels.forEach((p) => renderPanel(p.id));
  }

  function autoTitle(p) {
    const lg = lgOf(p.cfg.lg), fam = famOf(lg);
    const pr = p.cfg.stat ? propOf(fam, p.cfg.stat) : null;
    switch (p.source) {
      case "scores": return `${lg.label} scores`;
      case "odds": return `${lg.label} odds${p.cfg.day ? (p.cfg.day == 1 ? ", tomorrow" : `, in ${p.cfg.day} days`) : ", today"}`;
      case "standings": return `${lg.label} standings`;
      case "team": return `${p.cfg.teamName || "Team"} results`;
      case "player": return `${p.cfg.player?.name || "Player"}: ${pr?.label || "stat"}`;
      case "compare": return `${pr?.label || "Stat"}: ${(p.cfg.players || []).map((x) => x.name.split(" ").slice(-1)[0]).join(" vs ") || "players"}`;
      case "leaders": { const ls = leaderStat(lg, p.cfg.leader); return `${p.cfg.teamName || "Team"} leaders${ls ? ": " + ls[2] : ""}`; }
      case "parlay": return "My parlay";
      case "note": return "Note";
    }
    return "Panel";
  }
  function subtitle(p) {
    const lg = lgOf(p.cfg.lg);
    const bits = [];
    if (["team", "player", "compare"].includes(p.source)) bits.push(`Last ${p.cfg.n || 10} games`);
    if (p.source === "player" && p.cfg.line != null && p.cfg.line !== "") bits.push(`line ${p.cfg.line}`);
    if (!["parlay", "note"].includes(p.source)) bits.unshift(lg.label);
    return bits.join(" · ");
  }
  const leaderStat = (lg, key) => (LEADER_STATS[lg.sport.family] || []).find(([c, k]) => `${c}.${k}` === key) || (LEADER_STATS[lg.sport.family] || [])[0];

  function panelShell(p) {
    const tools = editing
      ? `<div class="panel-tools">
          <span class="drag-handle" title="Drag to move" aria-hidden="true">⠿</span>
          <div class="seg seg-sm w-seg" role="group" aria-label="Width">${WIDTHS.map(([w, l]) => `<button type="button" data-pact="w" data-w="${w}" aria-pressed="${p.w === w}">${l}</button>`).join("")}</div>
          <button type="button" class="icon-btn sm" data-pact="left" title="Move earlier" aria-label="Move earlier">←</button>
          <button type="button" class="icon-btn sm" data-pact="right" title="Move later" aria-label="Move later">→</button>
          <button type="button" class="icon-btn sm" data-pact="dup" title="Duplicate" aria-label="Duplicate">⧉</button>
          <button type="button" class="icon-btn sm" data-pact="edit" title="Edit" aria-label="Edit">✎</button>
          <button type="button" class="icon-btn sm danger" data-pact="del" title="Delete" aria-label="Delete">×</button>
        </div>`
      : `<button type="button" class="icon-btn sm panel-edit" data-pact="edit" title="Edit panel" aria-label="Edit panel">✎</button>`;
    return `<section class="panel card w-${p.w}" data-pid="${p.id}" ${editing ? 'draggable="true"' : ""}>
      <header class="panel-head">
        <div class="panel-titles"><h3>${esc(p.title || autoTitle(p))}</h3><span class="panel-sub">${esc(subtitle(p))}</span></div>
        ${tools}
      </header>
      <div class="panel-body" id="pb-${p.id}"></div>
    </section>`;
  }

  function renderPanel(id) {
    const p = dash().panels.find((x) => x.id === id);
    const el = document.getElementById("pb-" + id);
    if (!p || !el) return;
    let html;
    try { html = BODY[p.source] ? BODY[p.source](p, el.clientWidth || 600) : ""; }
    catch (e) { console.warn(e); html = `<p class="muted small pad">Something went wrong drawing this panel. Edit it to pick different settings.</p>`; }
    el.innerHTML = html;
  }
  // a panel whose data is still loading re-draws itself once it lands
  function waitFor(c, p) {
    c.p.then(() => renderPanel(p.id), () => renderPanel(p.id));
    return `<div class="panel-loading"><span class="spinner" aria-hidden="true"></span><span class="muted small">Loading…</span></div>`;
  }
  const failHTML = (msg) => `<p class="muted small pad">${esc(msg || "Couldn't load this data. It may not exist for this league right now.")}</p>`;
  const needs = (msg) => `<p class="muted small pad">${esc(msg)} <button type="button" class="link-btn" data-pact="edit">Edit panel</button></p>`;

  // ============================================================ CHARTS
  // Hand-drawn SVG. Thin marks, 4px rounded data ends on the baseline side, 2px lines,
  // 8px markers with a surface ring, hairline grid, hover tooltips on every mark.
  function niceTicks(min, max, count = 4) {
    if (max === min) max = min + 1;
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || 10 * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(6));
    return ticks;
  }
  function barPath(x, y, w, h, up) {   // bar with 4px rounded corners at the data end
    const r = Math.min(4, w / 2, Math.abs(h));
    if (h <= 0) return "";
    return up
      ? `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
      : `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
  }
  // vertical bars over a sequence (games). items: [{label, value, color, tip}]
  function vbarChart(items, opts) {
    const W = Math.max(280, opts.width), H = opts.height || 220;
    const pad = { l: 40, r: opts.threshold != null && isFinite(opts.threshold) ? 58 : 14, t: 14, b: 28 };
    const vals = items.map((i) => i.value);
    const lo = Math.min(0, ...vals, opts.threshold ?? 0), hi = Math.max(0, ...vals, opts.threshold ?? 0);
    const ticks = niceTicks(lo, hi * 1.05 || 1);
    const min = ticks[0], max = ticks[ticks.length - 1];
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const y = (v) => pad.t + ph - ((v - min) / (max - min)) * ph;
    const band = pw / Math.max(1, items.length);
    const bw = Math.max(4, Math.min(34, band - 6));
    const every = Math.ceil(items.length / Math.floor(pw / 34));
    const grid = ticks.map((t) => `<line class="gl" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${fmtNum(t)}</text>`).join("");
    const bars = items.map((it, i) => {
      const x = pad.l + i * band + (band - bw) / 2;
      const y0 = y(0), y1 = y(it.value);
      const up = it.value >= 0;
      const d = up ? barPath(x, y1, bw, y0 - y1, true) : barPath(x, y0, bw, y1 - y0, false);
      const lab = i % every === 0 ? `<text class="ax" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(it.label)}</text>` : "";
      return `<path class="mark" d="${d}" style="fill:${it.color || "var(--s1)"}"/>${lab}
        <rect class="hit" x="${pad.l + i * band}" y="${pad.t}" width="${band}" height="${ph}" data-tip="${esc(it.tip)}"/>`;
    }).join("");
    const th = opts.threshold != null && isFinite(opts.threshold)
      ? `<line class="thr" x1="${pad.l}" x2="${W - pad.r}" y1="${y(opts.threshold)}" y2="${y(opts.threshold)}"/><text class="thr-l" x="${W - pad.r + 6}" y="${y(opts.threshold) + 4}" text-anchor="start">${esc(opts.thresholdLabel || "Line " + opts.threshold)}</text>` : "";
    return `<svg class="viz" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opts.aria || "Bar chart")}">
      ${grid}<line class="base" x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}"/>${bars}${th}</svg>`;
  }
  // lines over a shared x sequence. series: [{name, values[], color}], labels[]
  function lineChart(labels, series, opts) {
    const W = Math.max(280, opts.width), H = opts.height || 220;
    const pad = { l: 40, r: opts.threshold != null && isFinite(opts.threshold) ? 58 : 16, t: 14, b: 28 };
    const all = series.flatMap((s) => s.values.filter((v) => v != null));
    const lo = Math.min(0, ...all, opts.threshold ?? Infinity), hi = Math.max(1, ...all, opts.threshold ?? -Infinity);
    const ticks = niceTicks(lo, hi * 1.05);
    const min = ticks[0], max = ticks[ticks.length - 1];
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const n = labels.length;
    const x = (i) => pad.l + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
    const y = (v) => pad.t + ph - ((v - min) / (max - min)) * ph;
    const grid = ticks.map((t) => `<line class="gl" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${fmtNum(t)}</text>`).join("");
    const every = Math.ceil(n / Math.floor(pw / 40));
    const xl = labels.map((l, i) => (i % every === 0 ? `<text class="ax" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>` : "")).join("");
    const lines = series.map((s) => {
      const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
      const path = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join("");
      const dots = pts.length <= 25 ? pts.map((p) => `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="4" style="fill:${s.color}"/>`).join("") : "";
      return `<path class="ln" d="${path}" style="stroke:${s.color}"/>${dots}`;
    }).join("");
    const th = opts.threshold != null && isFinite(opts.threshold)
      ? `<line class="thr" x1="${pad.l}" x2="${W - pad.r}" y1="${y(opts.threshold)}" y2="${y(opts.threshold)}"/><text class="thr-l" x="${W - pad.r + 6}" y="${y(opts.threshold) + 4}" text-anchor="start">${esc(opts.thresholdLabel || "Line " + opts.threshold)}</text>` : "";
    const bandW = n <= 1 ? pw : pw / (n - 1);
    const hits = labels.map((l, i) => {
      const tip = [opts.tipTitle ? opts.tipTitle(i) : l, ...series.map((s) => `${s.name}: ${s.values[i] == null ? "–" : fmtNum(s.values[i])}`)].join("\n");
      return `<rect class="hit" x="${Math.max(pad.l, x(i) - bandW / 2)}" y="${pad.t}" width="${bandW}" height="${ph}" data-tip="${esc(tip)}" data-cx="${x(i)}"/>`;
    }).join("");
    return `<svg class="viz" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opts.aria || "Line chart")}">
      ${grid}<line class="base" x1="${pad.l}" x2="${W - pad.r}" y1="${y(Math.max(0, min))}" y2="${y(Math.max(0, min))}"/>
      <line class="xhair" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ph}" visibility="hidden"/>
      ${th}${lines}${xl}${hits}</svg>`;
  }
  // ranked horizontal bars (HTML, so long names and logos fit). rows: [{label, logo, value, display, tip}]
  function hbarChart(rows, opts = {}) {
    const max = Math.max(...rows.map((r) => Math.abs(r.value)), 0) || 1;
    const signed = rows.some((r) => r.value < 0);
    return `<div class="hbars ${signed ? "signed" : ""}">${rows.map((r) => {
      const pct = (Math.abs(r.value) / max) * (signed ? 50 : 100);
      const style = signed
        ? (r.value >= 0 ? `left:50%;width:${pct}%;background:var(--pos)` : `right:50%;width:${pct}%;background:var(--neg)`)
        : `width:${pct}%;background:${r.color || "var(--s1)"}`;
      return `<div class="hb-row" data-tip="${esc(r.tip || `${r.label}: ${r.display ?? r.value}`)}">
        <span class="hb-label">${r.logo ? `<img src="${esc(r.logo)}" alt="" loading="lazy">` : ""}<span>${esc(r.label)}</span></span>
        <span class="hb-track"><span class="hb-bar ${signed ? (r.value >= 0 ? "pos" : "neg") : ""}" style="${style}"></span></span>
        <span class="hb-val mono">${esc(r.display ?? fmtNum(r.value))}</span></div>`;
    }).join("")}</div>${opts.note ? `<p class="viz-note">${esc(opts.note)}</p>` : ""}`;
  }
  const legend = (series) => (series.length < 2 ? "" : `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>`);
  const tiles = (arr) => `<div class="tiles-d">${arr.map(([k, v, sub]) => `<div class="tile-d"><span class="td-k">${esc(k)}</span><span class="td-v">${esc(v)}</span>${sub ? `<span class="td-sub">${esc(sub)}</span>` : ""}</div>`).join("")}</div>`;
  const table = (head, rows) => `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)"];

  // ============================================================ PANEL BODIES
  const BODY = {
    scores(p) {
      const lg = lgOf(p.cfg.lg);
      const q = [`dates=${ymdLocal().replaceAll("-", "")}`, groupsQ(lg, "groups"), lg.sport.groups ? "limit=400" : ""].filter(Boolean).join("&");
      const c = load(`${API}${lg.path}/scoreboard?${q}`, SOURCES.scores.ttl);
      if (!c.data) return c.err ? failHTML() : waitFor(c, p);
      const evs = (c.data.events || []).map((e) => {
        const comp = e.competitions[0];
        const teams = awayHome(comp.competitors.map(teamOf));
        return { e, teams, st: e.status.type, odds: parseOdds(comp.odds?.[0], teams) };
      }).sort((a, b) => ({ in: 0, pre: 1, post: 2 }[a.st.state] - { in: 0, pre: 1, post: 2 }[b.st.state]) || new Date(a.e.date) - new Date(b.e.date));
      if (!evs.length) return `<p class="muted small pad">No ${esc(lg.label)} games today.</p>`;
      const status = (g) => (g.st.state === "pre" ? fmtWhen(g.e.date) : g.st.shortDetail);
      if (p.viz === "table") {
        return table(["Matchup", "Score", "Status", "Line"], evs.map((g) => [
          `${esc(g.teams[0].abbr)} at ${esc(g.teams[1].abbr)}`,
          g.st.state === "pre" ? "–" : `<span class="mono">${esc(g.teams[0].score)}–${esc(g.teams[1].score)}</span>`,
          `<span class="${g.st.state === "in" ? "txt-live" : "muted"}">${esc(status(g))}</span>`,
          `<span class="muted">${esc(g.odds?.details || "")}${g.odds?.total ? ` · O/U ${g.odds.total}` : ""}</span>`]));
      }
      return `<div class="score-cards">${evs.map((g) => `
        <div class="sc ${g.st.state}">
          ${g.teams.map((t) => `<div class="sc-row ${g.st.state === "post" && t.winner ? "win" : ""}"><img src="${esc(t.logo)}" alt="" loading="lazy"><span class="sc-name">${esc(t.abbr)}</span><span class="sc-score mono">${g.st.state === "pre" ? "" : esc(t.score)}</span></div>`).join("")}
          <div class="sc-meta"><span class="${g.st.state === "in" ? "txt-live" : "muted"}">${esc(status(g))}</span>${g.odds?.details ? `<span class="muted">${esc(g.odds.details)}</span>` : ""}</div>
        </div>`).join("")}</div>`;
    },

    odds(p) {
      const lg = lgOf(p.cfg.lg);
      const d = new Date(); d.setDate(d.getDate() + (Number(p.cfg.day) || 0));
      const q = [`dates=${ymdLocal(d).replaceAll("-", "")}`, groupsQ(lg, "groups"), lg.sport.groups ? "limit=400" : ""].filter(Boolean).join("&");
      const c = load(`${API}${lg.path}/scoreboard?${q}`, SOURCES.odds.ttl);
      if (!c.data) return c.err ? failHTML() : waitFor(c, p);
      const rows = (c.data.events || []).filter((e) => e.status.type.state === "pre").map((e) => {
        const comp = e.competitions[0];
        const teams = awayHome(comp.competitors.map(teamOf));
        return { e, teams, o: parseOdds(comp.odds?.[0], teams) };
      }).filter((r) => r.o);
      if (!rows.length) return `<p class="muted small pad">No upcoming ${esc(lg.label)} games with lines ${p.cfg.day ? "on that day" : "today"}. Lines usually post a few days ahead.</p>`;
      const soccer = lg.sport.family === "soccer";
      const head = ["Time", "Away", "Home", soccer ? "Draw" : "Spread (home)", "Moneyline", "Total"];
      return table(head, rows.map(({ e, teams, o }) => [
        `<span class="muted">${esc(fmtWhen(e.date))}</span>`,
        `<span class="tm"><img src="${esc(teams[0].logo)}" alt="">${esc(teams[0].abbr)}</span>`,
        `<span class="tm"><img src="${esc(teams[1].logo)}" alt="">${esc(teams[1].abbr)}</span>`,
        `<span class="mono">${soccer ? esc(fmtOdds(o.draw)) : o.spH != null ? `${o.spH > 0 ? "+" : ""}${o.spH}${o.spHo != null ? ` <span class="muted">${fmtOdds(o.spHo)}</span>` : ""}` : "–"}</span>`,
        `<span class="mono">${esc(fmtOdds(o.mlA) || "–")} / ${esc(fmtOdds(o.mlH) || "–")}</span>`,
        `<span class="mono">${o.total ?? "–"}</span>`]))
        + `<p class="viz-note">${esc(rows[0].o.provider ? `Lines: ${rows[0].o.provider}.` : "")} Moneyline shown away / home.</p>`;
    },

    standings(p, width) {
      const lg = lgOf(p.cfg.lg);
      const c = load(`${STD}${lg.path}/standings${lg.sport.groups ? "?group=" + lg.sport.groups : ""}`, SOURCES.standings.ttl);
      if (!c.data) return c.err ? failHTML() : waitFor(c, p);
      const groups = standingsGroups(c.data, lg);
      if (!groups.length) return failHTML("No standings for this league right now.");
      const sel = p.cfg.group == null || p.cfg.group === "all" ? null : groups[Number(p.cfg.group)] || null;
      let teams = sel ? sel.teams : groups.flatMap((g) => g.teams);
      const metric = p.cfg.metric || (lg.sport.family === "soccer" ? "points" : "winPercent");
      if (!sel) teams = [...teams].sort((a, b) => (b.v[metric] ?? -1e9) - (a.v[metric] ?? -1e9));
      const groupName = sel ? sel.name : "All teams";
      if (p.viz === "hbar") {
        const label = (STANDING_METRICS.find(([k]) => k === metric) || [, metric])[1];
        const rows = teams.filter((t) => t.v[metric] != null).sort((a, b) => b.v[metric] - a.v[metric])
          .map((t) => ({ label: width < 420 ? t.abbr : t.short, logo: t.logo, value: t.v[metric], display: t.dv[metric] ?? fmtNum(t.v[metric]), tip: `${t.name}: ${t.dv[metric]} ${label.toLowerCase()} (${t.record})` }));
        if (!rows.length) return failHTML(`This league doesn't report ${label.toLowerCase()}. Edit the panel to pick another measure.`);
        return hbarChart(rows, { note: `${groupName} · ${label}` });
      }
      const soccer = lg.sport.family === "soccer";
      return `<p class="viz-note top">${esc(groupName)}</p>` + table(
        ["#", "Team", "Record", soccer ? "Pts" : "GB", "Streak", soccer ? "GD" : "Last 10"],
        teams.map((t, i) => [`<span class="muted mono">${i + 1}</span>`, `<span class="tm"><img src="${esc(t.logo)}" alt="" loading="lazy">${esc(width < 420 ? t.abbr : t.short)}</span>`,
          `<span class="mono">${esc(t.record)}</span>`, `<span class="mono">${esc(soccer ? t.dv.points : t.dv.gamesBehind ?? "–")}</span>`,
          `<span class="mono">${esc(t.dv.streak || "–")}</span>`, `<span class="mono">${esc(soccer ? t.dv.pointDifferential : t.dv["Last Ten Games"] || "–")}</span>`]));
    },

    team(p, width) {
      const lg = lgOf(p.cfg.lg);
      if (!p.cfg.team) return needs("Pick a team for this panel.");
      const c = load(`${API}${lg.path}/teams/${p.cfg.team}/schedule`, SOURCES.team.ttl);
      if (!c.data) return c.err ? failHTML() : waitFor(c, p);
      const parse = (d) => (d.events || []).map((e) => {
        const comp = e.competitions?.[0];
        if (!comp) return null;
        const me = comp.competitors.find((x) => String(x.team?.id ?? x.id) === String(p.cfg.team));
        const op = comp.competitors.find((x) => x !== me);
        const st = (comp.status || e.status || {}).type || {};
        if (!me || !op || st.state !== "post") return null;
        const sc = (x) => num0(x.score?.displayValue ?? x.score?.value ?? x.score);
        const pf = sc(me), pa = sc(op);
        return { date: e.date, vs: me.homeAway === "home" ? "vs" : "@", opp: op.team?.abbreviation || "", oppLogo: op.team?.logos?.[0]?.href || "", pf, pa, res: pf > pa ? "W" : pf < pa ? "L" : "T" };
      }).filter(Boolean).sort((a, b) => new Date(b.date) - new Date(a.date));
      let games = parse(c.data);
      const yr = c.data.requestedSeason?.year;
      if (!games.length && yr) {
        const pc = load(`${API}${lg.path}/teams/${p.cfg.team}/schedule?season=${yr - 1}`, 3600000);
        if (!pc.data) return pc.err ? failHTML() : waitFor(pc, p);
        games = parse(pc.data);
      }
      if (!games.length) return `<p class="muted small pad">No games played yet.</p>`;
      const n = Number(p.cfg.n) || 10;
      const last = games.slice(0, n);
      const chrono = [...last].reverse();
      const tip = (g) => `${shortDate(g.date)} ${g.vs} ${g.opp}: ${g.res} ${g.pf}-${g.pa}`;
      const team = c.data.team || {};
      if (p.viz === "bar") {
        return `<div class="legend"><span><i style="background:var(--pos)"></i>Won by</span><span><i style="background:var(--neg)"></i>Lost by</span></div>` +
          vbarChart(chrono.map((g) => ({ label: g.opp, value: g.pf - g.pa, color: g.pf >= g.pa ? "var(--pos)" : "var(--neg)", tip: tip(g) + ` (margin ${g.pf - g.pa > 0 ? "+" : ""}${g.pf - g.pa})` })), { width, aria: "Point margin by game" });
      }
      if (p.viz === "line") {
        const series = [{ name: "Scored", values: chrono.map((g) => g.pf), color: SERIES[0] }, { name: "Allowed", values: chrono.map((g) => g.pa), color: SERIES[1] }];
        return legend(series) + lineChart(chrono.map((g) => g.opp), series, { width, tipTitle: (i) => tip(chrono[i]), aria: "Points scored and allowed by game" });
      }
      if (p.viz === "single") {
        const w = last.filter((g) => g.res === "W").length, l = last.filter((g) => g.res === "L").length;
        const avg = (k) => +(last.reduce((a, g) => a + g[k], 0) / last.length).toFixed(1);
        let streak = 0; const s0 = games[0].res; for (const g of games) { if (g.res === s0) streak++; else break; }
        return tiles([["Record", team.recordSummary || "–", team.standingSummary || ""], [`Last ${last.length}`, `${w}-${l}`, ""], ["Scored", avg("pf"), "per game"], ["Allowed", avg("pa"), "per game"], ["Streak", `${s0}${streak}`, ""]]);
      }
      return table(["Date", "Opp", "Result"], last.map((g) => [`<span class="muted">${esc(shortDate(g.date))}</span>`,
        `<span class="tm">${esc(g.vs)} ${g.oppLogo ? `<img src="${esc(g.oppLogo)}" alt="">` : ""}${esc(g.opp)}</span>`,
        `<b class="res-${g.res}">${g.res}</b> <span class="mono">${g.pf}-${g.pa}</span>`]));
    },

    player(p, width) {
      const lg = lgOf(p.cfg.lg), fam = famOf(lg);
      if (!p.cfg.player?.id) return needs("Pick a player for this panel.");
      const n = Number(p.cfg.n) || 10;
      const r = playerRows(lg, p.cfg.player.id, n);
      if (r.pending) return waitFor(r.pending, p);
      if (r.err) return failHTML("Couldn't load this player's games.");
      const pr = propOf(fam, p.cfg.stat);
      const val = (row) => pr.sum.reduce((a, k) => a + (logVal(row, k) || 0), 0);
      const games = r.rows.slice(0, n);
      if (!games.length) return `<p class="muted small pad">No games logged yet.</p>`;
      const line = pr.yes ? 0.5 : numOrNull(p.cfg.line);
      const chrono = [...games].reverse();
      const tip = (g) => `${shortDate(g.date)} ${g.atVs} ${g.opp.abbreviation || ""}: ${val(g)} ${pr.label.toLowerCase()}${line != null ? (val(g) > line ? " (over)" : val(g) < line ? " (under)" : " (push)") : ""}`;
      const avg = (arr) => (arr.length ? +(arr.reduce((a, g) => a + val(g), 0) / arr.length).toFixed(1) : null);
      const hits = (arr) => arr.filter((g) => val(g) > line).length;
      if (p.viz === "single") {
        const season = r.rows.filter((g) => !g.prev);
        const out = [[`Avg, last ${games.length}`, fmtNum(avg(games)), pr.label.toLowerCase()], ["Last 5 avg", fmtNum(avg(games.slice(0, 5))), ""], ["Season avg", season.length ? fmtNum(avg(season)) : "–", season.length ? `${season.length} games` : "no games yet"]];
        if (line != null) out.unshift([`Hit rate, last ${games.length}`, `${hits(games)}/${games.length}`, `${Math.round((hits(games) / games.length) * 100)}% over ${line}`]);
        out.push(["High / low", `${Math.max(...games.map(val))} / ${Math.min(...games.map(val))}`, ""]);
        return tiles(out);
      }
      if (p.viz === "table") {
        return table(["Date", "Opp", "Result", esc(pr.label)], games.map((g) => {
          const v = val(g);
          return [`<span class="muted">${esc(shortDate(g.date))}</span>${g.prev ? ` <span class="muted small">prev</span>` : ""}`,
            `<span class="tm">${esc(g.atVs)} ${g.opp.logo ? `<img src="${esc(g.opp.logo)}" alt="">` : ""}${esc(g.opp.abbreviation || "")}</span>`,
            `${g.result ? `<b class="res-${esc(g.result)}">${esc(g.result)}</b> ` : ""}<span class="mono muted">${esc(g.score)}</span>`,
            `<span class="pill ${line == null ? "" : v > line ? "won" : v < line ? "lost" : ""}">${v}</span>`];
        }));
      }
      const colored = line != null;
      const leg = colored ? `<div class="legend"><span><i style="background:var(--good)"></i>Over ${line}</span><span><i style="background:var(--bad)"></i>Under</span><span class="muted">Hit ${hits(games)}/${games.length}</span></div>` : "";
      if (p.viz === "line") {
        return leg + lineChart(chrono.map((g) => g.opp.abbreviation || ""), [{ name: pr.label, values: chrono.map(val), color: SERIES[0] }],
          { width, threshold: line, tipTitle: (i) => tip(chrono[i]), aria: `${p.cfg.player.name} ${pr.label} by game` });
      }
      return leg + vbarChart(chrono.map((g) => {
        const v = val(g);
        return { label: g.opp.abbreviation || "", value: v, tip: tip(g), color: !colored ? "var(--s1)" : v > line ? "var(--good)" : v < line ? "var(--bad)" : "var(--ink-muted)" };
      }), { width, threshold: line, thresholdLabel: pr.yes ? "1 or more" : null, aria: `${p.cfg.player.name} ${pr.label} by game` });
    },

    compare(p, width) {
      const lg = lgOf(p.cfg.lg), fam = famOf(lg);
      const players = (p.cfg.players || []).slice(0, 5);
      if (!players.length) return needs("Add players to compare.");
      const n = Number(p.cfg.n) || 10;
      const pr = propOf(fam, p.cfg.stat);
      const val = (row) => pr.sum.reduce((a, k) => a + (logVal(row, k) || 0), 0);
      const data = [];
      for (const pl of players) {
        const r = playerRows(lg, pl.id, n);
        if (r.pending) return waitFor(r.pending, p);
        data.push({ pl, rows: (r.rows || []).slice(0, n) });
      }
      const avg = (rows) => (rows.length ? +(rows.reduce((a, g) => a + val(g), 0) / rows.length).toFixed(1) : null);
      if (p.viz === "line") {
        const len = Math.max(...data.map((d) => d.rows.length));
        const labels = Array.from({ length: len }, (_, i) => (i === len - 1 ? "Latest" : `G${i + 1}`));
        const series = data.map((d, i) => {
          const chrono = [...d.rows].reverse();
          const pad = Array(len - chrono.length).fill(null);
          return { name: d.pl.name, values: pad.concat(chrono.map(val)), color: SERIES[i] };
        });
        return legend(series) + lineChart(labels, series, { width, aria: `${pr.label} comparison`, tipTitle: (i) => (i === len - 1 ? "Most recent game" : `${len - i} games ago`) })
          + `<p class="viz-note">Each player's last ${len} games, oldest on the left.</p>`;
      }
      if (p.viz === "table") {
        return table(["Player", `Avg, last ${n}`, "High", "Low", "Recent games"], data.map((d) => {
          const vs = d.rows.map(val);
          return [esc(d.pl.name), `<b class="mono">${fmtNum(avg(d.rows))}</b>`, `<span class="mono">${vs.length ? Math.max(...vs) : "–"}</span>`,
            `<span class="mono">${vs.length ? Math.min(...vs) : "–"}</span>`, `<span class="mono muted">${vs.slice(0, 10).join(" · ")}</span>`];
        }));
      }
      return hbarChart(data.map((d) => ({ label: d.pl.name, value: avg(d.rows) ?? 0, display: fmtNum(avg(d.rows)), tip: `${d.pl.name}: ${fmtNum(avg(d.rows))} ${pr.label.toLowerCase()} per game, last ${d.rows.length}` }))
        .sort((a, b) => b.value - a.value), { note: `${pr.label}, average over each player's last ${n} games` });
    },

    leaders(p, width) {
      const lg = lgOf(p.cfg.lg);
      if (!p.cfg.team) return needs("Pick a team for this panel.");
      const ls = leaderStat(lg, p.cfg.leader);
      if (!ls) return failHTML("Team leaders aren't available for this league.");
      const c = load(`${WEB2}${lg.path}/teams/${p.cfg.team}/athletes/statistics?seasontype=2`, SOURCES.leaders.ttl);
      if (!c.data) return c.err ? failHTML("Team stats aren't available for this team.") : waitFor(c, p);
      const [cat, key, label, lowBetter] = ls;
      const rows = teamStatsList(c.data).map((pl) => ({ pl, s: pl.cats[cat]?.[key] })).filter((x) => x.s && isFinite(x.s.v) && x.s.v !== 0)
        .sort((a, b) => (lowBetter ? a.s.v - b.s.v : b.s.v - a.s.v)).slice(0, 10);
      if (!rows.length) return `<p class="muted small pad">No ${esc(label.toLowerCase())} recorded yet.</p>`;
      if (p.viz === "table") return table(["#", "Player", esc(label)], rows.map((x, i) => [`<span class="muted mono">${i + 1}</span>`, esc(x.pl.name), `<b class="mono">${esc(x.s.d)}</b>`]));
      return hbarChart(rows.map((x) => ({ label: x.pl.name, value: x.s.v, display: x.s.d, tip: `${x.pl.name}: ${x.s.d} ${label.toLowerCase()}` })),
        { note: `${label}, ${c.data.requestedSeason?.displayName || "this season"}${lowBetter ? " (lowest first)" : ""}` });
    },

    parlay() {
      let s = null;
      try { s = JSON.parse(store.get("parlay-analytics:v2")); } catch (_) {}
      const legs = s?.legs || [];
      if (!legs.length) return `<div class="pad"><p class="muted small">Your slip is empty.</p><a class="btn btn-sm" href="index.html">Build a parlay</a></div>`;
      const fam = (l) => FAMILIES[(window.sportByKey(l.sport) || {}).family];
      const txt = (l) => {
        const ou = `${l.side === "under" ? "Under" : "Over"} ${l.line}`;
        const pr = l.market === "prop" ? (fam(l)?.props || []).find((x) => x.k === l.stat) : null;
        switch (l.market) {
          case "ml": case "winner": case "win": return `${l.pick} to win`;
          case "draw": return "Draw";
          case "spread": return `${l.pick} ${l.line > 0 ? "+" : ""}${l.line}`;
          case "total": return `Game total ${ou.toLowerCase()}`;
          case "teamTotal": return `${l.pick} team total ${ou.toLowerCase()}`;
          case "prop": return pr?.yes ? `${l.pick}: ${pr.label.toLowerCase()}` : `${l.pick} ${ou.toLowerCase()} ${pr?.label.toLowerCase() || ""}`;
          case "rounds": return `${ou} rounds`;
          case "distance": return l.side === "no" ? "Fight ends early" : "Fight goes the distance";
          case "games": return `${ou} games`;
          case "top": return `${l.pick} top ${l.line}`;
        }
        return l.pick || "Leg";
      };
      const toDec = (a) => (a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a));
      const allOdds = legs.every((l) => l.odds != null);
      const dec = allOdds ? legs.reduce((a, l) => a * toDec(l.odds), 1) : null;
      const am = dec ? (dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1))) : null;
      const stake = Number(s.stake) || 10;
      return `<ul class="leg-list">${legs.map((l) => `<li><span class="tag">${esc(l.sportLabel || "")}</span><span class="ll-main">${esc(txt(l))}</span><span class="muted small">${esc(l.matchup || "")}</span>${l.odds != null ? `<span class="mono">${esc(fmtOdds(l.odds))}</span>` : ""}</li>`).join("")}</ul>
        <div class="ll-foot"><span>${legs.length} legs${am != null ? ` · <b class="mono">${fmtOdds(am)}</b> · $${stake} pays <b class="mono">$${(stake * dec).toFixed(2)}</b>` : ""}</span><a class="link-btn" href="index.html">Track live →</a></div>`;
    },

    note(p) {
      const t = String(p.cfg.text || "").trim();
      if (!t) return needs("This note is empty.");
      return `<div class="note-body">${t.split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
    },
  };

  // ============================================================ PANEL EDITOR
  let draft = null;     // copy of the panel being edited
  let draftIsNew = false;
  const dlg = $("#panelDlg");

  function openEditor(panel) {
    draftIsNew = !panel;
    draft = panel ? JSON.parse(JSON.stringify(panel)) : { id: uid(), source: "player", viz: "bar", w: 6, title: "", cfg: { lg: "nba|0", n: 10 } };
    renderEditor();
    dlg.showModal();
  }

  function teamsFor(lg) {
    const c = load(`${STD}${lg.path}/standings${lg.sport.groups ? "?group=" + lg.sport.groups : ""}`, 600000);
    if (!c.data) { if (!c.err) c.p.then(renderEditor, renderEditor); return c.err ? [] : null; }
    return standingsGroups(c.data, lg).flatMap((g) => g.teams).sort((a, b) => a.name.localeCompare(b.name));
  }
  function rosterFor(lg, teamId) {
    const c = load(`${API}${lg.path}/teams/${teamId}/roster`, 3600000);
    if (!c.data) { if (!c.err) c.p.then(renderEditor, renderEditor); return c.err ? [] : null; }
    const out = [];
    const fb = lg.sport.family === "football";
    (c.data.athletes || []).forEach((g) => {
      const add = (a) => { const pos = a.position?.abbreviation || ""; if (a?.id && !(fb && NO_PROPS_FB.test(pos))) out.push({ id: String(a.id), name: a.displayName, pos }); };
      if (g.items) { if (!/practice|suspend/i.test(g.position || "")) g.items.forEach(add); } else add(g);
    });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  function renderEditor() {
    if (!draft) return;
    const src = SOURCES[draft.source];
    const cfg = draft.cfg;
    if (!src.vizzes.includes(draft.viz)) draft.viz = src.vizzes[0];
    const lg = lgOf(cfg.lg), fam = famOf(lg);
    const fld = (label, inner, cls = "") => `<label class="fld ${cls}"><span>${label}</span>${inner}</label>`;
    const opts = (arr, sel) => arr.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? "selected" : ""}>${esc(l)}</option>`).join("");
    let f = "";

    if (src.fields.includes("lg")) {
      f += fld("League", `<select class="input" data-cf="lg">${SPORTS.filter((s) => s.kind === "team").map((s) => {
        const ls = LEAGUES.filter((l) => l.sport === s);
        return ls.length > 1 ? `<optgroup label="${esc(s.label)}">${opts(ls.map((l) => [l.id, l.label]), cfg.lg)}</optgroup>` : opts(ls.map((l) => [l.id, l.label]), cfg.lg);
      }).join("")}</select>`);
    }
    if (src.fields.includes("day")) f += fld("Day", `<select class="input" data-cf="day">${opts([[0, "Today"], [1, "Tomorrow"], [2, "In 2 days"], [3, "In 3 days"], [6, "In 6 days"]], cfg.day || 0)}</select>`);
    if (src.fields.includes("group")) {
      const c = load(`${STD}${lg.path}/standings${lg.sport.groups ? "?group=" + lg.sport.groups : ""}`, 600000);
      if (!c.data && !c.err) c.p.then(renderEditor, renderEditor);
      const gs = c.data ? standingsGroups(c.data, lg) : [];
      f += fld("Group", `<select class="input" data-cf="group">${opts([["all", "All teams"], ...gs.map((g, i) => [String(i), g.name])], cfg.group ?? "all")}</select>`);
    }
    if (src.fields.includes("metric") && draft.viz === "hbar") f += fld("Rank by", `<select class="input" data-cf="metric">${opts(STANDING_METRICS, cfg.metric || "winPercent")}</select>`);
    if (src.fields.includes("team") || src.fields.includes("players")) {
      const teams = teamsFor(lg);
      const label = src.fields.includes("players") ? "Team (to add players from)" : "Team";
      f += fld(label, teams == null ? `<select class="input" disabled><option>Loading teams…</option></select>`
        : `<select class="input" data-cf="team"><option value="">Choose a team</option>${opts(teams.map((t) => [t.id, t.name]), cfg.team)}</select>`);
    }
    if (src.fields.includes("player")) {
      const ro = cfg.team ? rosterFor(lg, cfg.team) : [];
      f += fld("Player", !cfg.team ? `<select class="input" disabled><option>Pick a team first</option></select>`
        : ro == null ? `<select class="input" disabled><option>Loading roster…</option></select>`
        : `<select class="input" data-cf="player"><option value="">Choose a player</option>${opts(ro.map((x) => [x.id, `${x.name}${x.pos ? " · " + x.pos : ""}`]), cfg.player?.id)}</select>`);
    }
    if (src.fields.includes("players")) {
      const ro = cfg.team ? rosterFor(lg, cfg.team) : [];
      const chosen = cfg.players || [];
      f += fld("Add a player", !cfg.team ? `<select class="input" disabled><option>Pick a team first</option></select>`
        : ro == null ? `<select class="input" disabled><option>Loading roster…</option></select>`
        : `<select class="input" data-cf="addPlayer" ${chosen.length >= 5 ? "disabled" : ""}><option value="">${chosen.length >= 5 ? "Five players max" : "Choose a player to add"}</option>${opts(ro.filter((x) => !chosen.some((c) => c.id === x.id)).map((x) => [x.id, `${x.name}${x.pos ? " · " + x.pos : ""}`]), "")}</select>`);
      f += `<div class="fld wide"><span>Players</span><div class="chosen">${chosen.length ? chosen.map((x) => `<span class="chip-x">${esc(x.name)}<button type="button" data-rm="${x.id}" aria-label="Remove ${esc(x.name)}">×</button></span>`).join("") : `<span class="muted small">None yet. Players can come from different teams.</span>`}</div></div>`;
    }
    if (src.fields.includes("stat")) {
      const pos = draft.source === "player" ? cfg.player?.pos : "";
      const list = propsFor(fam, pos);
      if (!list.some((x) => x.k === cfg.stat)) cfg.stat = list[0]?.k;
      f += fld("Stat", `<select class="input" data-cf="stat">${opts(list.map((x) => [x.k, x.label]), cfg.stat)}</select>`);
    }
    if (src.fields.includes("leader")) {
      const ls = LEADER_STATS[lg.sport.family] || [];
      f += fld("Stat", ls.length ? `<select class="input" data-cf="leader">${opts(ls.map(([c, k, l]) => [`${c}.${k}`, l]), cfg.leader || `${ls[0][0]}.${ls[0][1]}`)}</select>` : `<select class="input" disabled><option>Not available for this league</option></select>`);
    }
    if (src.fields.includes("n")) f += fld("Games", `<select class="input" data-cf="n">${opts([[5, "Last 5"], [10, "Last 10"], [15, "Last 15"], [20, "Last 20"], [40, "Last 40"]], cfg.n || 10)}</select>`);
    if (src.fields.includes("line")) f += fld("Line <em>(optional)</em>", `<input class="input" data-cf="line" value="${esc(cfg.line ?? "")}" placeholder="e.g. 20.5" inputmode="decimal" autocomplete="off">`);
    if (src.fields.includes("text")) f += `<label class="fld wide"><span>Text</span><textarea class="input" data-cf="text" rows="6">${esc(cfg.text || "")}</textarea></label>`;

    $("#panelForm").innerHTML = `
      <div class="dlg-head"><h2 id="dlgTitle">${draftIsNew ? "Add a panel" : "Edit panel"}</h2><button type="button" class="x" data-dlg="close" aria-label="Close">×</button></div>
      <div class="dlg-body">
        <div class="ed-step">1. Data</div>
        <div class="src-grid">${Object.entries(SOURCES).map(([k, s]) => `
          <button type="button" class="src ${k === draft.source ? "on" : ""}" data-src="${k}" aria-pressed="${k === draft.source}">
            <b>${esc(s.label)}</b><span>${esc(s.desc)}</span></button>`).join("")}</div>
        ${f ? `<div class="ed-step">2. Settings</div><div class="ed-fields">${f}</div>` : ""}
        <div class="ed-step">${f ? 3 : 2}. Show it as</div>
        <div class="seg" role="group" aria-label="Visualization">${src.vizzes.map((v) => `<button type="button" data-viz="${v}" aria-pressed="${v === draft.viz}">${VIZ_LABEL[v]}</button>`).join("")}</div>
        <div class="ed-row2">
          <label class="fld"><span>Title <em>(optional)</em></span><input class="input" data-cf="title" value="${esc(draft.title)}" placeholder="${esc(autoTitle(draft))}" autocomplete="off"></label>
          <div class="fld"><span>Width</span><div class="seg seg-sm" role="group" aria-label="Width">${WIDTHS.map(([w, l]) => `<button type="button" data-dw="${w}" aria-pressed="${draft.w === w}">${l}</button>`).join("")}</div></div>
        </div>
        <p class="editor-err" id="dlgErr"></p>
      </div>
      <div class="dlg-foot">
        ${draftIsNew ? "" : `<button type="button" class="btn btn-ghost btn-sm danger" data-dlg="delete">Delete panel</button>`}
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost btn-sm" data-dlg="close">Cancel</button>
        <button type="button" class="btn btn-sm" data-dlg="save">${draftIsNew ? "Add to dashboard" : "Save"}</button>
      </div>`;
  }

  function saveDraft() {
    const src = SOURCES[draft.source], c = draft.cfg;
    const err = (m) => { $("#dlgErr").textContent = m; };
    if (src.fields.includes("team") && !src.fields.includes("players") && !c.team) return err("Pick a team.");
    if (src.fields.includes("player") && !c.player?.id) return err("Pick a player.");
    if (src.fields.includes("players") && !(c.players || []).length) return err("Add at least one player.");
    if (c.line != null && c.line !== "" && numOrNull(c.line) == null) return err("The line should be a number, like 20.5.");
    const d = dash();
    const i = d.panels.findIndex((p) => p.id === draft.id);
    if (i >= 0) d.panels[i] = draft; else d.panels.push(draft);
    save();
    dlg.close();
    draft = null;
    renderGrid();
    toast(i >= 0 ? "Panel saved" : "Panel added");
  }

  dlg.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t || !draft) return;
    if (t.dataset.src) { draft.source = t.dataset.src; draft.viz = SOURCES[draft.source].vizzes[0]; return renderEditor(); }
    if (t.dataset.viz) { draft.viz = t.dataset.viz; return renderEditor(); }
    if (t.dataset.dw) { draft.w = Number(t.dataset.dw); return renderEditor(); }
    if (t.dataset.rm) { draft.cfg.players = (draft.cfg.players || []).filter((x) => x.id !== t.dataset.rm); return renderEditor(); }
    const a = t.dataset.dlg;
    if (a === "close") { dlg.close(); draft = null; }
    if (a === "save") saveDraft();
    if (a === "delete" && confirm("Delete this panel?")) {
      const d = dash(); d.panels = d.panels.filter((p) => p.id !== draft.id); save(); dlg.close(); draft = null; renderGrid();
    }
  });
  dlg.addEventListener("change", (e) => {
    const t = e.target;
    const k = t.dataset.cf;
    if (!k || !draft) return;
    const c = draft.cfg;
    const lg = lgOf(c.lg);
    if (k === "lg") { c.lg = t.value; delete c.team; delete c.teamName; delete c.player; c.players = []; delete c.group; delete c.leader; delete c.stat; }
    else if (k === "team") {
      c.team = t.value;
      c.teamName = (teamsFor(lg) || []).find((x) => x.id === t.value)?.name || "";
      delete c.player;
    } else if (k === "player") {
      const pl = (rosterFor(lg, c.team) || []).find((x) => x.id === t.value);
      c.player = pl ? { id: pl.id, name: pl.name, pos: pl.pos, team: c.team } : null;
      delete c.stat;
    } else if (k === "addPlayer") {
      const pl = (rosterFor(lg, c.team) || []).find((x) => x.id === t.value);
      if (pl) (c.players ||= []).push({ id: pl.id, name: pl.name, pos: pl.pos, team: c.team });
    } else if (k === "title") { draft.title = t.value; return; }
    else if (k === "line" || k === "text") { c[k] = t.value; return; }
    else c[k] = t.value;
    renderEditor();
  });
  dlg.addEventListener("input", (e) => {
    const t = e.target;
    if (!draft) return;
    if (t.dataset.cf === "title") draft.title = t.value;
    if (t.dataset.cf === "line" || t.dataset.cf === "text") draft.cfg[t.dataset.cf] = t.value;
  });
  dlg.addEventListener("close", () => { draft = null; });
  $("#panelForm").addEventListener("submit", (e) => e.preventDefault());

  // ============================================================ PAGE EVENTS
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, [data-open-add]");
    if (!t) return;
    if (t.dataset.dash) { state.active = t.dataset.dash; save(); editing = false; renderTabs(); renderGrid(); schedule(); return; }
    if (t.id === "addPanel" || t.hasAttribute("data-open-add")) return openEditor(null);
    if (t.id === "editToggle") { editing = !editing; renderTabs(); renderGrid(); return; }
    if (t.id === "refreshNow") return refreshAll(true);
    if (t.id === "newDash") {
      const name = prompt("Name your new dashboard:", "New dashboard");
      if (!name) return;
      const d = { id: uid(), name: name.trim().slice(0, 40) || "New dashboard", refresh: 0, panels: [] };
      state.dashboards.push(d); state.active = d.id; save(); editing = false; renderTabs(); renderGrid();
      return openEditor(null);
    }
    if (t.dataset.menu) { $("#dashMenu").open = false; return menuAction(t.dataset.menu, t.dataset.tpl); }
    const pact = t.dataset.pact;
    if (pact) {
      const sec = t.closest("[data-pid]");
      const d = dash();
      const i = sec ? d.panels.findIndex((p) => p.id === sec.dataset.pid) : -1;
      if (i < 0) return;
      const p = d.panels[i];
      if (pact === "edit") return openEditor(p);
      if (pact === "del") { if (!confirm("Delete this panel?")) return; d.panels.splice(i, 1); }
      if (pact === "dup") d.panels.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(p)), id: uid() });
      if (pact === "left" && i > 0) [d.panels[i - 1], d.panels[i]] = [d.panels[i], d.panels[i - 1]];
      if (pact === "right" && i < d.panels.length - 1) [d.panels[i + 1], d.panels[i]] = [d.panels[i], d.panels[i + 1]];
      if (pact === "w") p.w = Number(t.dataset.w);
      save(); renderGrid();
    }
  });

  $("#refreshSel").addEventListener("change", (e) => { dash().refresh = Number(e.target.value); save(); schedule(); });
  document.addEventListener("click", (e) => { const m = $("#dashMenu"); if (m.open && !m.contains(e.target)) m.open = false; });

  function menuAction(a, tpl) {
    const d = dash();
    if (a === "rename") { const n = prompt("Rename dashboard:", d.name); if (n && n.trim()) { d.name = n.trim().slice(0, 40); save(); renderTabs(); } }
    if (a === "duplicate") {
      const c = JSON.parse(JSON.stringify(d)); c.id = uid(); c.name = d.name + " copy"; c.panels.forEach((p) => (p.id = uid()));
      state.dashboards.push(c); state.active = c.id; save(); renderTabs(); renderGrid(); toast("Dashboard duplicated");
    }
    if (a === "delete") {
      if (!confirm(`Delete "${d.name}"? This can't be undone.`)) return;
      state.dashboards = state.dashboards.filter((x) => x.id !== d.id);
      if (!state.dashboards.length) state.dashboards.push(TEMPLATES.mine());
      state.active = state.dashboards[0].id; save(); renderTabs(); renderGrid();
    }
    if (a === "share") {
      const code = btoa(unescape(encodeURIComponent(JSON.stringify({ name: d.name, refresh: d.refresh, panels: d.panels }))));
      const url = `${location.origin}${location.pathname}#d=${code}`;
      navigator.clipboard?.writeText(url).then(() => toast("Link copied. Opening it adds this dashboard for that person."), () => prompt("Copy this link:", url));
    }
    if (a === "export") {
      const blob = new Blob([JSON.stringify({ name: d.name, refresh: d.refresh, panels: d.panels }, null, 2)], { type: "application/json" });
      const aEl = document.createElement("a");
      aEl.href = URL.createObjectURL(blob);
      aEl.download = d.name.replace(/[^\w-]+/g, "-").toLowerCase() + ".json";
      aEl.click();
      setTimeout(() => URL.revokeObjectURL(aEl.href), 2000);
    }
    if (a === "import") $("#importFile").click();
    if (a === "tpl" && TEMPLATES[tpl]) {
      const nd = TEMPLATES[tpl]();
      state.dashboards.push(nd); state.active = nd.id; save(); editing = false; renderTabs(); renderGrid(); schedule();
      toast(`Added "${nd.name}". Every panel can be edited.`);
    }
  }
  function addImported(obj) {
    if (!obj || !Array.isArray(obj.panels)) throw new Error("bad");
    const nd = {
      id: uid(), name: String(obj.name || "Imported").slice(0, 40), refresh: Number(obj.refresh) || 0,
      panels: obj.panels.filter((p) => p && SOURCES[p.source]).map((p) => ({
        id: uid(), source: p.source, viz: SOURCES[p.source].vizzes.includes(p.viz) ? p.viz : SOURCES[p.source].vizzes[0],
        w: [4, 6, 8, 12].includes(p.w) ? p.w : 6, title: String(p.title || "").slice(0, 80), cfg: typeof p.cfg === "object" && p.cfg ? p.cfg : {},
      })),
    };
    state.dashboards.push(nd); state.active = nd.id; save();
    return nd;
  }
  $("#importFile").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { const nd = addImported(JSON.parse(await f.text())); renderTabs(); renderGrid(); toast(`Imported "${nd.name}"`); }
    catch (_) { toast("That file isn't a dashboard export."); }
    e.target.value = "";
  });

  // drag panels to reorder (edit mode)
  let dragId = null;
  const grid = $("#dashGrid");
  grid.addEventListener("dragstart", (e) => {
    const sec = e.target.closest("[data-pid]");
    if (!editing || !sec) return;
    dragId = sec.dataset.pid;
    sec.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", dragId); } catch (_) {}
  });
  grid.addEventListener("dragover", (e) => {
    if (!dragId) return;
    e.preventDefault();
    $$(".panel.drop-target").forEach((x) => x.classList.remove("drop-target"));
    const over = e.target.closest("[data-pid]");
    if (over && over.dataset.pid !== dragId) over.classList.add("drop-target");
  });
  grid.addEventListener("drop", (e) => {
    if (!dragId) return;
    e.preventDefault();
    const over = e.target.closest("[data-pid]");
    const d = dash();
    const from = d.panels.findIndex((p) => p.id === dragId);
    const to = over ? d.panels.findIndex((p) => p.id === over.dataset.pid) : d.panels.length - 1;
    if (from >= 0 && to >= 0 && from !== to) { const [m] = d.panels.splice(from, 1); d.panels.splice(to, 0, m); save(); }
    dragId = null;
    renderGrid();
  });
  grid.addEventListener("dragend", () => { dragId = null; $$(".panel").forEach((x) => x.classList.remove("dragging", "drop-target")); });

  // chart tooltips + line-chart crosshair
  const tip = $("#vizTip");
  document.addEventListener("pointermove", (e) => {
    const t = e.target.closest?.("[data-tip]");
    $$(".viz .xhair[visibility=visible]").forEach((l) => { if (!t || !l.closest("svg").contains(t)) l.setAttribute("visibility", "hidden"); });
    if (!t || !t.closest(".panel")) { tip.hidden = true; return; }
    tip.innerHTML = esc(t.dataset.tip).replace(/\n/g, "<br>");
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY - r.height - 10;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y < 8) y = e.clientY + 16;
    tip.style.left = x + "px"; tip.style.top = y + "px";
    if (t.dataset.cx) {
      const xh = t.closest("svg").querySelector(".xhair");
      if (xh) { xh.setAttribute("x1", t.dataset.cx); xh.setAttribute("x2", t.dataset.cx); xh.setAttribute("visibility", "visible"); }
    }
  });
  document.addEventListener("pointerleave", () => { tip.hidden = true; });

  // re-draw charts when panels change width
  let rT;
  const ro = new ResizeObserver(() => { clearTimeout(rT); rT = setTimeout(() => dash().panels.forEach((p) => renderPanel(p.id)), 150); });
  ro.observe(grid);

  // ---------------------------------------------------------------- refresh
  function refreshAll(force) {
    if (force) Object.values(cache).forEach((c) => (c.at = 0));
    dash().panels.forEach((p) => renderPanel(p.id));
    // panels drawn from older data re-draw once the refreshed data lands
    const busy = Object.values(cache).filter((c) => c.busy && c.data);
    if (busy.length) Promise.allSettled(busy.map((c) => c.p)).then(() => dash().panels.forEach((p) => renderPanel(p.id)));
    lastUpdate = new Date();
    const live = dash().refresh > 0;
    $("#dashPill").dataset.state = live ? "live" : "";
    $("#dashUpdated").textContent = `${live ? "Auto-refresh on · " : ""}Updated ${lastUpdate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
  }
  function schedule() {
    clearInterval(timer);
    const s = dash().refresh;
    if (s > 0) timer = setInterval(() => { if (!document.hidden) { Object.values(cache).forEach((c) => { if (Date.now() - c.at > s * 1000 - 500) c.at = 0; }); refreshAll(false); } }, s * 1000);
    refreshAll(false);
  }

  let toastT;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ---------------------------------------------------------------- start
  const m = location.hash.match(/^#d=(.+)$/);
  if (m) {
    try { const nd = addImported(JSON.parse(decodeURIComponent(escape(atob(m[1]))))); setTimeout(() => toast(`Added shared dashboard "${nd.name}"`), 300); }
    catch (_) { setTimeout(() => toast("That share link didn't work."), 300); }
    history.replaceState(null, "", location.pathname + location.search);
  }
  save();
  renderTabs();
  renderGrid();
  schedule();
})();
