# fpl-agent — project context

Fantasy Premier League decision tool for manager ID `5725107`. Blends the official FPL API with
transcribed opinion from 11 FPL YouTube channels, and surfaces where the two disagree.

The premise: everyone gets the same expert consensus, so consensus alone earns no rank. Value sits
in players with strong underlying numbers that the pundits (and therefore ownership) haven't caught
up with. The scoring layer exists to find that gap, not to average the two signals together.

## Architecture

Six sequential Node scripts, each reading the previous one's output from disk. No database, no
framework, no dependencies. ES modules, Node 20+.

```
fetch-fpl.js         FPL API      → data/raw/{bootstrap,fixtures,summaries,manager,meta}.json
fetch-understat.js   GitHub mirror→ data/raw/understat.json
fetch-transcripts.js yt-dlp       → data/raw/transcripts.json + data/notebooklm/*.md
extract-opinions.js  Claude API   → data/raw/opinions.json
score.js             merge        → data/board.json
build-dashboard.js   render       → dist/index.html
```

Because every step reads from disk, `npm run score` and `npm run dashboard` are cheap to re-run
while iterating on weights or layout. Don't re-fetch to test a scoring change.

`npm run quick` skips the transcript and API-cost steps. `npm run all` does everything.

## Live-API status

Confirmed working against the real FPL API as of the 2026-27 pre-season: `npm run fpl` through
`npm run score` ran cleanly on the owner's machine with no parsing errors — none of the divergences
below actually materialized, but they're kept here as the checklist that was validated, in case a
future API change reintroduces one of them:

- `element-summary` field names inside `fixtures[]` (`difficulty`, `event`, `is_home`, `team_a`, `team_h`)
- `bootstrap.events` flags — during pre-season no event has `is_current`, which `score.js` handles
- `chance_of_playing_next_round` may be `null` rather than absent for available players
- `entry/{id}/event/{gw}/picks/` 404s until a gameweek has been entered; `fplGet` returns null on 404
- The API works with just a browser User-Agent, no extra auth

If `npm run fpl` or `npm run score` ever errors again, fix the parsing against the real response,
don't patch around it.

## Scoring model

`score.js` z-scores five components across the shortlist, then blends them by the weights in
`config/sources.json` (they should sum to 1):

- `expectedPoints` — a real fixture-adjusted points prediction (`src/lib/predict.js`), not FPL's
  opaque `ep_next`. Ported from a viewer-shared FPL prediction spreadsheet: goal/assist points
  from Understat npxG/xA scaled by how leaky the next opponent's defence is, clean-sheet and
  2+-conceded probability from a Poisson distribution on the team's own goals-against rate,
  defensive-contribution points from a Poisson threshold test (9+ for a DEF, 11+ for anyone
  else). Opponent/own-team goals-for/against come from real match results (`fetch-understat.js`
  also pulls `fixtures.csv`/`teams.csv` from the same mirror). Needs a next fixture, a team-form
  match on both sides, and 450+ Understat minutes for the player — falls back to `ep_next` when
  any of those are missing (young players, promoted-team fixtures with no prior-season data,
  blank gameweeks) rather than asserting a number from nothing. Each player's `pointsSource`
  field in `board.json` says which one was used; `predictedPoints` is always present alongside
  the raw `epNext` for comparison. The position-scoring constants (goal/CS/DC points per
  position) are real current FPL rules, verified against the source spreadsheet's CONTROL sheet
  — if FPL changes scoring rules, update `POSITION_POINTS` in `predict.js` to match.
- `fixtures` — mean of `(5 - difficulty)` over the next N gameweeks
- `threat` — ICT index plus a real underlying-output component: `fetch-understat.js` pulls
  `understat_player.csv` from the `vaastav/Fantasy-Premier-League` GitHub mirror (it already
  scrapes and republishes understat.com's hex-escaped JSON, so this project doesn't have to) and
  `score.js` matches rows to FPL ids through the same name index the opinion matcher uses. Above
  ~450 minutes of Understat sample, `threat` uses real npxG+xA per 90; below that (young players,
  summer signings from outside the PL), it falls back to the old points-per-90 proxy. Each player's
  `underlyingSource` field in `board.json` says which one was used. The mirror's most recent
  populated `understat/` folder is one season behind the current one — check `data/{season}` on the
  mirror each pre-season and bump `SEASON` in `fetch-understat.js` if a newer one exists.

  This prior-season baseline is now blended with the current season as it happens: `fetch-fpl.js`
  already pulls each player's current-season gameweek-by-gameweek history (`summary.history`) —
  `score.js` used to ignore it, now it computes a short-form xG/xA rate from the last
  `scoring.formWindowGws` gameweeks (config/sources.json, default 6) once there's 180+ minutes of
  current-season sample, and blends it with the long-form (prior-season) rate at a weight that
  ramps from 0 to a 70% cap as current-season minutes accumulate — never fully replacing the
  larger long-form sample on a hot or cold run of a few games. This is the actual mechanism
  behind "pre-season scoring is soft, sharpens by GW3" below; before this it was just ICT index
  (0 for everyone pre-season) doing the sharpening on its own.
- `value` — `ep_next` per £m
- `minutes` — from `status` and `chance_of_playing_next_round`

Quadrants come from crossing the data score (65th percentile) with expert score (70th percentile,
requiring 2+ channels covering the player). `aheadOfCurve` flags loud expert coverage at under 12%
ownership — that's where price rises start, so it's the most time-sensitive list on the board.

Pre-season scoring is soft: with no gameweeks played there's no current-season history, so it leans
on `ep_next`, last season's points, and Understat's prior-season underlying numbers. It sharpens
from around GW3 as `ict_index` (0 for everyone pre-season) starts accumulating.

`score.js` also scans the full fixture list for double/blank gameweeks (`board.chipWindows`) —
empty until postponements reshuffle the calendar, usually from around GW25.

## Squad optimiser

`npm run optimise` (`src/optimise-squad.js`) picks the best possible 15-man squad within a
£100.0m budget from `board.json`'s `predictedPoints`, ported from the same shared model's
Solver-based picker. No LP dependency exists in this no-dependencies codebase, so it's built from
exact DP instead (`src/lib/knapsack.js`): a 0/1 knapsack per position (2 GKP/5 DEF/5 MID/3 FWD)
merged into one whole-squad budget allocation — genuinely optimal for budget+position-count, not
a heuristic. The max-3-players-per-club rule isn't in that DP's state space (it would blow the
table sizes up for little gain, since violations are rare), so it's fixed up afterward: a repair
pass swaps out over-represented clubs' players for the single best-affordable replacement that
loses the fewest points, then a general local-search pass keeps making any further points-
improving same-position swap until none remain. Verified against a brute-force check on an
adversarial test case (one club deliberately holding the best player at every position) — lands
on the exact true optimum once the local-search pass runs, was off by ~1% without it.

Then picks the highest-scoring valid starting XI by brute-force enumeration over the handful of
legal formations (1 GK, 3–5 DEF, 2–5 MID, 1–3 FWD summing to 10), captain/vice-captain as the top
two scorers in that XI. Picks a squad from scratch within budget — doesn't yet know about an
existing squad, bank, or free transfers (see "ideas not yet built" below).

## Name matching

The weak joint in the whole system. `src/lib/util.js` builds aliases from `web_name`, full name,
surname, and last token of surname, then resolves spoken pundit names against that index.
Unresolved names land in `unmatchedNames` in `opinions.json`.

**After the first real transcript run, read that list.** Add hard-coded overrides for anything
stubborn — pundits use nicknames and shortened forms the index won't guess.

## Conventions

- No dependencies. Keep it that way unless there's a strong reason; `fetch` is global in Node 20+.
- Comments explain *why*, not *what*. Existing ones mark non-obvious decisions (rate-limit pauses,
  caption de-duplication, source-cap reasoning). Match that bar or write nothing.
- The dashboard is one self-contained HTML file with the board JSON inlined. No build step, no
  bundler. Fonts come from Google Fonts; everything else is inline.
- Dashboard design is deliberate: broadcast-data aesthetic, Archivo plus IBM Plex Mono, tabular
  numerals, hairline rules. The 2×2 scatter is the signature element and the thesis of the tool —
  keep it prominent. Don't restyle toward a generic dashboard template.
- `data/raw/` and `data/notebooklm/` are gitignored and regenerable. `data/board.json` and
  `dist/index.html` are committed so the Actions workflow can publish them.

## Automation

`.github/workflows/refresh.yml` runs Thursday, Friday and Saturday mornings, then publishes `dist/`
to GitHub Pages. Needs `ANTHROPIC_API_KEY` as a repo secret. The transcript and opinion steps are
`continue-on-error` so a YouTube hiccup still produces a stats-only board.

Alternative deploy target: the owner already runs `ciaranconnolly.ie` on S3 + CloudFront + Route 53,
so `aws s3 cp dist/index.html s3://…` plus an invalidation is a valid substitute for Pages.

## Ideas not yet built

- Whisper fallback for channels without auto-captions
- Transfer suggestions from an existing squad: `npm run optimise` (below) picks the best possible
  15 from scratch within budget, but doesn't yet know about an existing squad, bank, or free
  transfers, so it can't suggest moves over a horizon the way a real transfer planner would.
  Needs post-deadline picks data (`entry/{id}/event/{gw}/picks/`) to know what's actually owned.
- Squad-rotation data from FBref (starts/subs/unused-subs per player) — the source model's
  appearance-probability calc uses this; `predict.js` approximates it from `history_past`
  minutes/starts instead, since fpl-agent doesn't scrape FBref.
- Mini-league differential view — what rivals own that the owner doesn't
- Price-change prediction from `transfers_in_event` velocity
