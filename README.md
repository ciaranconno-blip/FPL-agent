# fpl-agent

Blends the official FPL API with what the FPL YouTube community is actually saying, and puts
both on one board so you can see where they disagree. Disagreement is the point: the quadrant
with strong numbers and quiet coverage is where rank gets won.

Manager ID: `5725107`

## Setup

```bash
npm install          # no dependencies yet, but keeps npm happy
brew install yt-dlp  # or: pipx install yt-dlp
export ANTHROPIC_API_KEY=sk-ant-...
```

## Running it

```bash
npm run quick   # FPL data + scoring + dashboard (~30s, no API cost)
npm run all     # the above plus transcripts and expert extraction (~4 min)
```

Then open `dist/index.html`.

Individual steps:

| Command | What it does | Writes |
|---|---|---|
| `npm run fpl` | Pulls bootstrap, fixtures, ~300 player histories, your squad | `data/raw/` |
| `npm run understat` | Pulls real xG/xA from the `vaastav/Fantasy-Premier-League` GitHub mirror | `data/raw/understat.json` |
| `npm run transcripts` | Pulls subtitles from the 11 channels in `config/sources.json` | `data/raw/transcripts.json`, `data/notebooklm/` |
| `npm run opinions` | Claude turns transcripts into structured per-player stances | `data/raw/opinions.json` |
| `npm run score` | Merges both into scores, quadrants, recommendation lists | `data/board.json` |
| `npm run dashboard` | Renders the self-contained HTML | `dist/index.html` |
| `npm run optimise` | Picks the best 15-man squad within budget from `board.json` | `data/optimal-squad.json` |

Every step reads from disk, so you can re-run scoring without re-fetching anything.

## The four quadrants

|  | Experts loud | Experts quiet |
|---|---|---|
| **Numbers strong** | Template — own it, no edge in it | **Differential — the reason this exists** |
| **Numbers weak** | Hype trap — usually last season's name | Ignore |

The board also flags **ahead of the crowd**: players the pundits have started pushing but whose
ownership hasn't caught up yet. That gap is where price rises come from, so it's the most
time-sensitive list on the page.

## NotebookLM / Gemini Notebook

`npm run transcripts` also writes clean markdown to `data/notebooklm/`, so the pundit content is
one drag away from a notebook. You get:

- **One file per channel** — `2026-08-18_FPLFocal.md` and so on. Eleven sources rather than
  forty-four keeps you under the free-tier source cap, and NotebookLM's citations then read
  "FPLFocal" instead of a video ID, so you can tell who said what.
- **One combined file** — `2026-08-18_ALL-CHANNELS.md`, if you'd rather add a single source.

Each video keeps its title, publish date and link as a header, and the caption run is broken into
readable blocks so NotebookLM chunks it sensibly instead of treating a whole video as one passage.
The directory is wiped and rewritten on every run, so it always holds the current week only.

Going the other way: NotebookLM can export notes and artifacts to Google Docs. Anything you save
there is readable through the Google Drive connector in a normal Claude conversation, so you can
chat to your sources in NotebookLM and bring conclusions back without copy-paste.

There's no NotebookLM connector and no public consumer API, so this handoff is deliberately a file
drop rather than an integration. It won't break when Google changes the UI.

## Tuning

`config/sources.json` holds everything you'll want to change:

- `channels[].weight` — bump the pundits you actually rate. Currently Hub, Let's Talk and Focal
  are at 1.2, everyone else at 1.0.
- `scoring.weights` — the five components of the data score. They should sum to 1.
- `scoring.fixtureHorizon` — how many gameweeks ahead the fixture component looks.
- `transcripts.videosPerChannel` / `maxAgeDays` — bigger numbers cost more API spend.

## Automation

`.github/workflows/refresh.yml` runs Thursday, Friday and Saturday morning, commits the refreshed
board, and publishes `dist/` to GitHub Pages. Add `ANTHROPIC_API_KEY` under
Settings → Secrets and variables → Actions, then enable Pages with "GitHub Actions" as the source.

To put it on your own domain instead, point the workflow's final step at S3 and invalidate
CloudFront — the output is one static file, so `aws s3 cp dist/index.html s3://…` is the whole job.

## Known gaps

- **Understat is one season behind.** `vaastav/Fantasy-Premier-League`'s `understat/` folder for
  the current season only fills in once matches have been played, so `fetch-understat.js` points at
  last season's data by default — real underlying output, just not this season's yet. Bump `SEASON`
  in that file once the mirror publishes a folder for the current one.
- **Name matching.** `src/lib/util.js` builds aliases from web names and surnames. Anything it
  can't resolve lands in `unmatchedNames` in `opinions.json` — check it after the first real run
  and add hard-coded overrides for the stubborn ones.
- **Pre-season scoring is soft.** With no gameweeks played, the data score leans on `ep_next` and
  last season. It gets meaningfully sharper from GW3.
- **Rate limits.** The FPL API is unauthenticated and ungenerous about hammering. The player
  fetch runs 8 at a time with a pause; don't raise it.
