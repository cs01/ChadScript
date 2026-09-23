// @category: algorithms
// Dynamic programming classics: longest common subsequence, edit distance with alignment,
// 0/1 knapsack with item recovery, coin change, and longest increasing subsequence.

function lcs(a: string, b: string): string {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  let i = a.length;
  let j = b.length;
  const out: string[] = [];
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push(a[i - 1]!);
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }
  return out.reverse().join("");
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur.push(Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

interface Item {
  name: string;
  weight: number;
  value: number;
}

function knapsack(items: Item[], capacity: number): { value: number; chosen: string[] } {
  const n = items.length;
  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) dp.push(new Array<number>(capacity + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    const { weight, value } = items[i - 1]!;
    for (let w = 0; w <= capacity; w++) {
      dp[i]![w] = dp[i - 1]![w]!;
      if (weight <= w) dp[i]![w] = Math.max(dp[i]![w]!, dp[i - 1]![w - weight]! + value);
    }
  }
  const chosen: string[] = [];
  let w = capacity;
  for (let i = n; i > 0; i--) {
    if (dp[i]![w] !== dp[i - 1]![w]) {
      chosen.push(items[i - 1]!.name);
      w -= items[i - 1]!.weight;
    }
  }
  return { value: dp[n]![capacity]!, chosen: chosen.reverse() };
}

function coinChange(coins: number[], amount: number): number {
  const best = new Array<number>(amount + 1).fill(Infinity);
  best[0] = 0;
  for (let a = 1; a <= amount; a++) {
    for (const c of coins) {
      if (c <= a && best[a - c]! + 1 < best[a]!) best[a] = best[a - c]! + 1;
    }
  }
  return best[amount] === Infinity ? -1 : best[amount]!;
}

function lis(nums: number[]): number[] {
  const len = nums.map(() => 1);
  const from = nums.map(() => -1);
  for (let i = 0; i < nums.length; i++) {
    for (let j = 0; j < i; j++) {
      if (nums[j]! < nums[i]! && len[j]! + 1 > len[i]!) {
        len[i] = len[j]! + 1;
        from[i] = j;
      }
    }
  }
  let end = len.indexOf(Math.max(...len));
  const out: number[] = [];
  while (end !== -1) {
    out.unshift(nums[end]!);
    end = from[end]!;
  }
  return out;
}

const pairs: [string, string][] = [
  ["kitten", "sitting"],
  ["intention", "execution"],
  ["ABCBDAB", "BDCABA"],
  ["", "abc"],
];
for (const [a, b] of pairs) {
  console.log(
    `${JSON.stringify(a)} vs ${JSON.stringify(b)}: lcs=${JSON.stringify(lcs(a, b))} edit=${editDistance(a, b)}`,
  );
}

const items: Item[] = [
  { name: "tent", weight: 5, value: 60 },
  { name: "stove", weight: 3, value: 50 },
  { name: "rope", weight: 4, value: 70 },
  { name: "lamp", weight: 2, value: 30 },
];
console.log("knapsack(8):", knapsack(items, 8));
console.log(
  "coins:",
  [11, 3, 0, 7].map((amt) => coinChange([1, 2, 5], amt)),
  coinChange([2], 3),
);
console.log("lis:", lis([10, 9, 2, 5, 3, 7, 101, 18, 4, 19]));
