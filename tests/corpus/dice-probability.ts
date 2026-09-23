// @category: simulation
// Dice probabilities: the exact distribution of the sum of N dice by convolution, a seeded Monte
// Carlo estimate compared against it, and a few classic questions (at least one six, craps).

function exactSums(dice: number, sides: number): Map<number, number> {
  let dist = new Map<number, number>([[0, 1]]);
  for (let d = 0; d < dice; d++) {
    const next = new Map<number, number>();
    for (const [sum, p] of dist) {
      for (let face = 1; face <= sides; face++) {
        next.set(sum + face, (next.get(sum + face) ?? 0) + p / sides);
      }
    }
    dist = next;
  }
  return dist;
}

let seed = 123456789;
function rand(): number {
  // Park-Miller minimal standard generator
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

function roll(sides: number): number {
  return 1 + Math.floor(rand() * sides);
}

function simulateSums(dice: number, sides: number, trials: number): Map<number, number> {
  const counts = new Map<number, number>();
  for (let t = 0; t < trials; t++) {
    let s = 0;
    for (let d = 0; d < dice; d++) s += roll(sides);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  for (const [k, v] of counts) counts.set(k, v / trials);
  return counts;
}

function crapsWinRate(games: number): number {
  let wins = 0;
  for (let g = 0; g < games; g++) {
    const first = roll(6) + roll(6);
    if (first === 7 || first === 11) {
      wins++;
      continue;
    }
    if (first === 2 || first === 3 || first === 12) continue;
    for (;;) {
      const r = roll(6) + roll(6);
      if (r === first) {
        wins++;
        break;
      }
      if (r === 7) break;
    }
  }
  return wins / games;
}

const exact = exactSums(2, 6);
const sim = simulateSums(2, 6, 20000);
console.log("sum  exact   simulated  bar");
for (let s = 2; s <= 12; s++) {
  const e = exact.get(s) ?? 0;
  const m = sim.get(s) ?? 0;
  console.log(
    `${String(s).padStart(3)}  ${e.toFixed(4)}  ${m.toFixed(4)}     ${"*".repeat(Math.round(m * 100))}`,
  );
}
const three = exactSums(3, 6);
const best = [...three.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!;
console.log(`3d6 most likely sum: ${best[0]} (${(best[1] * 100).toFixed(2)}%)`);
console.log(`P(at least one six in 4 rolls) = ${(1 - (5 / 6) ** 4).toFixed(4)}`);
console.log(`P(double six in 24 rolls of two dice) = ${(1 - (35 / 36) ** 24).toFixed(4)}`);
console.log(`craps win rate (simulated): ${crapsWinRate(20000).toFixed(4)} vs exact 0.4929`);
