import { save, log } from './lib/util.js';

// vaastav/Fantasy-Premier-League already does the hard part: it scrapes understat.com's
// hex-escaped JSON (the format CLAUDE.md warned about) and republishes it as plain CSV.
// Pulling that instead of scraping understat.com ourselves is the whole point of this file.
const SEASON = '2024-25'; // most recent season the mirror has a populated understat/ folder for
const BASE = `https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/${SEASON}`;

log(`Pulling Understat xG data (${SEASON} season, via vaastav/Fantasy-Premier-League)`);
const playerRes = await fetch(`${BASE}/understat/understat_player.csv`);
if (!playerRes.ok) throw new Error(`Understat pull failed: ${playerRes.status} ${playerRes.statusText}`);
const players = parseCsv(await playerRes.text());

// Team-level clean-sheet modelling needs each team's actual defensive/attacking output.
// The mirror doesn't publish a team-level Understat file, but its fixtures.csv has the real
// final scores for the whole season, which is the same thing without an xG layer on top.
log(`Pulling team results (${SEASON} season) for clean-sheet modelling`);
const [fixturesRes, teamsRes] = await Promise.all([fetch(`${BASE}/fixtures.csv`), fetch(`${BASE}/teams.csv`)]);
if (!fixturesRes.ok) throw new Error(`Fixtures pull failed: ${fixturesRes.status} ${fixturesRes.statusText}`);
if (!teamsRes.ok) throw new Error(`Teams pull failed: ${teamsRes.status} ${teamsRes.statusText}`);
const fixtureRows = parseCsv(await fixturesRes.text());
const teamRows = parseCsv(await teamsRes.text());
const teams = buildTeamForm(fixtureRows, teamRows);

await save('raw/understat.json', {
  season: SEASON,
  fetchedAt: new Date().toISOString(),
  players,
  teams
});
log(`Pulled Understat data for ${players.length} players, results for ${Object.keys(teams).length} teams`);

// Goals for/against per 90 (= per match, since a match is 90 minutes), keyed by short_name so
// score.js can join it the same way it joins everything else on the FPL team code.
function buildTeamForm(fixtureRows, teamRows) {
  const nameById = Object.fromEntries(teamRows.map(t => [t.id, t.short_name]));
  const stats = Object.fromEntries(teamRows.map(t => [t.short_name, { played: 0, goalsFor: 0, goalsAgainst: 0 }]));
  for (const f of fixtureRows) {
    if (f.finished !== 'True') continue;
    const home = nameById[f.team_h], away = nameById[f.team_a];
    const hs = Number(f.team_h_score), as_ = Number(f.team_a_score);
    if (!home || !away || !Number.isFinite(hs) || !Number.isFinite(as_)) continue;
    stats[home].played++; stats[home].goalsFor += hs; stats[home].goalsAgainst += as_;
    stats[away].played++; stats[away].goalsFor += as_; stats[away].goalsAgainst += hs;
  }
  return Object.fromEntries(Object.entries(stats)
    .filter(([, s]) => s.played > 0)
    .map(([team, s]) => [team, {
      played: s.played,
      goalsForPer90: s.goalsFor / s.played,
      goalsAgainstPer90: s.goalsAgainst / s.played
    }]));
}

// Minimal parser — good enough for this one file, not a general CSV reader. Player names
// arrive unquoted in this export, but the fallback still handles a quoted comma safely.
function parseCsv(text) {
  const lines = text.trim().split('\n');
  const headers = splitLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = splitLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
  });
}

function splitLine(line) {
  const cells = [];
  let cur = '', inQuotes = false;
  for (const c of line) {
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === ',' && !inQuotes) { cells.push(cur); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur);
  return cells;
}
