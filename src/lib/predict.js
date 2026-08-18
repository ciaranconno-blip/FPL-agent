// A from-scratch reimplementation of the fixture-adjusted Poisson points model a viewer shared
// (a real, working FPL prediction spreadsheet — goal/assist points from xG/xA scaled by how
// leaky the opponent's defence is, clean-sheet and 2+-conceded probability from a Poisson on the
// team's own goals-against rate, defensive-contribution probability from a Poisson threshold
// test). Same core math, verified formula-for-formula against the source workbook's CONTROL
// sheet — but built against data this pipeline already pulls (Understat npxG/xA, real team
// results from the vaastav mirror) rather than the FBref-sourced rotation/squad data the
// original model uses, which fpl-agent doesn't fetch. See CLAUDE.md for what's simplified.

// Real 2024/25+ FPL scoring rules, taken directly from the source model's CONTROL sheet.
export const POSITION_POINTS = {
  GKP: { goal: 10, cs: 4, twoPlusGC: -1, dc: 0 },
  DEF: { goal: 6, cs: 4, twoPlusGC: -1, dc: 2 },
  MID: { goal: 5, cs: 1, twoPlusGC: 0, dc: 2 },
  FWD: { goal: 4, cs: 0, twoPlusGC: 0, dc: 2 }
};

const DC_THRESHOLD = { DEF: 9, default: 11 }; // DC points need 10+ for a DEF, 12+ for anyone else
const ASSIST_BOOST = 1.4; // CONTROL!B65 = 0.4, applied as (1 + 0.4)
const HOME_MULT = 1.05;
const AWAY_MULT = 0.95;

function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logFactorialK = 0;
  for (let i = 2; i <= k; i++) logFactorialK += Math.log(i);
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorialK);
}

// P(Poisson(lambda) >= threshold) — the chance a player clears the DC points bar this match.
function poissonSurvival(threshold, lambda) {
  let cdf = 0;
  for (let k = 0; k < threshold; k++) cdf += poissonPmf(k, lambda);
  return Math.max(0, 1 - cdf);
}

/**
 * Predicts one player's points for one specific fixture.
 * @param {object} player - { pos, xG90, xA90, dc90, bonusPer90, startProb, appearanceProb }
 * @param {object} fixture - { isHome, opponentGoalsAgainstPer90, opponentGoalsForPer90, ownTeamGoalsAgainstPer90 }
 * @param {object} leagueAvg - { goalsAgainstPer90, goalsForPer90 }
 */
export function predictFixturePoints(player, fixture, leagueAvg) {
  const pos = POSITION_POINTS[player.pos];
  if (!pos) return 0;

  // A leaky opponent defence (more goals-against than average) inflates goal/assist chances;
  // a leaky own defence, scaled by how sharp the opponent's attack is, deflates clean-sheet odds.
  const oppDefenceFactor = leagueAvg.goalsAgainstPer90 > 0
    ? fixture.opponentGoalsAgainstPer90 / leagueAvg.goalsAgainstPer90 : 1;
  const oppAttackFactor = leagueAvg.goalsForPer90 > 0
    ? fixture.opponentGoalsForPer90 / leagueAvg.goalsForPer90 : 1;

  const goalPoints = player.xG90 * oppDefenceFactor * pos.goal;
  const assistPoints = player.xA90 * oppDefenceFactor * 3 * ASSIST_BOOST;

  const xgc90 = fixture.ownTeamGoalsAgainstPer90 * oppAttackFactor;
  const csProb = Math.exp(-xgc90);
  const csPoints = csProb * pos.cs;
  // P(concede 2+) = 1 - P(0) - P(1), the two Poisson terms a clean sheet and a single-goal game cover.
  const twoPlusGCProb = Math.max(0, 1 - csProb * (1 + xgc90));
  const twoPlusGCPoints = twoPlusGCProb * pos.twoPlusGC;

  const threshold = DC_THRESHOLD[player.pos] ?? DC_THRESHOLD.default;
  const dcProb = poissonSurvival(threshold, player.dc90);
  const dcPoints = dcProb * pos.dc;

  const startProb = Math.min(0.99, player.startProb);
  const appearanceProb = Math.min(0.99, Math.max(player.appearanceProb, startProb));
  // The appearance point doesn't scale with the rest — you get it just for being involved,
  // full minutes or not — everything else only pays off at the rate you're expected to start.
  const appearancePoints = appearanceProb * 1 + startProb * 1;
  const perMatchPoints = (goalPoints + assistPoints + csPoints + twoPlusGCPoints + dcPoints + player.bonusPer90) * startProb;

  return (appearancePoints + perMatchPoints) * (fixture.isHome ? HOME_MULT : AWAY_MULT);
}
