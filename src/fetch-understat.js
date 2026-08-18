import { save, log } from './lib/util.js';

// vaastav/Fantasy-Premier-League already does the hard part: it scrapes understat.com's
// hex-escaped JSON (the format CLAUDE.md warned about) and republishes it as plain CSV.
// Pulling that instead of scraping understat.com ourselves is the whole point of this file.
const SEASON = '2024-25'; // most recent season the mirror has a populated understat/ folder for
const URL = `https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/${SEASON}/understat/understat_player.csv`;

log(`Pulling Understat xG data (${SEASON} season, via vaastav/Fantasy-Premier-League)`);
const res = await fetch(URL);
if (!res.ok) throw new Error(`Understat pull failed: ${res.status} ${res.statusText}`);
const rows = parseCsv(await res.text());

await save('raw/understat.json', { season: SEASON, fetchedAt: new Date().toISOString(), players: rows });
log(`Pulled Understat data for ${rows.length} players`);

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
