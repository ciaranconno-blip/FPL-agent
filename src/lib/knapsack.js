// Exact 0/1 knapsack with a fixed item count: picks precisely `count` items maximising total
// value subject to a budget cap. Standard bottom-up DP, iterated backwards over budget so each
// item is only ever used once.
//
// No LP solver dependency exists in this no-dependencies codebase, but squad selection within
// one position group (fixed count, budget cap, maximise points) is small enough — a few hundred
// candidates, budget in tenths of a million — that exact DP is both correct and fast. The club
// (max 3 per team) constraint that spans across groups isn't captured here; the caller repairs
// that afterward. See src/optimise-squad.js.
export function knapsack(candidates, count, budget) {
  const n = candidates.length;
  const dp = Array.from({ length: count + 1 }, () => new Float64Array(budget + 1).fill(-Infinity));
  dp[0].fill(0);
  // take[i][k][b] = true if item i was added to reach dp[k][b] — kept per item so we can
  // backtrack the exact chosen set for whatever budget the caller ultimately needs.
  const take = Array.from({ length: n }, () =>
    Array.from({ length: count + 1 }, () => new Uint8Array(budget + 1)));

  for (let i = 0; i < n; i++) {
    const cost = candidates[i].cost;
    const value = candidates[i].value;
    const maxK = Math.min(count, i + 1);
    for (let k = maxK; k >= 1; k--) {
      const row = dp[k], prevRow = dp[k - 1];
      for (let b = budget; b >= cost; b--) {
        const prev = prevRow[b - cost];
        if (prev !== -Infinity && prev + value > row[b]) {
          row[b] = prev + value;
          take[i][k][b] = 1;
        }
      }
    }
  }

  // dp[count] can have gaps — a budget b that isn't hit by any exact-count combo, even though
  // spending less than b is possible (e.g. the only two-item combos cost exactly 500, so
  // dp[2][499] is unreachable while dp[2][500] isn't). valueAt smooths that away for querying
  // "best value spending AT MOST b"; sourceAt remembers which real, reconstructable budget each
  // smoothed value actually came from, since reconstruct() needs a budget the raw dp table hit.
  const raw = dp[count];
  const valueAt = new Float64Array(budget + 1).fill(-Infinity);
  const sourceAt = new Int32Array(budget + 1).fill(-1);
  let bestSoFar = -Infinity, bestSource = -1;
  for (let b = 0; b <= budget; b++) {
    if (raw[b] > bestSoFar) { bestSoFar = raw[b]; bestSource = b; }
    valueAt[b] = bestSoFar;
    sourceAt[b] = bestSource;
  }

  return {
    valueAt,
    reconstruct(b) {
      const source = sourceAt[b];
      if (source === -1) return null;
      const chosen = [];
      let k = count, budgetLeft = source;
      for (let i = n - 1; i >= 0 && k > 0; i--) {
        if (take[i][k][budgetLeft]) {
          chosen.push(candidates[i]);
          budgetLeft -= candidates[i].cost;
          k--;
        }
      }
      return chosen;
    }
  };
}

// Combines two independent knapsack value arrays into one covering their joint budget: for each
// total budget b, finds the split (b1, b2) with b1+b2<=b that maximises valueA[b1]+valueB[b2].
// Both inputs are already the smoothed "at most b" arrays `knapsack()` returns, so every b is
// reachable and no further gap-filling is needed here.
export function mergeValueArrays(valueA, valueB) {
  const budget = valueA.length - 1;
  const merged = new Float64Array(budget + 1).fill(-Infinity);
  const splitAt = new Int32Array(budget + 1).fill(-1); // the winning b1 for each output budget b

  for (let b = 0; b <= budget; b++) {
    let best = -Infinity, bestB1 = -1;
    for (let b1 = 0; b1 <= b; b1++) {
      const total = valueA[b1] + valueB[b - b1];
      if (total > best) { best = total; bestB1 = b1; }
    }
    merged[b] = best;
    splitAt[b] = bestB1;
  }
  return { merged, splitAt };
}
