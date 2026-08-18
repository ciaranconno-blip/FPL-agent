import fs from 'node:fs/promises';
import { load, save, log, zScores, buildNameIndex, resolvePlayer } from './lib/util.js';
import { predictFixturePoints } from './lib/predict.js';

const config = JSON.parse(await fs.readFile(new URL('../config/sources.json', import.meta.url), 'utf8'));
const { fixtureHorizon, weights, differentialOwnershipCeiling, templateOwnershipFloor } = config.scoring;

const bootstrap = await load('raw/bootstrap.json');
const fixtureList = await load('raw/fixtures.json', []);
const summaries = await load('raw/summaries.json', {});
const manager = await load('raw/manager.json', {});
const meta = await load('raw/meta.json', {});
const opinionFile = await load('raw/opinions.json', { opinions: [] });
const understatFile = await load('raw/understat.json', { season: null, players: [] });
if (!bootstrap) { console.error('Run `npm run fpl` first.'); process.exit(1); }

const teamById = Object.fromEntries(bootstrap.teams.map(t => [t.id, t]));
const typeById = Object.fromEntries(bootstrap.element_types.map(t => [t.id, t]));

// Understat rows come with a club name, not an FPL id, so resolve them through the same
// name index the pundit-opinion matcher uses. Matches by name go stale as players change
// clubs mid-transfer-window, but the underlying output (xG/xA) is a player trait, not a
// club one, so a stale team_title on the match doesn't make the number wrong.
const elementsForMatching = bootstrap.elements.map(el =>
  ({ ...el, team_name: teamById[el.team]?.name }));
const understatNameIndex = buildNameIndex(elementsForMatching, bootstrap.teams);
const understatByPlayer = new Map();
for (const row of understatFile.players) {
  const id = resolvePlayer(understatNameIndex, elementsForMatching, row.player_name, row.team_title);
  if (id) understatByPlayer.set(id, row);
}

// League-average goal rates, used to turn a fixture's opponent into a strength multiplier
// (leakier-than-average defence inflates goal/assist chances, sharper-than-average attack
// deflates clean-sheet odds). Real team data from the vaastav mirror's last-season results.
const teamForm = understatFile.teams ?? {};
const leagueAvg = {
  goalsForPer90: average(Object.values(teamForm).map(t => t.goalsForPer90)),
  goalsAgainstPer90: average(Object.values(teamForm).map(t => t.goalsAgainstPer90))
};
function average(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

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

  // Real underlying output (npxG+xA per 90) beats the points-based proxy whenever Understat
  // has enough of a sample — points are noisy with penalties/deflections, xG isn't. Below
  // half a season of minutes the sample's too thin to trust, so fall back to priorPpg.
  const understatMatch = understatByPlayer.get(id);
  const understatMinutes = Number(understatMatch?.time) || 0;
  const xgi90 = understatMinutes >= 450
    ? ((Number(understatMatch.npxG) || 0) + (Number(understatMatch.xA) || 0)) / (understatMinutes / 90)
    : null;

  const threat = (Number(el.ict_index) || 0) + (xgi90 ?? priorPpg) * 4;
  const value = Number(el.ep_next) / (el.now_cost / 10);

  // Real fixture-adjusted prediction for the next match, from the same underlying data as
  // `threat` (Understat npxG/xA) plus real opponent form — see src/lib/predict.js. Falls back
  // to FPL's own ep_next when there isn't enough data to trust the model (young players, no
  // fixture, an unmatched team) rather than asserting a confident number from nothing.
  const posKey = typeById[el.element_type].singular_name_short;
  const nextFixture = upcoming[0];
  const ownForm = teamForm[team.short_name];
  let predictedPoints = 0;
  if (nextFixture && ownForm && understatMinutes >= 450) {
    const opponentForm = teamForm[teamById[nextFixture.is_home ? nextFixture.team_a : nextFixture.team_h]?.short_name];
    if (opponentForm) {
      const dc90 = Number(el.defensive_contribution_per_90) || 0;
      const bonusPer90 = lastSeason && lastSeason.minutes > 900
        ? (Number(lastSeason.bonus) || 0) / (lastSeason.minutes / 90) : 0;
      const priorStarts = Number(lastSeason?.starts) || (lastSeason?.minutes > 0 ? lastSeason.minutes / 90 : 0);
      const startRate = Math.min(1, priorStarts / 38);
      const startProb = Math.min(0.99, minutesRisk * startRate);
      const appearanceProb = Math.min(0.99, minutesRisk * Math.min(1, startRate + 0.2));
      predictedPoints = predictFixturePoints(
        { pos: posKey, xG90: xgi90 != null ? Number(understatMatch.npxG) / (understatMinutes / 90) : 0,
          xA90: xgi90 != null ? Number(understatMatch.xA) / (understatMinutes / 90) : 0,
          dc90, bonusPer90, startProb, appearanceProb },
        { isHome: nextFixture.is_home, opponentGoalsAgainstPer90: opponentForm.goalsAgainstPer90,
          opponentGoalsForPer90: opponentForm.goalsForPer90, ownTeamGoalsAgainstPer90: ownForm.goalsAgainstPer90 },
        leagueAvg
      );
    }
  }
  const expectedPointsValue = predictedPoints > 0 ? predictedPoints : Number(el.ep_next);

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
    predictedPoints: Number(expectedPointsValue.toFixed(2)),
    pointsSource: predictedPoints > 0 ? 'model' : 'ep_next',
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
    underlyingSource: xgi90 != null ? 'understat' : 'points-proxy',
    _raw: { fixtureEase, threat, value, minutesRisk, expertRaw, expectedPointsValue },
    captainCalls,
    channelsCovering,
    opinions: opinions.map(o => ({
      channel: o.channel, stance: o.stance, confidence: o.confidence,
      reason: o.reason, risk: o.risk, url: o.url
    }))
  };
});

// Normalise every component across the shortlist, then blend.
const zEp = zScores(players.map(p => p._raw.expectedPointsValue));
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

// Double/blank gameweeks only exist once postponements and cup replays reshuffle the
// calendar, so this is mostly empty pre-season and sharpens from roughly GW25 onward.
const chipWindows = scanChipWindows(fixtureList, bootstrap.teams, bootstrap.events, meta.nextGw ?? meta.currentGw);

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
  understatSeason: understatFile.season,
  chipWindows,
  players: ranked,
  lists: {
    differentials: ranked.filter(p => p.quadrant === 'differential' && p.ownership < differentialOwnershipCeiling && !p.flagged).slice(0, 12),
    template: ranked.filter(p => p.quadrant === 'template').slice(0, 12),
    hypeTraps: ranked.filter(p => p.quadrant === 'hype-trap').slice(0, 8),
    aheadOfCurve: ranked.filter(p => p.aheadOfCurve && !p.flagged).slice(0, 10),
    captaincy: [...players].sort((a, b) =>
      (b.captainCalls - a.captainCalls) || (b.predictedPoints - a.predictedPoints)).slice(0, 6),
    squadRisks: ranked.filter(p => p.owned && (p.flagged || p.dataScore < 0))
  }
};

await save('board.json', board);
log(`Scored ${players.length} players`);
log(`  differentials: ${board.lists.differentials.length} | template: ${board.lists.template.length} | hype traps: ${board.lists.hypeTraps.length}`);
if (!board.hasExpertData) log('  No expert data yet — quadrants are stats-only until transcripts are processed.');
log(understatByPlayer.size
  ? `  understat: matched ${understatByPlayer.size}/${understatFile.players.length} players (${understatFile.season} season)`
  : '  understat: no data — run `npm run understat` first');
log(`  predicted points: ${players.filter(p => p.pointsSource === 'model').length}/${players.length} players from the fixture-adjusted model, rest from FPL's ep_next`);
log(chipWindows.length
  ? `  chip windows: ${chipWindows.map(w => `GW${w.gw} (${w.doubles.length ? w.doubles.length + ' double' : ''}${w.doubles.length && w.blanks.length ? ', ' : ''}${w.blanks.length ? w.blanks.length + ' blank' : ''})`).join(', ')}`
  : '  chip windows: none scheduled yet');

function percentile(arr, p) {
  const sorted = [...arr].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.floor(sorted.length * p)];
}

// Scans the full-season fixture list for gameweeks where a team plays twice (double,
// worth stacking with Bench Boost/Triple Captain) or not at all (blank, the reason to
// hold a Free Hit). Postponed fixtures carry event:null until the FA rearranges them,
// so this fills in only as the calendar actually becomes uneven.
function scanChipWindows(fixtures, teams, events, fromGw) {
  const teamById = Object.fromEntries(teams.map(t => [t.id, t.short_name]));
  const eventsWithFixtures = new Set();
  const countByEventTeam = new Map();
  for (const f of fixtures) {
    if (!f.event) continue;
    eventsWithFixtures.add(f.event);
    for (const teamId of [f.team_h, f.team_a]) {
      const key = `${f.event}:${teamId}`;
      countByEventTeam.set(key, (countByEventTeam.get(key) ?? 0) + 1);
    }
  }

  const windows = [];
  for (const gw of eventsWithFixtures) {
    if (fromGw && gw < fromGw) continue;
    const doubles = [];
    const blanks = [];
    for (const team of teams) {
      const count = countByEventTeam.get(`${gw}:${team.id}`) ?? 0;
      if (count >= 2) doubles.push(teamById[team.id]);
      else if (count === 0) blanks.push(teamById[team.id]);
    }
    if (doubles.length || blanks.length) {
      const ev = events.find(e => e.id === gw);
      windows.push({ gw, deadline: ev?.deadline_time ?? null, doubles, blanks });
    }
  }
  return windows.sort((a, b) => a.gw - b.gw);
}
