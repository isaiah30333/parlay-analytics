/* =====================================================================
   SPORTS — what each sport's data looks like and which bets it offers.
   Stat keys are "<category>.<espn key>", e.g. "passing.passingYards".
   Box-score columns like "completions/passingAttempts" are split into
   both keys, so "passing.completions" and "passing.passingAttempts" work.
   ===================================================================== */
(function () {
  // A prop: k = id, label, sum = stat keys added together.
  // yes = a yes/no prop (anytime TD, anytime goal): graded as over 0.5.
  const P = (k, label, sum, extra) => Object.assign({ k, label, sum }, extra || {});

  const FAMILIES = {
    basketball: {
      spreadName: "Spread",
      onLabel: ["On the floor", "On the bench"],
      props: [
        P("PTS", "Points", ["stats.points"]),
        P("REB", "Rebounds", ["stats.rebounds"]),
        P("AST", "Assists", ["stats.assists"]),
        P("3PM", "3-pointers made", ["stats.threePointFieldGoalsMade"]),
        P("PRA", "Pts + Reb + Ast", ["stats.points", "stats.rebounds", "stats.assists"]),
        P("PR", "Pts + Reb", ["stats.points", "stats.rebounds"]),
        P("PA", "Pts + Ast", ["stats.points", "stats.assists"]),
        P("RA", "Reb + Ast", ["stats.rebounds", "stats.assists"]),
        P("STL", "Steals", ["stats.steals"]),
        P("BLK", "Blocks", ["stats.blocks"]),
        P("SB", "Steals + Blocks", ["stats.steals", "stats.blocks"]),
        P("TO", "Turnovers", ["stats.turnovers"]),
      ],
    },
    football: {
      spreadName: "Spread",
      props: [
        P("ATD", "Anytime touchdown", ["rushing.rushingTouchdowns", "receiving.receivingTouchdowns", "kickReturns.kickReturnTouchdowns", "puntReturns.puntReturnTouchdowns"], { yes: true }),
        P("PYD", "Passing yards", ["passing.passingYards"]),
        P("PTD", "Passing TDs", ["passing.passingTouchdowns"]),
        P("CMP", "Completions", ["passing.completions"]),
        P("ATT", "Pass attempts", ["passing.passingAttempts"]),
        P("INT", "Interceptions thrown", ["passing.interceptions"]),
        P("RYD", "Rushing yards", ["rushing.rushingYards"]),
        P("CAR", "Rush attempts", ["rushing.rushingAttempts"]),
        P("REC", "Receptions", ["receiving.receptions"]),
        P("RCY", "Receiving yards", ["receiving.receivingYards"]),
        P("RRY", "Rush + rec yards", ["rushing.rushingYards", "receiving.receivingYards"]),
        P("PRY", "Pass + rush yards", ["passing.passingYards", "rushing.rushingYards"]),
        P("LREC", "Longest reception", ["receiving.longReception"]),
        P("LRUSH", "Longest rush", ["rushing.longRushing"]),
        P("TD", "Touchdowns (rush + rec)", ["rushing.rushingTouchdowns", "receiving.receivingTouchdowns"]),
        P("TKL", "Tackles", ["defensive.totalTackles"]),
        P("SCK", "Sacks", ["defensive.sacks"]),
        P("KPT", "Kicking points", ["kicking.totalKickingPoints"]),
        P("FGM", "Field goals made", ["kicking.fieldGoalsMade"]),
      ],
      hideKeys: ["adjQBR", "QBRating", "yardsPerPassAttempt", "yardsPerRushAttempt", "yardsPerReception", "yardsPerKickReturn", "yardsPerPuntReturn", "fieldGoalPct"],
      showCats: ["passing", "rushing", "receiving", "defensive", "interceptions", "kicking", "kickReturns", "puntReturns"],
    },
    baseball: {
      spreadName: "Run line",
      props: [
        P("H", "Hits", ["batting.hits"]),
        P("HR", "Home runs", ["batting.homeRuns"]),
        P("AHR", "To hit a home run", ["batting.homeRuns"], { yes: true }),
        P("RBI", "RBIs", ["batting.RBIs"]),
        P("R", "Runs", ["batting.runs"]),
        P("HRR", "Hits + Runs + RBIs", ["batting.hits", "batting.runs", "batting.RBIs"]),
        P("BB", "Walks", ["batting.walks"]),
        P("BK", "Batter strikeouts", ["batting.strikeouts"]),
        P("K", "Pitcher strikeouts", ["pitching.strikeouts"]),
        P("OUTS", "Pitching outs", ["pitching.outs"]),
        P("HA", "Hits allowed", ["pitching.hits"]),
        P("ER", "Earned runs allowed", ["pitching.earnedRuns"]),
        P("PBB", "Walks allowed", ["pitching.walks"]),
      ],
      hideKeys: ["pitches", "onBasePct", "slugAvg", "atBats"],
      showCats: ["batting", "pitching"],
    },
    hockey: {
      spreadName: "Puck line",
      onLabel: ["On the ice", "On the bench"],
      props: [
        P("AGS", "Anytime goal", ["skater.goals"], { yes: true }),
        P("G", "Goals", ["skater.goals"]),
        P("A", "Assists", ["skater.assists"]),
        P("PTS", "Points", ["skater.goals", "skater.assists"]),
        P("SOG", "Shots on goal", ["skater.shotsTotal"]),
        P("BLK", "Blocked shots", ["skater.blockedShots"]),
        P("HIT", "Hits", ["skater.hits"]),
        P("SV", "Goalie saves", ["goalies.saves"]),
        P("GA", "Goals against", ["goalies.goalsAgainst"]),
      ],
      // the hockey box score has 21 columns; show the ones bettors look at
      cells: {
        skater: [["goals", "G"], ["assists", "A"], ["shotsTotal", "SOG"], ["plusMinus", "+/-"], ["timeOnIce", "TOI"], ["hits", "HIT"], ["blockedShots", "BLK"], ["penaltyMinutes", "PIM"]],
        goalies: [["saves", "SV"], ["shotsAgainst", "SA"], ["goalsAgainst", "GA"], ["savePct", "SV%"], ["timeOnIce", "TOI"]],
      },
      showCats: ["skater", "goalies"],
    },
    soccer: {
      spreadName: "Handicap",
      draw: true,
      onLabel: ["On the pitch", "Not on the pitch"],
      props: [
        P("AGS", "Anytime goal", ["soccer.totalGoals"], { yes: true }),
        P("G", "Goals", ["soccer.totalGoals"]),
        P("A", "Assists", ["soccer.goalAssists"]),
        P("GA", "Goals + assists", ["soccer.totalGoals", "soccer.goalAssists"]),
        P("SH", "Shots", ["soccer.totalShots"]),
        P("SOT", "Shots on target", ["soccer.shotsOnTarget"]),
        P("SV", "Goalkeeper saves", ["soccer.saves"]),
        P("FC", "Fouls committed", ["soccer.foulsCommitted"]),
        P("CARD", "To be carded", ["soccer.yellowCards", "soccer.redCards"], { yes: true }),
      ],
      cells: {
        soccer: [["totalGoals", "G"], ["goalAssists", "A"], ["totalShots", "SH"], ["shotsOnTarget", "SOT"], ["saves", "SV"], ["foulsCommitted", "FC"], ["yellowCards", "YC"], ["redCards", "RC"]],
      },
      showCats: ["soccer"],
    },
  };

  // Logos are ESPN's own league images (shown on a white tile, so the light versions work in both themes).
  const CDN = "https://a.espncdn.com/";
  const LG = (f) => CDN + "i/teamlogos/leagues/500/" + f + ".png";
  const SL = (id) => CDN + "i/leaguelogos/soccer/500/" + id + ".png";
  const ICON = (f) => CDN + "redesign/assets/img/icons/" + f + ".png";

  const SOCCER_LEAGUES = [
    ["eng.1", "Premier League", 23], ["uefa.champions", "Champions League", 2], ["esp.1", "La Liga", 15],
    ["ita.1", "Serie A", 12], ["ger.1", "Bundesliga", 10], ["fra.1", "Ligue 1", 9], ["usa.1", "MLS", 19],
    ["mex.1", "Liga MX", 22], ["uefa.europa", "Europa League", 2310],
  ];

  // kind: team (box scores) | fight | tennis | field (golf, racing)
  // groups: college filter, used for the scoreboard (groups=) and standings (group=)
  window.SPORTS = [
    { key: "nfl", label: "NFL", logo: LG("nfl"), kind: "team", family: "football", path: "football/nfl", live: "situation" },
    { key: "nba", label: "NBA", logo: LG("nba"), kind: "team", family: "basketball", path: "basketball/nba" },
    { key: "ncaaf", label: "NCAAF", logo: ICON("NCAASports_Football"), kind: "team", family: "football", path: "football/college-football", groups: "80", live: "situation" },
    { key: "ncaab", label: "NCAAB", logo: ICON("NCAASports_MensBasketball"), kind: "team", family: "basketball", path: "basketball/mens-college-basketball", groups: "50" },
    { key: "mlb", label: "MLB", logo: LG("mlb"), kind: "team", family: "baseball", path: "baseball/mlb", live: "situation" },
    { key: "nhl", label: "NHL", logo: LG("nhl"), kind: "team", family: "hockey", path: "hockey/nhl" },
    { key: "soccer", label: "Soccer", logo: ICON("ESPN-icon-soccer"), kind: "team", family: "soccer", leagues: SOCCER_LEAGUES.map(([id, label, n]) => ({ label, path: "soccer/" + id, logo: SL(n) })) },
    { key: "ufc", label: "UFC", logo: LG("ufc"), kind: "fight", path: "mma/ufc" },
    { key: "tennis", label: "Tennis", logo: ICON("ESPN-icon-tennis"), kind: "tennis", leagues: [{ label: "ATP", path: "tennis/atp" }, { label: "WTA", path: "tennis/wta" }] },
    { key: "golf", label: "Golf", logo: ICON("ESPN-icon-golf"), kind: "field", unit: "golf", leagues: [{ label: "PGA Tour", path: "golf/pga", logo: LG("pgatour") }, { label: "LPGA", path: "golf/lpga", logo: LG("lpga") }, { label: "LIV", path: "golf/liv", logo: LG("livgolf") }] },
    { key: "wnba", label: "WNBA", logo: LG("wnba"), kind: "team", family: "basketball", path: "basketball/wnba" },
    { key: "ncaaw", label: "NCAAW", logo: ICON("NCAASports_WomensBasketball"), kind: "team", family: "basketball", path: "basketball/womens-college-basketball", groups: "50" },
    { key: "f1", label: "F1", logo: LG("f1"), kind: "field", unit: "race", path: "racing/f1" },
    { key: "nascar", label: "NASCAR", logo: ICON("ESPN-icon-NASCAR"), kind: "field", unit: "race", path: "racing/nascar-premier" },
  ];

  window.FAMILIES = FAMILIES;
  window.sportByKey = (k) => window.SPORTS.find((s) => s.key === k);
})();
