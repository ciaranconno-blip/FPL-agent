import fs from 'node:fs/promises';
import { load, save, log, zScores } from './lib/util.js';

const config = JSON.parse(await fs.readFile(new URL('../config/sources.json', import.meta.url), 'utf8'));
const { fixtureHorizon, weights, differentialOwnershipCeiling, templateOwnershipFloor } = config.scoring;

const bootstrap = await load('raw/bootstrap.json');
const summaries = await load('raw/summaries.json', {});
const manager = await load('raw/manager.json', {});
const meta = await load('raw/meta.json', {});
const opinionFile = await load('raw/opinions.json', { opinions: [] });
if (!bootstrap) { console.error('Run `npm run fpl` first.'); process.exit(1); }

const teamById = Object.fromEntries(bootstrap.teams.map(t => [t.id, t]));
const typeById = Object.fromEntries(bootstrap.element_types.map(t => [t.id, t]));

// Group expert opinion by player. Recency and channel weight both count.
const STANCE = { buy: 1, watch: 0.35, hold: 0.15, sell: -0.8, avoid: -1 };
const byPlayer = new Map();
for (const op of opinionFile.opinions) {
  if (!byPlayer.has(op.elementId)) byPlayer.set(op.elementId, []);
  byPlayer.get(op.elementId).push(op);
}

const ids = Object.keys(summaries).map(Number);
const players = ids.map(id => {
  const el = bootstrap.elements.find(e => e.id === id);
  const summary = summaries[id];
  const team = teamById[el.team];

  const upcoming = summary.fixtures.slice(0, fixtureHorizon);
  const fixtureEase = upcoming.length
    ? upcoming.reduce((a, f) => a + (5 - f.difficulty), 0) / upcoming.length
    : 2;
  const blanks = fixtureHorizon - upcoming.length;

  // Pre-season has no current-season history, so lean on ep_next and last season.
  const lastSeason = summary.past.at(-1);
  const priorPpg = lastSeason && lastSeason.minutes > 900
    ? lastSeason.total_points / Math.max(1, lastSeason.minutes / 90)
    : 0;

  const minutesRisk = el.status === 'a'
    ? (el.chance_of_playing_next_round ?? 100) / 100
    : el.status === 'd' ? 0.5 : 0;

  const threat = (Number(el.ict_index) || 0) + priorPpg * 4;
  const value = Number(el.ep_next) / (el.now_cost / 10);

  const opinions = byPlayer.get(id) ?? [];
  const expertRaw = opinions.reduce(
    (a, o) => a + (STANCE[o.stance] ?? 0) * o.confidence * o.channelWeight, 0);
  const captainCalls = opinions.filter(o => o.captain).length;
  const channelsCovering = new Set(opinions.map(o => o.channel)).size;

  return {
    id,
    name: el.web_name,
    fullName: `${el.first_name} ${el.second_name}`,
    team: team.short_name,
    teamName: team.name,
    position: typeById[el.element_type].singular_name_short,
    price: el.now_cost / 10,
    ownership: Number(el.selected_by_percent),
    epNext: Number(el.ep_next),
    form: Number(el.form),
    totalPoints: el.total_points,
    status: el.status,
    news: el.news || null,
    transfersInEvent: el.transfers_in_event,
    transfersOutEvent: el.transfers_out_event,
    fixtures: upcoming.map(f => ({
      gw: f.event,
      opponent: teamById[f.is_home ? f.team_a : f.team_h]?.short_name ?? '?',
      home: f.is_home,
      difficulty: f.difficulty
    })),
    blanks,
    _raw: { fixtureEase, threat, value, minutesRisk, expertRaw },
    captainCalls,
    channelsCovering,
    opinions: opinions.map(o => ({
      channel: o.channel, stance: o.stance, confidence: o.confidence,
      reason: o.reason, risk: o.risk, url: o.url
    }))
  };
});

// Normalise every component across the shortlist, then blend.
const zEp = zScores(players.map(p => p.epNext));
const zFix = zScores(players.map(p => p._raw.fixtureEase));
const zThreat = zScores(players.map(p => p._raw.threat));
const zValue = zScores(players.map(p => p._raw.value));
const zExpert = zScores(players.map(p => p._raw.expertRaw));

players.forEach((p, i) => {
  p.dataScore = Number((
    weights.expectedPoints * zEp[i] +
    weights.fixtures * zFix[i] +
    weights.threat * zThreat[i] +
    weights.value * zValue[i] +
    weights.minutes * (p._raw.minutesRisk * 2 - 1)
  ).toFixed(3));
  p.expertScore = Number(zExpert[i].toFixed(3));
  delete p._raw;
});

const dataHigh = percentile(players.map(p => p.dataScore), 0.65);
const expertHigh = percentile(players.map(p => p.expertScore), 0.70);

for (const p of players) {
  const strongData = p.dataScore >= dataHigh;
  const loudExperts = p.expertScore >= expertHigh && p.channelsCovering >= 2;

  if (strongData && loudExperts) p.quadrant = 'template';
  else if (strongData && !loudExperts) p.quadrant = 'differential';
  else if (!strongData && loudExperts) p.quadrant = 'hype-trap';
  else p.quadrant = 'ignore';

  // The buzz that hasn't reached ownership yet — this is where price rises start.
  p.aheadOfCurve = loudExperts && p.ownership < differentialOwnershipCeiling;
  p.isTemplate = p.ownership >= templateOwnershipFloor;
  p.flagged = p.status !== 'a' || (p.news && p.news.length > 0);
}

// The manager's own squad, if a gameweek has been entered.
const squadIds = new Set((manager?.picks?.picks ?? []).map(p => p.element));
for (const p of players) p.owned = squadIds.has(p.id);

const ranked = [...players].sort((a, b) => b.dataScore - a.dataScore);
const board = {
  builtAt: new Date().toISOString(),
  meta,
  managerName: manager?.entry ? `${manager.entry.player_first_name} ${manager.entry.player_last_name}` : null,
  teamName: manager?.entry?.name ?? null,
  overallRank: manager?.entry?.summary_overall_rank ?? null,
  bank: manager?.entry?.last_deadline_bank != null ? manager.entry.last_deadline_bank / 10 : null,
  videosProcessed: opinionFile.videosProcessed ?? 0,
  hasExpertData: (opinionFile.opinions ?? []).length > 0,
  players: ranked,
  lists: {
    differentials: ranked.filter(p => p.quadrant === 'differential' && p.ownership < differentialOwnershipCeiling && !p.flagged).slice(0, 12),
    template: ranked.filter(p => p.quadrant === 'template').slice(0, 12),
    hypeTraps: ranked.filter(p => p.quadrant === 'hype-trap').slice(0, 8),
    aheadOfCurve: ranked.filter(p => p.aheadOfCurve && !p.flagged).slice(0, 10),
    captaincy: [...players].sort((a, b) =>
      (b.captainCalls - a.captainCalls) || (b.epNext - a.epNext)).slice(0, 6),
    squadRisks: ranked.filter(p => p.owned && (p.flagged || p.dataScore < 0))
  }
};

await save('board.json', board);
log(`Scored ${players.length} players`);
log(`  differentials: ${board.lists.differentials.length} | template: ${board.lists.template.length} | hype traps: ${board.lists.hypeTraps.length}`);
if (!board.hasExpertData) log('  No expert data yet — quadrants are stats-only until transcripts are processed.');

function percentile(arr, p) {
  const sorted = [...arr].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.floor(sorted.length * p)];
}
