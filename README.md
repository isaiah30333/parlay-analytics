# Parlay Analytics

Track every leg of a parlay on one page. Add your bets and see each game's live score and clock, plus the full box score line for every player prop: minutes, points, rebounds, assists, threes, and whether the player is on the floor or on the bench.

## What it does

- **Bet types:** moneyline, spread, game total, and player props (points, rebounds, assists, threes, steals, blocks, turnovers, and combos like PRA).
- **Live grading:** each leg shows Hit, Lost, Push, or how far it is from the line ("Needs 3 more", "Up 4", "Short by 3.5").
- **Player detail:** minutes, full stat line, and an on-the-floor / on-the-bench tag while the game is live.
- **Who's on the floor:** the current five for both teams on every game leg.
- **Parlay summary:** legs hit, live, not started, and lost.
- **Auto-refresh:** every 20 seconds while a game is live.
- **Saved and shareable:** your parlay is saved in the browser, and **Share** copies a link with the whole slip.

NBA only for now.

## Run it locally

No build step and no dependencies.

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Host it on GitHub Pages

Settings → Pages → Source: "Deploy from a branch" → Branch: `main`, folder `/ (root)`.

## Data

Scores, box scores, and rosters come from ESPN's public site API (`site.api.espn.com`), called directly from the browser. It isn't an official, documented API, so it can change without notice. Fetches must not add custom headers or cache settings (see `getJSON` in `app.js`): those trigger a CORS preflight that ESPN rejects.

## Files

- `index.html`: page layout and the add-leg dialog
- `styles.css`: styles
- `app.js`: data fetching, leg grading, and rendering

For tracking only. Not affiliated with any sportsbook.
