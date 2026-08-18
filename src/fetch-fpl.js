import { fplGet, pool, save, load, log } from './lib/util.js';

const config = JSON.parse(await (await import('node:fs/promises')).readFile(
  new URL('../config/sources.json', import.meta.url), 'utf8'));

log('Pulling bootstrap-static and fixtures');
const [bootstrap, fixtures] = await Promise.all([
  fplGet('bootstrap-static/'),
  fplGet('fixtures/')
]);

const events = bootstrap.events;
const current = events.find(e => e.is_current);
const next = events.find(e => e.is_next) || events.find(e => !e.finished);
const deadline = next ? new Date(next.deadline_time) : null;

log(`Current GW: ${current?.id ?? 'none (pre-season)'} | Next GW: ${next?.id} | Deadline: ${deadline?.toISOString() ?? 'unknown'}`);

// Only pull per-player histories for players worth scoring. 700 calls is rude; ~280 is fine.
const shortlist = bootstrap.elements
  .filter(el => el.status !== 'u')
  .filter(el => Number(el.selected_by_percent) >= 0.2 || el.total_points > 0 || Number(el.ep_next) >= 2)
  .sort((a, b) => Number(b.ep_next) - Number(a.ep_next))
  .slice(0, 300);

log(`Fetching element-summary for ${shortlist.length} players`);
const summaries = {};
let done = 0;
await pool(shortlist, 8, async el => {
  const summary = await fplGet(`element-summary/${el.id}/`);
  if (summary) {
    summaries[el.id] = {
      history: summary.history ?? [],
      past: summary.history_past ?? [],
      fixtures: (summary.fixtures ?? []).slice(0, 8)
    };
  }
  if (++done % 50 === 0) log(`  ${done}/${shortlist.length}`);
});

// The manager's own squad. Picks only exist once a gameweek has been entered.
const managerId = config.managerId;
log(`Fetching manager ${managerId}`);
const entry = await fplGet(`entry/${managerId}/`);
const history = await fplGet(`entry/${managerId}/history/`);
let picks = null;
if (current?.id) {
  picks = await fplGet(`entry/${managerId}/event/${current.id}/picks/`);
}
if (!picks && !current) {
  log('  No gameweek entered yet — squad section will be empty until after the GW1 deadline.');
}

await save('raw/bootstrap.json', bootstrap);
await save('raw/fixtures.json', fixtures);
await save('raw/summaries.json', summaries);
await save('raw/manager.json', { entry, history, picks, fetchedAt: new Date().toISOString() });
await save('raw/meta.json', {
  fetchedAt: new Date().toISOString(),
  currentGw: current?.id ?? null,
  nextGw: next?.id ?? null,
  deadline: deadline?.toISOString() ?? null,
  shortlistSize: shortlist.length
});

log('FPL pull complete');
