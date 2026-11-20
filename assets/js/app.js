/* =====================================================================
   PARLAY ANALYTICS — build a slip like a sportsbook, then track it live.
   Data: ESPN's public site API, called from the browser.
   Never add headers or a `cache` option to fetch: that triggers a CORS
   preflight that ESPN rejects. A throwaway query param keeps data fresh.
   ===================================================================== */
(function () {
  "use strict";

  const API = "https://site.api.espn.com/apis/site/v2/sports/";
  const STORE = "parlay-analytics:v2";
  const REFRESH_LIVE = 20000;
  const REFRESH_IDLE = 300000;
  const SPORTS = window.SPORTS;
  const FAMILIES = window.FAMILIES;

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
  const apiDate = (ymd) => ymd.replaceAll("-", "");
  function fmtWhen(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return ymdLocal(d) === ymdLocal() ? t : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + ", " + t;
  }
  const num = (v) => {
    if (v == null) return 0;
    const s = String(v).trim();
    if (!s || s === "--" || s === "-") return 0;
    const n = Number(s.replace(/^\+/, ""));
    return isNaN(n) ? 0 : n;
  };

  // American odds
  const toDec = (a) => (a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a));
  const toAm = (d) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
  const fmtOdds = (a) => (a == null || a === "" || isNaN(a) ? "" : a > 0 ? "+" + a : String(a));
  const fmtLine = (n) => (n > 0 ? "+" + n : String(n));
  const money = (n) => "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function parseOddsInput(v) {
    v = String(v ?? "").trim();
    if (!v) return null;
    if (/^ev(en)?$/i.test(v)) return 100;
    const n = Number(v);
    return isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null;
  }

  const sportOf = (leg) => window.sportByKey(leg.sport) || SPORTS[0];
  const famOf = (leg) => FAMILIES[sportOf(leg).family] || null;
  const propOf = (fam, k) => fam?.props.find((p) => p.k === k);
  const totalUnit = (fam) => (!fam ? "" : fam === FAMILIES.baseball ? "runs" : fam === FAMILIES.hockey || fam === FAMILIES.soccer ? "goals" : "points");

  async function getJSON(url) {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "_=" + Date.now());
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  function sbURL(sport, path, date) {
    const q = [];
    if (date) q.push("dates=" + date);
    if (sport.groups) q.push("groups=" + sport.groups, "limit=400");
    return API + path + "/scoreboard" + (q.length ? "?" + q.join("&") : "");
  }

  // ------------------------------------------------------------------ state
  let state = loadState();
  const games = {};               // gameKey -> normalized live data
  let timer = null;
  let lastUpdate = null;
  let view = store.get("pa-view") === "track" && state.legs.length ? "track" : state.legs.length ? "track" : "build";

  const board = {
    sport: window.sportByKey(store.get("pa-sport")) ? store.get("pa-sport") : "nfl",
    league: 0,
    date: ymdLocal(),
    data: null,
    loading: false,
    err: false,
    draft: null,
    byId: {},
    rosters: {},
    search: "",
  };

  function loadState() {
    let s = null;
    const m = location.hash.match(/^#p=(.+)$/);
    if (m) { try { s = JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch (_) {} }
    if (!s) { try { s = JSON.parse(store.get(STORE)); } catch (_) {} }
    if (!s) { try { s = JSON.parse(store.get("parlay-analytics:v1")); } catch (_) {} }
    if (Array.isArray(s)) s = { legs: s };
    if (!s || typeof s !== "object") s = {};
    s.legs = (Array.isArray(s.legs) ? s.legs : []).map(migrate).filter(Boolean);
    s.stake = Number(s.stake) > 0 ? Number(s.stake) : 10;
    return s;
  }
  // v1 legs were NBA-only and used `type` instead of `market`
  function migrate(l) {
    if (!l || typeof l !== "object") return null;
    if (l.sport) return l;
    const out = { ...l, sport: "nba", sportLabel: "NBA", path: "basketball/nba", kind: "team", market: l.type, eventId: l.gameId };
    if (l.type === "prop") out.pick = l.playerName;
    else out.pick = l.teamName;
    return out;
  }
  function save() {
    store.set(STORE, JSON.stringify(state));
    if (location.hash.startsWith("#p=")) history.replaceState(null, "", location.pathname + location.search);
  }

  // ------------------------------------------------------- normalize: odds
  function parseOdds(o, teams, fam) {
    if (!o) return null;
    const n = (v) => {
      if (v == null || v === "") return null;
      if (/even/i.test(String(v))) return 100;
      const x = Number(String(v).replace(/^[ou]/i, ""));
      return isFinite(x) ? x : null;
    };
    const home = teams.find((t) => t.homeAway === "home");
    const away = teams.find((t) => t.homeAway === "away");
    const r = { provider: o.provider?.displayName || o.provider?.name || "", ml: {}, sp: {}, draw: null, total: null };
    const mlH = n(o.moneyline?.home?.close?.odds ?? o.homeTeamOdds?.moneyLine);
    const mlA = n(o.moneyline?.away?.close?.odds ?? o.awayTeamOdds?.moneyLine);
    if (home && mlH != null) r.ml[home.id] = mlH;
    if (away && mlA != null) r.ml[away.id] = mlA;
    r.draw = n(o.drawOdds?.moneyLine ?? o.moneyline?.draw?.close?.odds);
    const spH = n(o.pointSpread?.home?.close?.line);
    const spA = n(o.pointSpread?.away?.close?.line);
    if (home && spH != null) r.sp[home.id] = { line: spH, odds: n(o.pointSpread?.home?.close?.odds) };
    if (away && spA != null) r.sp[away.id] = { line: spA, odds: n(o.pointSpread?.away?.close?.odds) };
    // older format: "ATL -5.5". (Soccer uses this field for the moneyline, so skip it there.)
    if (!Object.keys(r.sp).length && !fam?.draw && typeof o.details === "string") {
      const m = o.details.match(/^(\S+)\s+([+-]?\d+(?:\.\d+)?)$/);
      const fav = m && teams.find((t) => t.abbr === m[1]);
      if (fav) { const v = Number(m[2]); teams.forEach((t) => (r.sp[t.id] = { line: t === fav ? v : -v, odds: null })); }
    }
    const tl = n(o.total?.over?.close?.line) ?? n(o.overUnder);
    if (tl != null) r.total = { line: tl, over: n(o.total?.over?.close?.odds), under: n(o.total?.under?.close?.odds) };
    return r;
  }

  // ------------------------------------------------------ normalize: teams
  function teamOf(c) {
    const t = c.team || {};
    const sc = c.score?.value ?? c.score;
    return {
      id: String(t.id ?? c.id),
      abbr: t.abbreviation || t.shortDisplayName || "",
      name: t.displayName || t.name || "",
      logo: t.logo || t.logos?.[0]?.href || "",
      score: sc != null && sc !== "" ? Number(sc) : 0,
      homeAway: c.homeAway,
      winner: c.winner,
      record: c.records?.[0]?.summary || c.record?.[0]?.displayValue || "",
      lines: (c.linescores || []).map((l) => l.displayValue ?? l.value),
    };
  }
  const awayHome = (teams) => [...teams].sort((a, b) => (a.homeAway === "away" ? -1 : 1) - (b.homeAway === "away" ? -1 : 1));

  function catName(fam, cat) {
    if (cat.name) return /^(forwards|defenses|skaters)$/.test(cat.name) ? "skater" : cat.name;
    if (fam === FAMILIES.baseball) return (cat.keys || []).includes("fullInnings.partInnings") ? "pitching" : "batting";
    return "stats";
  }
  function addVals(vals, c, k, v) {
    if (k === "fullInnings.partInnings") {
      const [f, p] = String(v ?? "0").split(".");
      vals[c + ".outs"] = num(f) * 3 + num(p);
      vals[c + ".innings"] = num(v);
      return;
    }
    const sep = k.includes("/") ? "/" : k.includes("-") ? "-" : null;
    if (sep && String(v).includes(sep)) {
      const vs = String(v).split(sep);
      k.split(sep).forEach((kk, i) => (vals[c + "." + kk] = num(vs[i])));
    } else vals[c + "." + k] = num(v);
  }

  // Game summary -> { teams, players, state, ... }
  function normSummary(d, fam) {
    const comp = d.header.competitions[0];
    const st = comp.status;
    const teams = awayHome(comp.competitors.map(teamOf));
    const players = {};
    const ensure = (a, teamId) => {
      const id = String(a.id);
      return (players[id] ||= {
        id, teamId, name: a.displayName || a.fullName || "", short: a.shortName || a.displayName || "",
        headshot: a.headshot?.href || "", pos: a.position?.abbreviation || "",
        vals: {}, cats: [], on: null, dnp: null, reason: "",
      });
    };
    for (const tp of d.boxscore?.players || []) {
      const teamId = String(tp.team.id);
      for (const cat of tp.statistics || []) {
        const cname = catName(fam, cat);
        const keys = cat.keys || cat.names || [];
        const labels = cat.labels || cat.names || keys;
        for (const a of cat.athletes || []) {
          const p = ensure(a.athlete, teamId);
          if (a.active != null && fam === FAMILIES.basketball) p.on = !!a.active;
          if (!a.stats || !a.stats.length) { if (p.dnp == null) p.dnp = true; p.reason = a.reason || p.reason; continue; }
          p.dnp = false;
          const cells = keys.map((k, i) => [k, labels[i], a.stats[i]]);
          keys.forEach((k, i) => addVals(p.vals, cname, k, a.stats[i]));
          p.cats.push({ name: cname, cells });
        }
      }
    }
    // soccer: player stats live under `rosters`
    for (const r of d.rosters || []) {
      const teamId = String(r.team?.id);
      for (const e of r.roster || []) {
        if (!e.athlete) continue;
        const p = ensure(e.athlete, teamId);
        const subIn = !!e.subbedIn && e.subbedIn !== false;
        const subOut = !!e.subbedOut && e.subbedOut !== false;
        p.on = (e.starter && !subOut) || (subIn && !subOut);
        p.dnp = !e.starter && !subIn;
        p.pos = e.position?.abbreviation || p.pos;
        const stats = e.stats || [];
        stats.forEach((s) => (p.vals["soccer." + s.name] = num(s.value)));
        p.cats = [{ name: "soccer", cells: stats.map((s) => [s.name, s.abbreviation, s.displayValue]) }];
      }
    }
    // hockey: who's on the ice right now
    if (Array.isArray(d.onIce) && fam === FAMILIES.hockey) {
      Object.values(players).forEach((p) => (p.on = false));
      d.onIce.forEach((t) => (t.entries || []).forEach((en) => {
        const p = players[String(en.athleteid)];
        if (p) p.on = en.whereabouts?.name === "ROSTER_WHEREABOUTS_IN_PLAY";
      }));
    }
    return {
      kind: "team", id: String(d.header.id), state: st.type.state, detail: st.type.shortDetail || st.type.detail || "",
      date: comp.date, teams, players, situation: null,
    };
  }

  // ------------------------------------------- normalize: fights, tennis, fields
  function allComps(e) {
    if (e.competitions?.length) return e.competitions;
    return (e.groupings || []).flatMap((g) => (g.competitions || []).map((c) => ({ ...c, _group: g.grouping?.displayName || "" })));
  }
  const stateOf = (c, e) => (c.status || e.status || {}).type?.state || "pre";

  function normFight(e, c) {
    const st = c.status || {};
    const texts = (c.details || []).map((d) => d.type?.text || "");
    const win = texts.find((t) => /winner/i.test(t));
    let method = win ? win.replace(/unofficial\s+/i, "").replace(/winner\s*/i, "").trim() : "";
    if (/kotko/i.test(method)) method = "KO/TKO";
    const state = stateOf(c, e);
    const fighters = [...(c.competitors || [])].sort((a, b) => (a.order || 0) - (b.order || 0)).map((x) => ({
      id: String(x.id), name: x.athlete?.displayName || "TBD", flag: x.athlete?.flag?.href || "",
      record: x.records?.[0]?.summary || "", winner: x.winner === true,
    }));
    const period = st.period || 0;
    const clock = st.displayClock || "";
    const detail = state === "pre" ? fmtWhen(c.date || e.date)
      : state === "in" ? `Round ${period || 1}${clock ? " · " + clock : ""}`
      : `Final · R${period} ${clock}${method ? " · " + method : ""}`;
    return {
      kind: "fight", id: String(c.id), eventName: e.name, state, detail, period, clock, method,
      rounds: c.format?.regulation?.periods || 3, weight: c.type?.abbreviation || "", date: c.date || e.date, fighters,
    };
  }

  function normMatch(e, c) {
    const state = stateOf(c, e);
    const st = c.status || {};
    const players = [...(c.competitors || [])].sort((a, b) => (a.order || 0) - (b.order || 0)).map((x) => ({
      id: String(x.id),
      name: x.athlete?.displayName || (x.roster?.athletes || []).map((a) => a.shortName || a.displayName).join(" / ") || x.roster?.shortDisplayName || "TBD",
      flag: x.athlete?.flag?.href || "",
      winner: x.winner === true,
      sets: (x.linescores || []).map((l) => ({ g: num(l.value), tb: l.tiebreak })),
    }));
    return {
      kind: "tennis", id: String(c.id), eventName: e.name, group: c._group || "", round: c.round?.displayName || "",
      state, detail: state === "pre" ? fmtWhen(c.date) : st.type?.shortDetail || st.type?.detail || "", date: c.date || e.date, players,
    };
  }

  function normField(e, c, unit) {
    const st = c.status || e.status || {};
    const ents = (c.competitors || []).map((x) => ({
      id: String(x.id), name: x.athlete?.displayName || x.athlete?.fullName || "", flag: x.athlete?.flag?.href || "",
      order: x.order ?? 999, winner: x.winner === true, raw: x,
    }));
    if (unit === "golf") {
      const round = st.period || 1;
      const roundDone = !!st.type?.completed;
      ents.forEach((p) => {
        const s = p.raw.score;
        p.scoreText = s == null ? "" : String(s);
        p.toPar = p.scoreText === "E" ? 0 : Number(p.scoreText.replace("+", ""));
        const ls = (p.raw.linescores || []).find((l) => l.period === round);
        const holes = ls?.linescores?.length || 0;
        p.thru = holes >= 18 || (roundDone && ls?.displayValue) ? "F" : holes ? String(holes) : "–";
        p.today = ls?.displayValue ?? "";
      });
      ents.forEach((p) => {
        if (!p.scoreText || !isFinite(p.toPar)) { p.pos = p.order; p.tied = false; return; }
        const same = ents.filter((q) => q.scoreText === p.scoreText);
        p.pos = Math.min(...same.map((q) => q.order));
        p.tied = same.length > 1;
      });
    } else ents.forEach((p) => { p.pos = p.order; p.tied = false; });
    ents.forEach((p) => delete p.raw);
    ents.sort((a, b) => a.order - b.order);
    // golf: the competition goes "final" at the end of each round, so use the tournament's status
    const state = unit === "golf" ? (e.status || st).type?.state || "pre" : stateOf(c, e);
    const detail = state === "pre" ? fmtWhen(c.date || e.date)
      : state === "in" ? (unit === "race" ? `Lap ${st.period || 0}` : st.type?.shortDetail || `Round ${st.period || 1}`)
      : st.type?.shortDetail || "Final";
    return { kind: "field", unit, id: String(c.id), eventName: e.name, state, detail, date: c.date || e.date, entrants: ents };
  }
  const posLabel = (p) => (p ? (p.tied ? "T" : "") + p.pos : "–");
  function pickFieldComp(e) {
    const comps = allComps(e);
    return comps.find((c) => /race/i.test(c.type?.abbreviation || "")) || comps[comps.length - 1];
  }

  // -------------------------------------------------------------- grading
  // -> { cls: won|lost|live|pending|push|void, label, current?, target? }
  function ou(side, line, val, final) {
    const base = { current: val, target: line };
    if (side !== "under") {
      if (val > line) return { ...base, cls: "won", label: final ? "Won" : "Hit" };
      if (final) return val === line ? { ...base, cls: "push", label: "Push" } : { ...base, cls: "lost", label: "Lost" };
      const need = Math.floor(line) + 1 - val;
      return { ...base, cls: "live", label: `Needs ${need} more` };
    }
    if (val > line) return { ...base, cls: "lost", label: "Lost" };
    if (final) return val === line ? { ...base, cls: "push", label: "Push" } : { ...base, cls: "won", label: "Won" };
    return { ...base, cls: "live", label: `${+(line - val).toFixed(1)} under` };
  }
  const propLine = (leg) => (propOf(famOf(leg), leg.stat)?.yes ? 0.5 : leg.line);
  const propSide = (leg) => (propOf(famOf(leg), leg.stat)?.yes ? "over" : leg.side);

  function grade(leg, g) {
    if (!g) return { cls: "pending", label: "Loading" };
    if (g.error) return { cls: "pending", label: "No data yet" };
    const final = g.state === "post";
    if (g.state === "pre") {
      const r = { cls: "pending", label: "Starts " + fmtWhen(g.date) };
      if (leg.market === "prop") Object.assign(r, { current: 0, target: propLine(leg) });
      return r;
    }
    if (leg.kind === "team") return gradeTeam(leg, g, final);
    if (leg.kind === "fight") return gradeFight(leg, g, final);
    if (leg.kind === "tennis") return gradeTennis(leg, g, final);
    if (leg.kind === "field") return gradeField(leg, g, final);
    return { cls: "void", label: "Unknown bet" };
  }

  function gradeTeam(leg, g, final) {
    const fam = famOf(leg);
    const mine = g.teams.find((t) => t.id === String(leg.teamId));
    const opp = g.teams.find((t) => t.id !== String(leg.teamId));
    if (leg.market === "total") return ou(leg.side, leg.line, g.teams.reduce((s, t) => s + t.score, 0), final);
    if (leg.market === "draw") {
      const [a, b] = g.teams;
      if (final) return a.score === b.score ? { cls: "won", label: "Won" } : { cls: "lost", label: "Lost" };
      const lead = a.score > b.score ? a : b;
      return { cls: "live", label: a.score === b.score ? "Level" : `${lead.abbr} up ${Math.abs(a.score - b.score)}` };
    }
    if (leg.market === "prop") {
      const p = g.players[String(leg.playerId)];
      const line = propLine(leg);
      if (!p) return final ? { cls: "void", label: "Did not play" } : { cls: "pending", label: "Not in box score yet", current: 0, target: line };
      if (final && p.dnp) return { cls: "void", label: "Did not play" };
      const pr = propOf(fam, leg.stat);
      const val = (pr?.sum || []).reduce((s, k) => s + (p.vals[k] || 0), 0);
      const r = ou(propSide(leg), line, val, final);
      if (pr?.yes && r.cls === "live") r.label = "Not yet";
      return r;
    }
    if (!mine || !opp) return { cls: "void", label: "Team not found" };
    if (leg.market === "teamTotal") return ou(leg.side, leg.line, mine.score, final);
    const d = mine.score - opp.score;
    if (leg.market === "ml") {
      if (final) return d > 0 ? { cls: "won", label: "Won" } : d < 0 || fam?.draw ? { cls: "lost", label: "Lost" } : { cls: "push", label: "Push" };
      return { cls: "live", label: d > 0 ? `Up ${d}` : d < 0 ? `Down ${-d}` : "Tied" };
    }
    if (leg.market === "spread") {
      const m = +(d + leg.line).toFixed(1);
      if (final) return m > 0 ? { cls: "won", label: "Won" } : m < 0 ? { cls: "lost", label: "Lost" } : { cls: "push", label: "Push" };
      return { cls: "live", label: m > 0 ? `Covering by ${m}` : m < 0 ? `Short by ${-m}` : "On the number" };
    }
    return { cls: "void", label: "Unknown bet" };
  }

  const secs = (clock) => { const [m, s] = String(clock || "0:00").split(":").map(Number); return (m || 0) * 60 + (s || 0); };
  function gradeFight(leg, g, final) {
    const decided = g.fighters.some((f) => f.winner);
    const wentDistance = /decision/i.test(g.method) || (g.period >= g.rounds && secs(g.clock) >= 300);
    if (leg.market === "winner") {
      if (final) return !decided ? { cls: "void", label: "Draw / no contest" } : g.fighters.find((f) => f.id === leg.pickId)?.winner ? { cls: "won", label: "Won" } : { cls: "lost", label: "Lost" };
      return { cls: "live", label: `Round ${g.period || 1}` };
    }
    if (leg.market === "distance") {
      if (final) return wentDistance === (leg.side !== "no") ? { cls: "won", label: "Won" } : { cls: "lost", label: "Lost" };
      return { cls: "live", label: `Round ${g.period || 1}` };
    }
    if (leg.market === "rounds") {
      if (final) {
        const elapsed = (g.period - 1) + secs(g.clock) / 300;
        return ou(leg.side, leg.line, +elapsed.toFixed(2), true);
      }
      const done = (g.period || 1) - 1;
      if (done > leg.line) return leg.side === "under" ? { cls: "lost", label: "Lost" } : { cls: "won", label: "Hit" };
      return { cls: "live", label: `Round ${g.period || 1}` };
    }
    return { cls: "void", label: "Unknown bet" };
  }

  function gradeTennis(leg, g, final) {
    if (leg.market === "winner") {
      if (final) return g.players.find((p) => p.id === leg.pickId)?.winner ? { cls: "won", label: "Won" } : { cls: "lost", label: "Lost" };
      const me = g.players.find((p) => p.id === leg.pickId);
      const other = g.players.find((p) => p.id !== leg.pickId);
      const won = (a, b) => a.sets.filter((s, i) => b.sets[i] && s.g > b.sets[i].g && (s.g >= 6)).length;
      const ms = me && other ? won(me, other) : 0, os = me && other ? won(other, me) : 0;
      return { cls: "live", label: `Sets ${ms}–${os}` };
    }
    if (leg.market === "games") {
      const total = g.players.reduce((s, p) => s + p.sets.reduce((a, x) => a + x.g, 0), 0);
      return ou(leg.side, leg.line, total, final);
    }
    return { cls: "void", label: "Unknown bet" };
  }

  function gradeField(leg, g, final) {
    const p = g.entrants.find((x) => x.id === leg.pickId);
    if (!p) return { cls: "void", label: "Not in the field" };
    if (leg.market === "win") {
      if (final) return p.winner || (p.pos === 1 && !p.tied) ? { cls: "won", label: "Won" } : { cls: "lost", label: `Finished ${posLabel(p)}` };
      return { cls: "live", label: `Currently ${posLabel(p)}` };
    }
    if (leg.market === "top") {
      if (final) return p.pos <= leg.line ? { cls: "won", label: `Won (${posLabel(p)})` } : { cls: "lost", label: `Finished ${posLabel(p)}` };
      return { cls: "live", label: `Currently ${posLabel(p)}` };
    }
    return { cls: "void", label: "Unknown bet" };
  }

  // ----------------------------------------------------------- bet wording
  function betText(leg) {
    const fam = famOf(leg);
    const ouTxt = (leg.side === "under" ? "Under " : "Over ") + leg.line;
    switch (leg.market) {
      case "ml": return fam?.draw ? "To win (90 min)" : "To win";
      case "draw": return "Draw (90 min)";
      case "spread": return `${fam?.spreadName || "Spread"} ${fmtLine(leg.line)}`;
      case "total": return `Game total: ${ouTxt.toLowerCase()} ${totalUnit(fam)}`;
      case "teamTotal": return `Team total: ${ouTxt.toLowerCase()} ${totalUnit(fam)}`;
      case "prop": {
        const pr = propOf(fam, leg.stat);
        if (!pr) return "Player prop";
        return pr.yes ? pr.label : `${ouTxt} ${pr.label.toLowerCase()}`;
      }
      case "winner": return leg.kind === "tennis" ? "To win the match" : "To win the fight";
      case "rounds": return `${ouTxt} rounds`;
      case "distance": return leg.side === "no" ? "Fight does not go the distance" : "Fight goes the distance";
      case "games": return `${ouTxt} total games`;
      case "win": return "To win";
      case "top": return `Top ${leg.line} finish`;
    }
    return "";
  }
  function slipTitle(leg) {
    if (leg.market === "total" || leg.market === "rounds" || leg.market === "distance" || leg.market === "games" || leg.market === "draw") return betText(leg);
    return `${leg.pick || ""}: ${betText(leg)}`;
  }

  // ------------------------------------------------------------- refresh
  const gameKey = (leg) => `${leg.path}|${leg.eventId}|${leg.kind === "team" ? "" : leg.compId || ""}`;

  async function findEvent(get, sport, leg) {
    for (const url of [sbURL(sport, leg.path, null), sbURL(sport, leg.path, leg.date)]) {
      const sb = await get(url).catch(() => null);
      const e = sb?.events?.find((x) => String(x.id) === String(leg.eventId));
      if (e) return e;
    }
    throw new Error("event not found");
  }

  async function refresh() {
    const reqs = new Map();
    const get = (url) => { if (!reqs.has(url)) reqs.set(url, getJSON(url)); return reqs.get(url); };
    await Promise.all(state.legs.map(async (leg) => {
      const key = gameKey(leg);
      const sport = sportOf(leg);
      try {
        if (leg.kind === "team") {
          const g = normSummary(await get(API + leg.path + "/summary?event=" + leg.eventId), FAMILIES[sport.family]);
          if (sport.live === "situation" && g.state === "in") {
            try {
              const sb = await get(sbURL(sport, leg.path, leg.date));
              g.situation = sb.events?.find((x) => String(x.id) === String(leg.eventId))?.competitions?.[0]?.situation || null;
            } catch (_) {}
          }
          games[key] = g;
        } else {
          const e = await findEvent(get, sport, leg);
          const c = allComps(e).find((x) => String(x.id) === String(leg.compId));
          if (!c) throw new Error("competition not found");
          games[key] = leg.kind === "fight" ? normFight(e, c) : leg.kind === "tennis" ? normMatch(e, c) : normField(e, c, sport.unit);
        }
      } catch (err) {
        console.warn("refresh", leg, err);
        if (!games[key]) games[key] = { error: true };
      }
    }));
    lastUpdate = new Date();
    renderAll();
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    const soon = state.legs.some((l) => {
      const g = games[gameKey(l)];
      return !g || g.error || g.state === "in" || (g.state === "pre" && new Date(g.date) - Date.now() < 15 * 60000);
    });
    if (state.legs.length) timer = setTimeout(refresh, soon ? REFRESH_LIVE : REFRESH_IDLE);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.legs.length) refresh(); });

  // ================================================================ BOARD
  const curSport = () => window.sportByKey(board.sport);
  const curPath = () => { const s = curSport(); return s.leagues ? s.leagues[board.league]?.path : s.path; };
  const curLabel = () => { const s = curSport(); return s.leagues ? s.leagues[board.league]?.label : s.label; };
  const usesDate = (s) => s.kind === "team" || s.kind === "tennis";

  async function loadBoard() {
    const sport = curSport();
    board.loading = true; board.err = false; board.draft = null; board.search = "";
    renderBoard();
    try {
      board.data = await getJSON(sbURL(sport, curPath(), usesDate(sport) ? apiDate(board.date) : null));
    } catch (_) { board.data = null; board.err = true; }
    board.loading = false;
    renderBoard();
  }

  function renderBoard() {
    const sport = curSport();
    const tabs = SPORTS.map((s) => `<button type="button" data-sport="${s.key}" aria-pressed="${s.key === board.sport}">${esc(s.label)}</button>`).join("");
    const league = sport.leagues
      ? `<select id="leagueSel" class="input" aria-label="League">${sport.leagues.map((l, i) => `<option value="${i}" ${i === board.league ? "selected" : ""}>${esc(l.label)}</option>`).join("")}</select>` : "";
    const date = usesDate(sport)
      ? `<div class="date-nav"><button type="button" class="icon-btn" data-day="-1" aria-label="Previous day">‹</button>
         <input type="date" id="boardDate" class="input" value="${board.date}">
         <button type="button" class="icon-btn" data-day="1" aria-label="Next day">›</button></div>` : `<span class="muted small">Current event</span>`;
    const search = sport.kind === "field" ? `<input id="fieldSearch" class="input" type="search" placeholder="Find a ${sport.unit === "golf" ? "golfer" : "driver"}" value="${esc(board.search)}">` : "";
    $("#board").innerHTML = `
      <div class="board-controls">
        <div class="seg seg-sm sport-tabs" role="group" aria-label="Sport">${tabs}</div>
        <div class="board-sub">${league}${date}${search}</div>
      </div>
      <div id="boardList" class="board-list"></div>`;
    renderBoardList();
  }

  function renderBoardList() {
    const el = $("#boardList");
    if (!el) return;
    const sport = curSport();
    if (board.loading) { el.innerHTML = `<p class="muted pad">Loading ${esc(curLabel())}…</p>`; return; }
    if (board.err) { el.innerHTML = `<p class="muted pad">Couldn't load ${esc(curLabel())}. Check your connection and try again.</p>`; return; }
    const events = board.data?.events || [];
    board.byId = {};
    let html = "";
    if (sport.kind === "team") html = events.map(teamMatchup).join("");
    else if (sport.kind === "fight") html = events.map(fightEvent).join("");
    else if (sport.kind === "tennis") html = events.map(tennisEvent).join("");
    else html = events.map(fieldEvent).join("");
    el.innerHTML = html.trim() ? html : `<p class="muted pad">No ${esc(curLabel())} ${usesDate(sport) ? "games on this date" : "event right now"}.${usesDate(sport) ? " Try another day." : ""}</p>`;
  }

  const mk = (attrs, top, sub, cls = "") => `<button type="button" class="mk ${cls}" data-act="pick" ${attrs}>${top}${sub ? `<small>${sub}</small>` : ""}</button>`;

  function teamMatchup(e) {
    const sport = curSport(), fam = FAMILIES[sport.family];
    const c = e.competitions[0];
    const teams = awayHome(c.competitors.map(teamOf));
    const state = e.status.type.state;
    const m = {
      mid: String(e.id), kind: "team", eventId: String(e.id), date: e.date, state, teams,
      odds: parseOdds(c.odds?.[0], teams, fam), label: `${teams[0].abbr} at ${teams[1].abbr}`,
    };
    board.byId[m.mid] = m;
    const o = m.odds || { ml: {}, sp: {} };
    const status = state === "pre" ? fmtWhen(e.date) : esc(e.status.type.shortDetail);
    const rows = teams.map((t, i) => {
      const sp = o.sp?.[t.id];
      const side = i === 0 ? "over" : "under";
      const tot = o.total;
      return `
        <div class="mt"><img src="${esc(t.logo)}" alt="" loading="lazy"><span class="mt-name">${esc(t.name)}</span>
          ${t.record ? `<span class="mt-rec">${esc(t.record)}</span>` : ""}${state !== "pre" ? `<b class="mt-score">${t.score}</b>` : ""}</div>
        ${mk(`data-mid="${m.mid}" data-market="spread" data-pick="${t.id}"`, sp ? fmtLine(sp.line) : "—", sp?.odds != null ? fmtOdds(sp.odds) : "")}
        ${mk(`data-mid="${m.mid}" data-market="ml" data-pick="${t.id}"`, o.ml?.[t.id] != null ? fmtOdds(o.ml[t.id]) : "Win", "")}
        ${mk(`data-mid="${m.mid}" data-market="total" data-side="${side}"`, tot ? `${i === 0 ? "O" : "U"} ${tot.line}` : i === 0 ? "Over" : "Under", tot?.[side] != null ? fmtOdds(tot[side]) : "")}`;
    }).join("");
    const draw = fam.draw ? `<div class="mt"><span class="mt-name muted">Draw</span></div><span></span>${mk(`data-mid="${m.mid}" data-market="draw"`, o.draw != null ? fmtOdds(o.draw) : "Draw", "")}<span></span>` : "";
    return `
      <div class="match card ${board.draft?.mid === m.mid ? "is-open" : ""}" data-mid="${m.mid}">
        <div class="match-meta"><span class="${state === "in" ? "txt-live" : ""}">${status}</span>${o.provider ? `<span class="muted">Lines: ${esc(o.provider)}</span>` : ""}</div>
        <div class="match-grid">
          <span></span><span class="mh">${esc(fam.spreadName)}</span><span class="mh">Moneyline</span><span class="mh">Total</span>
          ${rows}${draw}
        </div>
        <div class="match-more">
          ${mk(`data-mid="${m.mid}" data-market="prop"`, "Player props", "", "mk-text")}
          ${mk(`data-mid="${m.mid}" data-market="teamTotal" data-pick="${teams[0].id}"`, "Team totals", "", "mk-text")}
        </div>
        ${board.draft?.mid === m.mid ? editorHTML(m) : ""}
      </div>`;
  }

  function fightEvent(e) {
    const comps = [...allComps(e)].reverse();   // ESPN lists prelims first; show the main event first
    const fights = comps.map((c) => {
      const f = normFight(e, c);
      const m = { ...f, mid: f.id, eventId: String(e.id), compId: f.id, label: f.fighters.map((x) => x.name).join(" vs. ") };
      board.byId[m.mid] = m;
      const rows = f.fighters.map((x) => `
        <div class="mt">${x.flag ? `<img src="${esc(x.flag)}" alt="" class="flag" loading="lazy">` : ""}<span class="mt-name">${esc(x.name)}</span>
          ${x.record ? `<span class="mt-rec">${esc(x.record)}</span>` : ""}${x.winner ? `<b class="mt-score up">W</b>` : ""}</div>
        ${mk(`data-mid="${m.mid}" data-market="winner" data-pick="${x.id}"`, "To win", "")}`).join("");
      return `
        <div class="match card ${board.draft?.mid === m.mid ? "is-open" : ""}">
          <div class="match-meta"><span class="${f.state === "in" ? "txt-live" : ""}">${esc(f.detail)}</span><span class="muted">${esc(f.weight)} · ${f.rounds} rds</span></div>
          <div class="match-grid two">${rows}</div>
          <div class="match-more">
            ${mk(`data-mid="${m.mid}" data-market="rounds" data-side="over"`, "Total rounds", "", "mk-text")}
            ${mk(`data-mid="${m.mid}" data-market="distance" data-side="yes"`, "Goes the distance", "", "mk-text")}
          </div>
          ${board.draft?.mid === m.mid ? editorHTML(m) : ""}
        </div>`;
    }).join("");
    return `<div class="event-head"><h3>${esc(e.name)}</h3><span class="muted small">${esc(fmtWhen(e.date))}</span></div>${fights}`;
  }

  function tennisEvent(e) {
    const comps = allComps(e)
      .filter((c) => ymdLocal(new Date(c.date)) === board.date || stateOf(c, e) === "in")
      .sort((a, b) => (/doubles/i.test(a._group) - /doubles/i.test(b._group)) || new Date(a.date) - new Date(b.date));
    if (!comps.length) return "";
    const rows = comps.map((c) => {
      const t = normMatch(e, c);
      const m = { ...t, mid: t.id, eventId: String(e.id), compId: t.id, label: t.players.map((p) => p.name).join(" vs. ") };
      board.byId[m.mid] = m;
      const ps = t.players.map((p) => `
        <div class="mt">${p.flag ? `<img src="${esc(p.flag)}" alt="" class="flag" loading="lazy">` : ""}<span class="mt-name">${esc(p.name)}</span>
          ${t.state !== "pre" ? `<span class="mt-sets mono">${p.sets.map((s) => s.g).join(" ")}</span>` : ""}${p.winner ? `<b class="mt-score up">W</b>` : ""}</div>
        ${mk(`data-mid="${m.mid}" data-market="winner" data-pick="${p.id}"`, "To win", "")}`).join("");
      return `
        <div class="match card ${board.draft?.mid === m.mid ? "is-open" : ""}">
          <div class="match-meta"><span class="${t.state === "in" ? "txt-live" : ""}">${esc(t.detail)}</span><span class="muted">${esc([t.group, t.round].filter(Boolean).join(" · "))}</span></div>
          <div class="match-grid two">${ps}</div>
          <div class="match-more">${mk(`data-mid="${m.mid}" data-market="games" data-side="over"`, "Total games", "", "mk-text")}</div>
          ${board.draft?.mid === m.mid ? editorHTML(m) : ""}
        </div>`;
    }).join("");
    return `<div class="event-head"><h3>${esc(e.name)}</h3></div>${rows}`;
  }

  function fieldEvent(e) {
    const sport = curSport();
    const c = pickFieldComp(e);
    if (!c) return "";
    const f = normField(e, c, sport.unit);
    const m = { ...f, mid: f.id, eventId: String(e.id), compId: f.id, label: e.name };
    board.byId[m.mid] = m;
    const q = board.search.trim().toLowerCase();
    const list = f.entrants.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, q ? 200 : 60);
    const golf = sport.unit === "golf";
    const rows = list.map((p) => `
      <button type="button" class="entrant" data-act="pick" data-mid="${m.mid}" data-market="win" data-pick="${p.id}">
        <span class="mono pos">${f.state === "pre" ? "" : posLabel(p)}</span>
        <span class="ent-name">${p.flag ? `<img src="${esc(p.flag)}" alt="" class="flag" loading="lazy">` : ""}${esc(p.name)}</span>
        ${golf && f.state !== "pre" ? `<span class="mono">${esc(p.scoreText)}</span><span class="mono muted">${esc(p.thru)}</span>` : "<span></span><span></span>"}
      </button>`).join("");
    return `
      <div class="match card ${board.draft?.mid === m.mid ? "is-open" : ""}">
        <div class="event-head inside"><h3>${esc(e.name)}</h3><span class="muted small ${f.state === "in" ? "txt-live" : ""}">${esc(f.detail)}</span></div>
        ${board.draft?.mid === m.mid ? editorHTML(m) : ""}
        <p class="muted small">Tap a ${golf ? "golfer" : "driver"} to bet them to win or finish top 3, 5, 10 or 20.</p>
        <div class="entrants">
          <div class="entrant head"><span>Pos</span><span>${golf ? "Golfer" : "Driver"}</span>${golf ? "<span>Score</span><span>Thru</span>" : "<span></span><span></span>"}</div>
          ${rows || `<p class="muted small pad">No one matches "${esc(board.search)}".</p>`}
        </div>
        ${!q && f.entrants.length > 60 ? `<p class="muted small">Showing the top 60. Search to find anyone else.</p>` : ""}
      </div>`;
  }

  // ------------------------------------------------------------- editor
  function marketsFor(m) {
    const fam = FAMILIES[curSport().family];
    if (m.kind === "team") return [["ml", "Moneyline"], fam.draw && ["draw", "Draw"], ["spread", fam.spreadName], ["total", "Game total"], ["teamTotal", "Team total"], ["prop", "Player prop"]].filter(Boolean);
    if (m.kind === "fight") return [["winner", "Fighter to win"], ["rounds", "Total rounds"], ["distance", "Goes the distance"]];
    if (m.kind === "tennis") return [["winner", "Match winner"], ["games", "Total games"]];
    return [["win", "To win"], ["top", "Top finish"]];
  }

  function applyDefaults(m, d) {
    const o = m.odds || {};
    d.line = ""; d.odds = "";
    if (["total", "teamTotal", "prop", "rounds", "games"].includes(d.market) && !["over", "under"].includes(d.side)) d.side = "over";
    if (d.market === "distance" && !["yes", "no"].includes(d.side)) d.side = "yes";
    if (m.kind === "team") {
      if (["ml", "spread", "teamTotal"].includes(d.market) && !m.teams.some((t) => t.id === d.pick)) d.pick = m.teams[0].id;
      if (d.market === "ml") d.odds = o.ml?.[d.pick] ?? "";
      if (d.market === "draw") d.odds = o.draw ?? "";
      if (d.market === "spread" && o.sp?.[d.pick]) { d.line = o.sp[d.pick].line; d.odds = o.sp[d.pick].odds ?? ""; }
      if (d.market === "total" && o.total) { d.line = o.total.line; d.odds = (d.side === "under" ? o.total.under : o.total.over) ?? ""; }
      if (d.market === "prop") { d.stat ||= FAMILIES[curSport().family].props[0].k; loadRosters(m); }
    }
    if (m.kind === "fight") {
      if (d.market === "rounds") d.line = (m.rounds || 3) - 0.5;
      if (d.market === "winner" && !m.fighters.some((f) => f.id === d.pick)) d.pick = m.fighters[0]?.id;
    }
    if (m.kind === "tennis") {
      if (d.market === "games") d.line = 22.5;
      if (d.market === "winner" && !m.players.some((p) => p.id === d.pick)) d.pick = m.players[0]?.id;
    }
    if (m.kind === "field") {
      if (d.market === "top") d.line = 10;
      if (!m.entrants.some((p) => p.id === d.pick)) d.pick = m.entrants[0]?.id;
    }
    if (d.odds !== "" && d.odds != null) d.odds = fmtOdds(Number(d.odds));
  }

  async function loadRosters(m) {
    if (board.rosters[m.mid]) return;
    board.rosters[m.mid] = { loading: true, teams: [] };
    const path = curPath();
    try {
      const teams = await Promise.all(m.teams.map(async (t) => {
        const r = await getJSON(`${API}${path}/teams/${t.id}/roster`);
        const out = [];
        const add = (a) => a && a.id && out.push({ id: String(a.id), name: a.displayName || a.fullName || "", pos: a.position?.abbreviation || "", headshot: a.headshot?.href || "" });
        (r.athletes || []).forEach((g) => {
          if (g.items) { if (!/practice|suspend/i.test(g.position || "")) g.items.forEach(add); } else add(g);
        });
        out.sort((a, b) => a.name.localeCompare(b.name));
        return { team: t, players: out };
      }));
      board.rosters[m.mid] = { loading: false, teams };
    } catch (_) {
      board.rosters[m.mid] = { loading: false, teams: [], err: true };
    }
    if (board.draft?.mid === m.mid) renderBoardList();
  }

  function editorHTML(m) {
    const d = board.draft;
    const fam = FAMILIES[curSport().family];
    const opts = (arr, sel) => arr.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? "selected" : ""}>${esc(l)}</option>`).join("");
    const field = (label, inner, wide) => `<label class="fld ${wide ? "wide" : ""}"><span>${label}</span>${inner}</label>`;
    const sel = (name, arr, val) => `<select class="input" data-d="${name}">${opts(arr, val)}</select>`;
    const inp = (name, val, ph, mode = "decimal") => `<input class="input" data-d="${name}" value="${esc(val)}" placeholder="${ph}" inputmode="${mode}" autocomplete="off">`;
    const pr = d.market === "prop" ? propOf(fam, d.stat) : null;
    let f = field("Bet", sel("market", marketsFor(m), d.market));

    if (m.kind === "team" && ["ml", "spread", "teamTotal"].includes(d.market)) f += field("Team", sel("pick", m.teams.map((t) => [t.id, t.name]), d.pick));
    if (d.market === "prop") {
      const ro = board.rosters[m.mid];
      const players = !ro || ro.loading ? `<select class="input" disabled><option>Loading players…</option></select>`
        : ro.err ? `<select class="input" disabled><option>Couldn't load players</option></select>`
        : `<select class="input" data-d="player"><option value="">Choose a player</option>${ro.teams.map((t) =>
            `<optgroup label="${esc(t.team.name)}">${t.players.map((p) => `<option value="${p.id}" ${p.id === d.player ? "selected" : ""}>${esc(p.name)}${p.pos ? " · " + esc(p.pos) : ""}</option>`).join("")}</optgroup>`).join("")}</select>`;
      f += field("Player", players, true);
      f += field("Stat", sel("stat", fam.props.map((p) => [p.k, p.label]), d.stat));
    }
    if (m.kind === "fight" && d.market === "winner") f += field("Fighter", sel("pick", m.fighters.map((x) => [x.id, x.name]), d.pick));
    if (m.kind === "tennis" && d.market === "winner") f += field("Player", sel("pick", m.players.map((x) => [x.id, x.name]), d.pick));
    if (m.kind === "field") {
      f += field(m.unit === "golf" ? "Golfer" : "Driver", sel("pick", m.entrants.map((x) => [x.id, x.name]), d.pick), true);
      if (d.market === "top") f += field("Finish", sel("line", [[3, "Top 3"], [5, "Top 5"], [10, "Top 10"], [20, "Top 20"]], d.line));
    }
    const needsSide = ["total", "teamTotal", "rounds", "games"].includes(d.market) || (d.market === "prop" && !pr?.yes);
    if (needsSide) f += field("Over / under", sel("side", [["over", "Over"], ["under", "Under"]], d.side));
    if (d.market === "distance") f += field("Pick", sel("side", [["yes", "Yes, goes the distance"], ["no", "No, ends early"]], d.side));
    const needsLine = ["spread", "total", "teamTotal", "rounds", "games"].includes(d.market) || (d.market === "prop" && !pr?.yes);
    if (needsLine) f += field("Line", inp("line", d.line, d.market === "spread" ? "-3.5" : "4.5"));
    f += field("Odds <em>(optional)</em>", inp("odds", d.odds, "-110", "text"));

    const hints = {
      prop: pr?.yes ? "Graded as 1 or more." : "Tip: \"5 or more\" is Over 4.5.",
      spread: "Minus for the favorite, plus for the underdog.",
      ml: fam?.draw ? "Soccer moneylines are settled on 90 minutes plus stoppage time." : "",
      top: "Ties at the cutoff can be paid at a reduced rate (dead heat) by your sportsbook.",
    };
    return `
      <div class="editor" data-editor>
        <div class="editor-row">${f}</div>
        <div class="editor-foot">
          <span class="muted small">${esc(hints[d.market] || "Lines are pre-filled when available. Change them to match your sportsbook.")}</span>
          <span class="editor-err" id="editorErr"></span>
          <div class="editor-btns"><button type="button" class="btn btn-ghost btn-sm" data-act="cancel">Cancel</button>
          <button type="button" class="btn btn-sm" data-act="add">Add to slip</button></div>
        </div>
      </div>`;
  }

  function addFromDraft() {
    const d = board.draft;
    const m = d && board.byId[d.mid];
    if (!m) return;
    const sport = curSport();
    const fam = FAMILIES[sport.family];
    const errEl = $("#editorErr");
    const fail = (msg) => { if (errEl) errEl.textContent = msg; };
    const pr = d.market === "prop" ? propOf(fam, d.stat) : null;
    const needsLine = ["spread", "total", "teamTotal", "rounds", "games", "top"].includes(d.market) || (d.market === "prop" && !pr?.yes);
    const line = parseFloat(d.line);
    if (needsLine && !isFinite(line)) return fail("Enter a line.");
    let odds = null;
    if (String(d.odds ?? "").trim()) {
      odds = parseOddsInput(d.odds);
      if (odds == null) return fail("Odds should look like -110 or +150.");
    }
    const leg = {
      id: uid(), sport: sport.key, sportLabel: curLabel(), path: curPath(), kind: m.kind,
      eventId: m.eventId, compId: m.compId || null,
      date: usesDate(sport) ? apiDate(board.date) : apiDate(ymdLocal(new Date(m.date))),
      market: d.market, matchup: m.label, odds,
    };
    if (needsLine) leg.line = line;
    if (["total", "teamTotal", "rounds", "games", "distance"].includes(d.market) || (d.market === "prop" && !pr?.yes)) leg.side = d.side;
    if (m.kind === "team") {
      leg.teams = m.teams.map((t) => ({ id: t.id, abbr: t.abbr, logo: t.logo }));
      if (["ml", "spread", "teamTotal"].includes(d.market)) {
        const t = m.teams.find((x) => x.id === d.pick);
        Object.assign(leg, { teamId: t.id, pick: t.name, logo: t.logo });
      }
      if (d.market === "prop") {
        if (!d.player) return fail("Choose a player.");
        const ro = board.rosters[m.mid];
        let pl = null, team = null;
        ro?.teams.forEach((t) => { const p = t.players.find((x) => x.id === d.player); if (p) { pl = p; team = t.team; } });
        if (!pl) return fail("Choose a player.");
        Object.assign(leg, { playerId: pl.id, pick: pl.name, headshot: pl.headshot, teamId: team.id, stat: d.stat });
      }
    }
    if (m.kind === "fight" || m.kind === "tennis" || m.kind === "field") {
      const list = m.fighters || m.players || m.entrants;
      if (["winner", "win", "top"].includes(d.market)) {
        const p = list.find((x) => x.id === d.pick);
        if (!p) return fail("Choose who you're betting on.");
        Object.assign(leg, { pickId: p.id, pick: p.name, flag: p.flag || "" });
      }
    }
    state.legs.push(leg);
    save();
    board.draft = null;
    toast(`Added: ${slipTitle(leg)}`);
    renderAll();
    refresh();
  }

  // ============================================================ RENDER: slip
  function combined(legs) {
    const counted = legs.filter((l) => !["void", "push"].includes(grade(l, games[gameKey(l)]).cls));
    if (!counted.length || counted.some((l) => l.odds == null)) return null;
    const dec = counted.reduce((p, l) => p * toDec(l.odds), 1);
    return { dec, am: toAm(dec) };
  }

  function renderSlip() {
    const el = $("#slip");
    const legs = state.legs;
    const c = combined(legs);
    const rows = legs.map((l) => {
      const r = grade(l, games[gameKey(l)]);
      return `
        <div class="slip-leg">
          <div class="slip-main">
            <div class="slip-pick">${esc(slipTitle(l))}</div>
            <div class="slip-sub">${esc(l.matchup || "")} · ${esc(l.sportLabel || "")}</div>
            <span class="pill ${r.cls}">${esc(r.label)}</span>
          </div>
          <input class="input odds-in" data-odds-for="${l.id}" value="${esc(fmtOdds(l.odds))}" placeholder="Odds" aria-label="Odds" inputmode="text">
          <button type="button" class="x" data-remove="${l.id}" aria-label="Remove leg">×</button>
        </div>`;
    }).join("");
    el.innerHTML = `
      <div class="slip-head"><h3>Your slip</h3><span class="muted small">${legs.length} ${legs.length === 1 ? "leg" : "legs"}</span></div>
      ${legs.length ? rows : `<p class="muted small slip-empty">Pick a sport, then tap a line to add it. Moneylines, spreads, totals and player props all go here.</p>`}
      ${legs.length ? `
      <div class="slip-foot">
        <div class="slip-line"><span>Parlay odds</span><b class="mono">${c ? fmtOdds(c.am) : "—"}</b></div>
        <label class="slip-line"><span>Stake</span><input id="stakeIn" class="input stake" value="${state.stake}" inputmode="decimal" aria-label="Stake"></label>
        <div class="slip-line"><span>Pays</span><b class="mono">${c ? money(state.stake * c.dec) : "—"}</b></div>
        ${c ? "" : `<p class="muted small">Add odds to every leg to see the payout.</p>`}
        <button type="button" class="btn slip-go" data-view="track">Track live</button>
        <button type="button" class="btn btn-ghost btn-sm" id="clearBtn">Clear slip</button>
      </div>` : ""}`;
    const bar = $("#slipBar");
    bar.hidden = !legs.length || view !== "build";
    bar.innerHTML = `<span>Slip · ${legs.length} ${legs.length === 1 ? "leg" : "legs"}${c ? " · " + fmtOdds(c.am) : ""}</span><span aria-hidden="true">↓</span>`;
  }

  // ========================================================== RENDER: track
  function renderTrack() {
    const legs = state.legs;
    $("#trackEmpty").hidden = legs.length > 0;
    const results = legs.map((l) => grade(l, games[gameKey(l)]));
    $("#legs").innerHTML = legs.map((l, i) => legCard(l, games[gameKey(l)], results[i])).join("");
    const s = $("#summary");
    if (!legs.length) { s.hidden = true; return; }
    const n = (k) => results.filter((r) => r.cls === k).length;
    const won = n("won"), lost = n("lost"), live = n("live"), pending = n("pending"), voided = n("void") + n("push");
    const counted = legs.length - voided;
    const title = lost ? "Parlay lost" : won === counted && counted > 0 ? "Parlay hit" : `${won} of ${counted} legs hit`;
    const c = combined(legs);
    s.hidden = false;
    s.className = "summary card " + (lost ? "is-lost" : won === counted && counted > 0 ? "is-won" : live ? "is-live" : "");
    s.innerHTML = `
      <div><h2>${title}</h2>
        <div class="pills">
          ${won ? `<span class="pill won">${won} hit</span>` : ""}${live ? `<span class="pill live">${live} live</span>` : ""}
          ${pending ? `<span class="pill pending">${pending} not started</span>` : ""}${lost ? `<span class="pill lost">${lost} lost</span>` : ""}
          ${voided ? `<span class="pill void">${voided} void or push</span>` : ""}
        </div></div>
      ${c ? `<div class="sum-odds"><span class="muted small">Odds</span><b class="mono">${fmtOdds(c.am)}</b><span class="muted small">${money(state.stake)} pays ${money(state.stake * c.dec)}</span></div>` : ""}`;
  }

  function cardShell(leg, res, head, body) {
    return `
      <article class="leg-card is-${res.cls}">
        <div class="leg-top"><span class="tag">${esc(leg.sportLabel || "")}</span><span class="muted small">${esc(leg.matchup || "")}</span>
          <button type="button" class="x" data-remove="${leg.id}" aria-label="Remove leg">×</button></div>
        <div class="leg-head">${head}
          <div class="leg-right"><span class="pill ${res.cls}">${esc(res.label)}</span>${leg.odds != null ? `<span class="mono muted small">${fmtOdds(leg.odds)}</span>` : ""}</div>
        </div>
        ${body}
      </article>`;
  }
  const title = (img, name, sub, cls = "") => `${img ? `<img class="${cls}" src="${esc(img)}" alt="" loading="lazy">` : ""}
    <div class="leg-title"><div class="name">${esc(name)}</div><div class="pick">${esc(sub)}</div></div>`;

  function legCard(leg, g, res) {
    if (leg.kind === "team" && leg.market === "prop") return propCard(leg, g, res);
    if (leg.kind === "team") return teamCard(leg, g, res);
    if (leg.kind === "fight") return fightCard(leg, g, res);
    if (leg.kind === "tennis") return tennisCard(leg, g, res);
    return fieldCard(leg, g, res);
  }

  function situationText(g) {
    const s = g?.situation;
    if (!s || g.state !== "in") return "";
    if (s.downDistanceText) {
      const pos = g.teams.find((t) => t.id === String(s.possession));
      return `${pos ? pos.abbr + " ball · " : ""}${s.downDistanceText}${s.isRedZone ? " · Red zone" : ""}`;
    }
    if (s.outs != null || s.balls != null) {
      const bases = [s.onFirst && "1st", s.onSecond && "2nd", s.onThird && "3rd"].filter(Boolean);
      const parts = [`${s.balls ?? 0}-${s.strikes ?? 0} count, ${s.outs ?? 0} out`, bases.length ? "On " + bases.join(", ") : "Bases empty"];
      if (s.batter?.athlete?.displayName) parts.push("At bat: " + s.batter.athlete.displayName);
      if (s.pitcher?.athlete?.displayName) parts.push("Pitching: " + s.pitcher.athlete.displayName);
      return parts.join(" · ");
    }
    return "";
  }

  function lineScore(g) {
    const n = Math.max(...g.teams.map((t) => t.lines.length));
    if (!n || g.state === "pre") return "";
    const head = Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join("");
    const rows = g.teams.map((t) => `<tr><th>${esc(t.abbr)}</th>${Array.from({ length: n }, (_, i) => `<td>${esc(t.lines[i] ?? "")}</td>`).join("")}<td class="tot">${t.score}</td></tr>`).join("");
    return `<div class="linescore"><table class="mono"><thead><tr><th></th>${head}<th>T</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function onFloor(leg, g) {
    const fam = famOf(leg);
    if (g.state !== "in" || !(fam === FAMILIES.basketball || fam === FAMILIES.hockey)) return "";
    const rows = g.teams.map((t) => {
      const on = Object.values(g.players).filter((p) => p.teamId === t.id && p.on).map((p) => esc(p.short));
      return on.length ? `<div><b>${esc(t.abbr)}:</b> ${on.join(", ")}</div>` : "";
    }).join("");
    return rows ? `<div class="floor"><span class="tag">${esc(fam.onLabel[0])}</span>${rows}</div>` : "";
  }

  function teamCard(leg, g, res) {
    const mine = g?.teams?.find((t) => t.id === String(leg.teamId));
    const head = leg.market === "total" || leg.market === "draw"
      ? title("", leg.matchup, betText(leg))
      : title(mine?.logo || leg.logo, mine?.name || leg.pick, betText(leg), "logo");
    if (!g || g.error) return cardShell(leg, res, head, "");
    const team = (t) => `<div class="team ${t.id === String(leg.teamId) ? "mine" : ""}">
      <img src="${esc(t.logo)}" alt="" loading="lazy"><div class="abbr">${esc(t.abbr)}</div><div class="pts mono">${g.state === "pre" ? "–" : t.score}</div></div>`;
    const [a, b] = g.teams;
    const fam = famOf(leg);
    const extra = leg.market === "total" && g.state !== "pre" ? `<p class="center muted small">Combined: <b class="strong">${res.current}</b> (line ${leg.line})</p>` : "";
    const sit = situationText(g);
    return cardShell(leg, res, head, `
      <div class="bigscore">${team(a)}<div class="clock ${g.state}">${esc(g.detail)}</div>${team(b)}</div>
      ${extra}${sit ? `<p class="situation">${esc(sit)}</p>` : ""}
      ${lineScore(g)}${onFloor(leg, g)}`);
  }

  const CAT_TITLES = { passing: "Passing", rushing: "Rushing", receiving: "Receiving", defensive: "Defense", interceptions: "Interceptions", kicking: "Kicking", kickReturns: "Kick returns", puntReturns: "Punt returns", batting: "Batting", pitching: "Pitching", skater: "Skater", goalies: "Goalie" };

  function statGroups(leg, p) {
    const fam = famOf(leg);
    const pr = propOf(fam, leg.stat);
    const hl = new Set((pr?.sum || []).map((k) => k));
    let cats = p.cats;
    if (fam.showCats) cats = cats.filter((c) => fam.showCats.includes(c.name));
    const multi = cats.length > 1;
    return cats.map((c) => {
      let cells;
      if (fam.cells?.[c.name]) {
        const byKey = Object.fromEntries(c.cells.map(([k, , v]) => [k, v]));
        cells = fam.cells[c.name].filter(([k]) => byKey[k] != null && (c.name !== "soccer" || k !== "saves" || num(byKey[k]) > 0 || p.pos === "G")).map(([k, label]) => [k, label, byKey[k]]);
      } else cells = c.cells.filter(([k]) => !(fam.hideKeys || []).includes(k));
      const isHl = (k) => (k === "fullInnings.partInnings" ? hl.has(c.name + ".outs") : k.split(/[\/-]/).some((part) => hl.has(c.name + "." + part)));
      return `${multi ? `<div class="cat-title">${esc(CAT_TITLES[c.name] || c.name)}</div>` : ""}
        <div class="statgrid">${cells.map(([k, label, v]) => `<div class="stat ${isHl(k) ? "hl" : ""}"><div class="k">${esc(label)}</div><div class="v mono">${esc(v ?? "0")}</div></div>`).join("")}</div>`;
    }).join("");
  }

  function gameStrip(g) {
    if (!g || g.error || !g.teams) return "";
    const [a, b] = g.teams;
    const sit = situationText(g);
    return `<div class="gamestrip">
      <div class="score"><img src="${esc(a.logo)}" alt="" loading="lazy">${esc(a.abbr)} <b class="mono">${g.state === "pre" ? "" : a.score}</b>
        <span class="muted">${g.state === "pre" ? "at" : "–"}</span>
        <b class="mono">${g.state === "pre" ? "" : b.score}</b> ${esc(b.abbr)}<img src="${esc(b.logo)}" alt="" loading="lazy"></div>
      <div class="clock ${g.state}">${esc(g.detail)}</div>
      ${sit ? `<div class="situation small">${esc(sit)}</div>` : ""}
    </div>`;
  }

  function propCard(leg, g, res) {
    const fam = famOf(leg);
    const p = g?.players?.[String(leg.playerId)];
    const pr = propOf(fam, leg.stat);
    let badge = "";
    if (p && g.state === "in" && p.on != null && fam.onLabel) badge = `<span class="pill ${p.on ? "oncourt" : ""}">${esc(p.on ? fam.onLabel[0] : fam.onLabel[1])}</span>`;
    else if (p && g.state === "post" && p.dnp) badge = `<span class="pill">Did not play</span>`;
    const teamAbbr = g?.teams?.find((t) => t.id === String(leg.teamId))?.abbr || "";
    const head = title(p?.headshot || leg.headshot, p?.name || leg.pick, `${teamAbbr ? teamAbbr + " · " : ""}${betText(leg)}`, "face") + (badge ? `<div class="badge-slot">${badge}</div>` : "");
    const target = res.target ?? propLine(leg);
    const cur = res.current ?? 0;
    const pct = target ? Math.min(100, (cur / (pr?.yes ? 1 : target)) * 100) : 0;
    const progress = `<div class="progress"><div class="bar"><div class="fill" style="width:${pct}%"></div></div>
      <div class="nums"><span><b class="mono">${cur}</b> ${esc((pr?.label || "").toLowerCase())}</span><span class="muted">${pr?.yes ? "needs 1" : "line " + target}</span></div></div>`;
    let body = "";
    if (p && !p.dnp && p.cats.length) body = statGroups(leg, p);
    else if (p && p.dnp && g.state !== "pre") body = `<p class="muted small">${esc(p.reason || "Hasn't played yet")}</p>`;
    else if (g?.state === "in") body = `<p class="muted small">No stats yet.</p>`;
    return cardShell(leg, res, head, progress + body + gameStrip(g));
  }

  function fightCard(leg, g, res) {
    const head = title(leg.flag, leg.market === "winner" ? leg.pick : leg.matchup, betText(leg), "flag-lg");
    if (!g || g.error) return cardShell(leg, res, head, "");
    const rows = g.fighters.map((f) => `<div class="vs-row ${f.id === leg.pickId ? "mine" : ""}">
      ${f.flag ? `<img src="${esc(f.flag)}" alt="" class="flag" loading="lazy">` : ""}<span class="vs-name">${esc(f.name)}</span>
      <span class="muted small">${esc(f.record)}</span>${f.winner ? `<b class="up">Winner</b>` : ""}</div>`).join("");
    return cardShell(leg, res, head, `<div class="vs">${rows}</div>
      <div class="gamestrip"><span class="muted small">${esc(g.weight)} · ${g.rounds} rounds</span><div class="clock ${g.state}">${esc(g.detail)}</div></div>`);
  }

  function tennisCard(leg, g, res) {
    const head = title(leg.flag, leg.market === "winner" ? leg.pick : leg.matchup, betText(leg), "flag-lg");
    if (!g || g.error) return cardShell(leg, res, head, "");
    const n = Math.max(...g.players.map((p) => p.sets.length), 0);
    const rows = g.players.map((p) => `<tr class="${p.id === leg.pickId ? "mine" : ""}"><th>${p.flag ? `<img src="${esc(p.flag)}" alt="" class="flag" loading="lazy">` : ""}${esc(p.name)}${p.winner ? ` <span class="up">✓</span>` : ""}</th>
      ${Array.from({ length: n }, (_, i) => { const s = p.sets[i]; return `<td>${s ? s.g + (s.tb != null ? `<sup>${s.tb}</sup>` : "") : ""}</td>`; }).join("")}</tr>`).join("");
    const extra = leg.market === "games" && g.state !== "pre" ? `<p class="center muted small">Total games: <b class="strong">${res.current}</b> (line ${leg.line})</p>` : "";
    return cardShell(leg, res, head, `${n ? `<div class="linescore"><table class="mono sets"><tbody>${rows}</tbody></table></div>` : ""}${extra}
      <div class="gamestrip"><span class="muted small">${esc([g.group, g.round].filter(Boolean).join(" · "))}</span><div class="clock ${g.state}">${esc(g.detail)}</div></div>`);
  }

  function fieldCard(leg, g, res) {
    const head = title(leg.flag, leg.pick, betText(leg), "flag-lg");
    if (!g || g.error) return cardShell(leg, res, head, "");
    const me = g.entrants.find((x) => x.id === leg.pickId);
    const golf = g.unit === "golf";
    const stats = me ? `<div class="statgrid">
        <div class="stat hl"><div class="k">Position</div><div class="v mono">${g.state === "pre" ? "–" : posLabel(me)}</div></div>
        ${golf ? `<div class="stat"><div class="k">To par</div><div class="v mono">${esc(me.scoreText || "–")}</div></div>
        <div class="stat"><div class="k">Thru</div><div class="v mono">${esc(me.thru)}</div></div>
        <div class="stat"><div class="k">Today</div><div class="v mono">${esc(me.today || "–")}</div></div>` : ""}
      </div>` : "";
    const top = g.state === "pre" ? "" : `<div class="mini-board">${g.entrants.slice(0, 5).map((p) => `<div class="${p.id === leg.pickId ? "mine" : ""}">
      <span class="mono">${posLabel(p)}</span><span>${esc(p.name)}</span><span class="mono">${golf ? esc(p.scoreText) : ""}</span></div>`).join("")}</div>`;
    return cardShell(leg, res, head, stats + top + `<div class="gamestrip"><span class="muted small">${esc(g.eventName)}</span><div class="clock ${g.state}">${esc(g.detail)}</div></div>`);
  }

  // ============================================================ RENDER: all
  function renderAll() {
    $$("[data-view-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.viewTab === view)));
    $("#buildView").hidden = view !== "build";
    $("#trackView").hidden = view !== "track";
    $("#legCount").textContent = state.legs.length ? `(${state.legs.length})` : "";
    $("#shareBtn").hidden = !state.legs.length;
    renderSlip();
    renderTrack();
    const anyLive = Object.values(games).some((g) => g.state === "in");
    const pill = $("#livePill");
    pill.dataset.state = anyLive ? "live" : "";
    $("#liveText").textContent = !state.legs.length ? "No legs yet"
      : lastUpdate ? `${anyLive ? "Live · " : ""}Updated ${lastUpdate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "Loading…";
  }

  function setView(v) {
    view = v;
    store.set("pa-view", v);
    renderAll();
    if (v === "build" && !board.data && !board.loading) loadBoard();
  }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
  }

  // ================================================================ events
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, [data-act]");
    if (!t) return;
    if (t.dataset.viewTab || t.dataset.view) return setView(t.dataset.viewTab || t.dataset.view);
    if (t.dataset.sport) {
      board.sport = t.dataset.sport; board.league = 0; store.set("pa-sport", board.sport);
      return loadBoard();
    }
    if (t.dataset.day) {
      const d = new Date(board.date + "T12:00:00");
      d.setDate(d.getDate() + Number(t.dataset.day));
      board.date = ymdLocal(d);
      return loadBoard();
    }
    if (t.dataset.remove) {
      state.legs = state.legs.filter((l) => l.id !== t.dataset.remove);
      save(); renderAll(); schedule();
      return;
    }
    const act = t.dataset.act;
    if (act === "pick") {
      const m = board.byId[t.dataset.mid];
      if (!m) return;
      board.draft = { mid: m.mid, market: t.dataset.market, pick: t.dataset.pick || "", side: t.dataset.side || "", player: "", stat: "" };
      applyDefaults(m, board.draft);
      renderBoardList();
      const ed = $("[data-editor]");
      if (ed) ed.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    if (act === "cancel") { board.draft = null; return renderBoardList(); }
    if (act === "add") return addFromDraft();
    if (t.id === "clearBtn") {
      if (!confirm("Remove every leg from your slip?")) return;
      state.legs = []; save(); renderAll(); schedule();
      return;
    }
    if (t.id === "refreshBtn") { if (state.legs.length) refresh(); if (view === "build") loadBoard(); return; }
    if (t.id === "shareBtn") return share();
    if (t.id === "slipBar") return $("#slip").scrollIntoView({ behavior: "smooth" });
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "leagueSel") { board.league = Number(t.value); return loadBoard(); }
    if (t.id === "boardDate" && t.value) { board.date = t.value; return loadBoard(); }
    if (t.dataset.d && board.draft) {
      const k = t.dataset.d;
      board.draft[k] = t.value;
      const m = board.byId[board.draft.mid];
      if (["market", "pick", "side"].includes(k) && m) {
        // switching over/under keeps a typed line (except game totals, where the line comes with the odds)
        const keep = k === "side" && board.draft.market !== "total" ? board.draft.line : null;
        applyDefaults(m, board.draft);
        if (keep != null) board.draft.line = keep;
      }
      if (["market", "pick", "side", "stat"].includes(k)) renderBoardList();
      return;
    }
    if (t.dataset.oddsFor) {
      const leg = state.legs.find((l) => l.id === t.dataset.oddsFor);
      if (!leg) return;
      const v = t.value.trim();
      const o = parseOddsInput(v);
      if (v && o == null) { toast("Odds should look like -110 or +150."); t.value = fmtOdds(leg.odds); return; }
      leg.odds = o; save(); renderAll();
      return;
    }
    if (t.id === "stakeIn") {
      const v = parseFloat(t.value.replace(/[$,]/g, ""));
      if (v > 0) state.stake = v;
      save(); renderAll();
    }
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.d && board.draft && (t.tagName === "INPUT")) board.draft[t.dataset.d] = t.value;
    if (t.id === "fieldSearch") {
      board.search = t.value;
      board.draft = null;
      renderBoardList();
    }
  });

  async function share() {
    const code = btoa(unescape(encodeURIComponent(JSON.stringify({ legs: state.legs, stake: state.stake }))));
    const url = `${location.origin}${location.pathname}#p=${code}`;
    try { await navigator.clipboard.writeText(url); toast("Link copied. Anyone with it sees this slip."); }
    catch (_) { prompt("Copy this link:", url); }
  }

  // ================================================================= start
  if (location.hash.startsWith("#p=")) save();
  renderAll();
  if (state.legs.length) refresh();
  if (view === "build") loadBoard();
  else renderBoard();
})();
