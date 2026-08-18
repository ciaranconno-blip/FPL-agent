import { load, save, log } from './lib/util.js';
import { knapsack, mergeValueArrays } from './lib/knapsack.js';

// A viewer shared a real Excel-Solver-based squad picker alongside the points model in
// predict.js — budget, position-count and formation constraints, captain doubling. Excel's
// Solver add-in runs a branch-and-bound simplex under the hood; this project has no LP solver
// dependency, so squad selection uses exact DP instead (see lib/knapsack.js — genuinely optimal
// for the budget+position-count constraints, not a heuristic), then a repair pass for the
// max-3-per-club rule the DP doesn't capture on its own, then a small enumeration over valid
// formations for the starting XI. Squad picked from scratch within budget, not yet aware of an
// existing squad/free-transfers — see CLAUDE.md's ideas list for the transfer-suggestion version.

const BUDGET_TENTHS = 1000; // £100.0m, in tenths of a million — standard FPL starting budget
const SQUAD_COUNTS = { GKP: 2, DEF: 5, MID: 5, FWD: 3 };
const MAX_PER_CLUB = 3;
const FORMATION_BOUNDS = { DEF: [3, 5], MID: [2, 5], FWD: [1, 3] }; // starting XI, GK always 1

const board = await load('board.json');
if (!board) { console.error('Run `npm run score` first.'); process.exit(1); }

const pool = board.players
  .filter(p => p.status !== 'u' && p.predictedPoints > 0)
  .map(p => ({
    id: p.id, name: p.name, team: p.team, pos: p.position,
    cost: Math.round(p.price * 10), value: p.predictedPoints,
    price: p.price, predictedPoints: p.predictedPoints
  }));

const byPos = Object.fromEntries(Object.keys(SQUAD_COUNTS).map(pos => [pos, pool.filter(p => p.pos === pos)]));
for (const [pos, count] of Object.entries(SQUAD_COUNTS)) {
  if (byPos[pos].length < count) {
    console.error(`Not enough scored ${pos} players (${byPos[pos].length}) to fill ${count} slots. Run npm run score with real data first.`);
    process.exit(1);
  }
}

const tables = Object.fromEntries(Object.entries(SQUAD_COUNTS)
  .map(([pos, count]) => [pos, knapsack(byPos[pos], count, BUDGET_TENTHS)]));

// Chain the four position groups' budget-value curves together, remembering each merge's split
// so the winning per-group budget can be recovered by walking the chain backwards afterward.
const order = ['GKP', 'DEF', 'MID', 'FWD'];
const chain = [tables[order[0]].valueAt];
const splits = [null];
for (let i = 1; i < order.length; i++) {
  const { merged, splitAt } = mergeValueArrays(chain[i - 1], tables[order[i]].valueAt);
  chain.push(merged);
  splits.push(splitAt);
}

let remainingBudget = BUDGET_TENTHS;
const groupBudgets = {};
for (let i = order.length - 1; i >= 1; i--) {
  const b1 = splits[i][remainingBudget];
  groupBudgets[order[i]] = remainingBudget - b1;
  remainingBudget = b1;
}
groupBudgets[order[0]] = remainingBudget;

let squad = order.flatMap(pos => tables[pos].reconstruct(groupBudgets[pos]));
squad = repairClubLimit(squad, byPos);
squad = localSearchImprove(squad, byPos);

const { startingXI, bench, captain, viceCaptain } = pickStartingXI(squad);

const totalCost = squad.reduce((a, p) => a + p.price, 0);
const totalPredictedPoints = squad.reduce((a, p) => a + p.predictedPoints, 0);

const result = {
  builtAt: new Date().toISOString(),
  budget: BUDGET_TENTHS / 10,
  totalCost: Number(totalCost.toFixed(1)),
  bankRemaining: Number((BUDGET_TENTHS / 10 - totalCost).toFixed(1)),
  totalPredictedPoints: Number(totalPredictedPoints.toFixed(2)),
  squad: squad.map(strip),
  startingXI: startingXI.map(strip),
  bench: bench.map(strip),
  captain: strip(captain),
  viceCaptain: strip(viceCaptain)
};

await save('optimal-squad.json', result);
log(`Optimal squad: £${result.totalCost}m spent, £${result.bankRemaining}m bank, ${result.totalPredictedPoints} predicted points`);
log(`  captain: ${captain.name} | vice: ${viceCaptain.name}`);

function strip(p) {
  return { id: p.id, name: p.name, team: p.team, position: p.pos, price: p.price, predictedPoints: p.predictedPoints };
}

// The DP above ignores the real FPL rule that caps a squad at 3 players from any one club.
// Rather than fold that into the DP's state space (budget x position x per-club-count would
// blow the table sizes up for little practical gain — violations are rare since strong squads
// are naturally spread across clubs), fix it up afterward: while a club has more than 3, find
// the single swap (drop one of that club's players, bring in the best affordable same-position
// replacement) that loses the fewest total points — not the "worst value-per-cost" player, which
// can easily be the wrong pick (dropping a club's best player just because they're the most
// expensive is a bad trade even though their points-per-£m ratio looks weakest).
function repairClubLimit(squad, byPos) {
  const squadIds = new Set(squad.map(p => p.id));
  let guard = 0;
  while (guard++ < 50) {
    const clubCounts = {};
    for (const p of squad) clubCounts[p.team] = (clubCounts[p.team] ?? 0) + 1;
    const violatingClub = Object.entries(clubCounts).find(([, n]) => n > MAX_PER_CLUB)?.[0];
    if (!violatingClub) break;

    const spare = spareBudget(squad);
    let bestSwap = null; // { drop, replacement, pointsLost }
    for (const drop of squad.filter(p => p.team === violatingClub)) {
      const budgetFreed = drop.cost + spare;
      const clubCountsAfterDrop = { ...clubCounts, [drop.team]: clubCounts[drop.team] - 1 };
      const replacement = byPos[drop.pos]
        .filter(p => !squadIds.has(p.id) && p.cost <= budgetFreed && (clubCountsAfterDrop[p.team] ?? 0) < MAX_PER_CLUB)
        .sort((a, b) => b.value - a.value)[0];
      if (!replacement) continue;
      const pointsLost = drop.value - replacement.value; // negative means the swap is actually a gain
      if (!bestSwap || pointsLost < bestSwap.pointsLost) bestSwap = { drop, replacement, pointsLost };
    }
    if (!bestSwap) break; // no legal fix available — leave the (rare) violation rather than crash

    squad = squad.filter(p => p.id !== bestSwap.drop.id).concat(bestSwap.replacement);
    squadIds.delete(bestSwap.drop.id); squadIds.add(bestSwap.replacement.id);
  }
  return squad;
}

function spareBudget(squad) {
  return BUDGET_TENTHS - squad.reduce((a, p) => a + p.cost, 0);
}

// The club-limit repair fixes feasibility but doesn't re-optimise, so a locally sub-optimal pick
// can survive it (e.g. spare budget sitting unused when a same-position upgrade was affordable
// all along). One more pass: repeatedly take the single best-improving same-position swap —
// any squad player for any eligible non-squad player that raises total points within budget and
// the club cap — until no improving swap exists. Cheap (a few hundred candidates, a handful of
// iterations) and turns out to matter: it's what actually closes the gap to the true optimum.
function localSearchImprove(squad, byPos) {
  const squadIds = new Set(squad.map(p => p.id));
  let guard = 0;
  while (guard++ < 100) {
    const spare = spareBudget(squad);
    const clubCounts = {};
    for (const p of squad) clubCounts[p.team] = (clubCounts[p.team] ?? 0) + 1;

    let bestSwap = null; // { out, in, gain }
    for (const out of squad) {
      const budgetAvailable = out.cost + spare;
      const clubCountsWithoutOut = { ...clubCounts, [out.team]: clubCounts[out.team] - 1 };
      for (const candidate of byPos[out.pos]) {
        if (squadIds.has(candidate.id) || candidate.cost > budgetAvailable) continue;
        if ((clubCountsWithoutOut[candidate.team] ?? 0) >= MAX_PER_CLUB) continue;
        const gain = candidate.value - out.value;
        if (gain > 1e-9 && (!bestSwap || gain > bestSwap.gain)) bestSwap = { out, in: candidate, gain };
      }
    }
    if (!bestSwap) break;
    squad = squad.filter(p => p.id !== bestSwap.out.id).concat(bestSwap.in);
    squadIds.delete(bestSwap.out.id); squadIds.add(bestSwap.in.id);
  }
  return squad;
}

// Enumerates every valid formation (fixed GK=1, DEF/MID/FWD within FORMATION_BOUNDS summing to
// 10), takes the top-N scorers per position for each, and keeps whichever formation scores
// highest. Small search space (a handful of formations), so brute force is simplest and exact.
function pickStartingXI(squad) {
  const byPos = { GKP: [], DEF: [], MID: [], FWD: [] };
  for (const p of squad) byPos[p.pos].push(p);
  for (const pos of Object.keys(byPos)) byPos[pos].sort((a, b) => b.predictedPoints - a.predictedPoints);

  let best = null;
  const [defMin, defMax] = FORMATION_BOUNDS.DEF;
  const [midMin, midMax] = FORMATION_BOUNDS.MID;
  const [fwdMin, fwdMax] = FORMATION_BOUNDS.FWD;
  for (let def = defMin; def <= defMax; def++) {
    for (let mid = midMin; mid <= midMax; mid++) {
      const fwd = 10 - def - mid;
      if (fwd < fwdMin || fwd > fwdMax) continue;
      const xi = [byPos.GKP[0], ...byPos.DEF.slice(0, def), ...byPos.MID.slice(0, mid), ...byPos.FWD.slice(0, fwd)];
      const total = xi.reduce((a, p) => a + p.predictedPoints, 0);
      if (!best || total > best.total) best = { total, xi, formation: `${def}-${mid}-${fwd}` };
    }
  }

  const startingIds = new Set(best.xi.map(p => p.id));
  const bench = squad.filter(p => !startingIds.has(p.id)).sort((a, b) => b.predictedPoints - a.predictedPoints);
  const sortedXI = [...best.xi].sort((a, b) => b.predictedPoints - a.predictedPoints);
  return { startingXI: best.xi, bench, captain: sortedXI[0], viceCaptain: sortedXI[1] };
}
