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

- `expectedPoints` — FPL's own `ep_next`
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
- Transfer optimiser: given the squad, bank and free transfers, suggest moves over a 5-GW horizon
- Mini-league differential view — what rivals own that the owner doesn't
- Price-change prediction from `transfers_in_event` velocity
