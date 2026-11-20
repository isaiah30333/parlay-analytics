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

  const SOCCER_LEAGUES = [
    ["eng.1", "Premier League"], ["uefa.champions", "Champions League"], ["esp.1", "La Liga"],
    ["ita.1", "Serie A"], ["ger.1", "Bundesliga"], ["fra.1", "Ligue 1"], ["usa.1", "MLS"],
    ["mex.1", "Liga MX"], ["uefa.europa", "Europa League"],
  ];

  // kind: team (box scores) | fight | tennis | field (golf, racing)
  window.SPORTS = [
    { key: "nfl", label: "NFL", kind: "team", family: "football", path: "football/nfl", live: "situation" },
    { key: "nba", label: "NBA", kind: "team", family: "basketball", path: "basketball/nba" },
    { key: "ncaaf", label: "NCAAF", kind: "team", family: "football", path: "football/college-football", groups: "80", live: "situation" },
    { key: "ncaab", label: "NCAAB", kind: "team", family: "basketball", path: "basketball/mens-college-basketball", groups: "50" },
    { key: "mlb", label: "MLB", kind: "team", family: "baseball", path: "baseball/mlb", live: "situation" },
    { key: "nhl", label: "NHL", kind: "team", family: "hockey", path: "hockey/nhl" },
    { key: "soccer", label: "Soccer", kind: "team", family: "soccer", leagues: SOCCER_LEAGUES.map(([id, label]) => ({ label, path: "soccer/" + id })) },
    { key: "ufc", label: "UFC", kind: "fight", path: "mma/ufc" },
    { key: "tennis", label: "Tennis", kind: "tennis", leagues: [{ label: "ATP", path: "tennis/atp" }, { label: "WTA", path: "tennis/wta" }] },
    { key: "golf", label: "Golf", kind: "field", unit: "golf", leagues: [{ label: "PGA Tour", path: "golf/pga" }, { label: "LPGA", path: "golf/lpga" }, { label: "LIV", path: "golf/liv" }] },
    { key: "wnba", label: "WNBA", kind: "team", family: "basketball", path: "basketball/wnba" },
    { key: "ncaaw", label: "NCAAW", kind: "team", family: "basketball", path: "basketball/womens-college-basketball", groups: "50" },
    { key: "f1", label: "F1", kind: "field", unit: "race", path: "racing/f1" },
    { key: "nascar", label: "NASCAR", kind: "field", unit: "race", path: "racing/nascar-premier" },
  ];

  window.FAMILIES = FAMILIES;
  window.sportByKey = (k) => window.SPORTS.find((s) => s.key === k);
})();
