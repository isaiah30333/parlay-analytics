# Parlay Analytics

Build a parlay the way you would on a sportsbook, then track every leg on one screen: live score and clock, plus the player's box score, minutes, and whether they're on the floor. It doesn't place bets.

Live site: https://isaiah30333.github.io/parlay-analytics/

## Sports

| Sport | Bets |
| --- | --- |
| NFL, NCAAF | Moneyline, spread, total, team total, player props (anytime TD, passing/rushing/receiving yards, receptions, completions, tackles, sacks, kicking) |
| NBA, NCAAB, WNBA, NCAAW | Moneyline, spread, total, team total, player props (points, rebounds, assists, threes, PRA and other combos, steals, blocks, turnovers) |
| MLB | Moneyline, run line, total, team total, player props (hits, HR, RBIs, runs, H+R+RBI, walks, strikeouts, pitcher strikeouts, outs, hits allowed, earned runs) |
| NHL | Moneyline, puck line, total, team total, player props (anytime goal, goals, assists, points, shots on goal, blocks, hits, saves) |
| Soccer (Premier League, Champions League, Europa League, La Liga, Serie A, Bundesliga, Ligue 1, MLS, Liga MX) | 3-way moneyline with draw, handicap, total, team total, player props (anytime goal, shots, shots on target, assists, saves, cards) |
| UFC | Fighter to win, total rounds, goes the distance |
| Tennis (ATP, WTA) | Match winner, total games |
| Golf (PGA Tour, LPGA, LIV) | To win, top 3/5/10/20 |
| F1, NASCAR | To win, top 3/5/10/20 |

Boxing isn't included because ESPN has no feed for it.

## How it works

- **Build:** pick a sport and date, then tap a line. Moneyline, spread, and total lines and odds are pre-filled from the DraftKings numbers ESPN publishes, when available. Adjust them to match your sportsbook. Player prop lines are typed in.
- **Slip:** shows each leg's live status, the combined parlay odds, and the payout for your stake (once every leg has odds).
- **Track:** one card per leg, with the score, clock, line score, and down and distance (football) or count and runners (baseball). Prop cards add the full stat line with the bet's stats highlighted, plus on-floor / on-ice status. Fights, tennis, golf, and races get their own cards.
- Refreshes every 20 seconds while anything is live. The slip is saved in the browser, and **Share** copies a link to it.

## Files

- `index.html`: page
- `assets/js/config.js`: name, colors, fonts, header photo (same template as isaiah30333.github.io)
- `assets/js/site.js`, `assets/css/base.css`, `assets/css/drawer.css`: copied from the personal site template. Keep them in sync by copying, not editing.
- `assets/js/sports.js`: each sport's ESPN path and its prop list. Add a sport or prop here.
- `assets/js/app.js`: board, bet editor, slip, grading, live tracking
- `assets/css/pages.css`: page styles

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Data notes

All data comes from ESPN's public site API (`site.api.espn.com`), called from the browser. It isn't an official API, so it can change without notice.
- Don't add headers or a `cache` option to `fetch`. That triggers a CORS check, which ESPN rejects. `getJSON` adds a throwaway query parameter instead.
- ESPN blocks headless Chrome's default user agent. When testing with headless Chrome, pass a normal `--user-agent`.
- College scoreboards need `groups=80` (FBS) or `groups=50` (Division I) to list every game, not only featured ones.
- Golf grading uses the tournament's status, because ESPN marks the competition final at the end of each round.

For tracking only. Not affiliated with any sportsbook.
