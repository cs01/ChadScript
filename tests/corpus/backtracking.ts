// @category: algorithms
// Backtracking: N-Queens (count and first board), a Sudoku solver, permutations and subset sum.

function nQueens(n: number): { count: number; first: number[] | null } {
  const cols = new Set<number>();
  const diag1 = new Set<number>();
  const diag2 = new Set<number>();
  const placement: number[] = [];
  let count = 0;
  let first: number[] | null = null;
  function place(row: number): void {
    if (row === n) {
      count++;
      if (first === null) first = [...placement];
      return;
    }
    for (let c = 0; c < n; c++) {
      if (cols.has(c) || diag1.has(row - c) || diag2.has(row + c)) continue;
      cols.add(c);
      diag1.add(row - c);
      diag2.add(row + c);
      placement.push(c);
      place(row + 1);
      placement.pop();
      cols.delete(c);
      diag1.delete(row - c);
      diag2.delete(row + c);
    }
  }
  place(0);
  return { count, first };
}

type Grid = number[][];

function solveSudoku(grid: Grid): boolean {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (grid[r]![c] !== 0) continue;
      for (let v = 1; v <= 9; v++) {
        if (canPlace(grid, r, c, v)) {
          grid[r]![c] = v;
          if (solveSudoku(grid)) return true;
          grid[r]![c] = 0;
        }
      }
      return false;
    }
  }
  return true;
}

function canPlace(grid: Grid, r: number, c: number, v: number): boolean {
  for (let i = 0; i < 9; i++) {
    if (grid[r]![i] === v || grid[i]![c] === v) return false;
  }
  const br = r - (r % 3);
  const bc = c - (c % 3);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) if (grid[br + i]![bc + j] === v) return false;
  return true;
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  const out: T[][] = [];
  xs.forEach((x, i) => {
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)]))
      out.push([x, ...rest]);
  });
  return out;
}

function subsetSums(nums: number[], target: number): number[][] {
  const out: number[][] = [];
  const pick: number[] = [];
  const go = (i: number, remaining: number): void => {
    if (remaining === 0) {
      out.push([...pick]);
      return;
    }
    if (i >= nums.length || remaining < 0) return;
    pick.push(nums[i]!);
    go(i + 1, remaining - nums[i]!);
    pick.pop();
    go(i + 1, remaining);
  };
  go(0, target);
  return out;
}

for (let n = 1; n <= 8; n++) {
  const { count, first } = nQueens(n);
  console.log(`queens(${n}) = ${count}${first ? `  first: ${first.join("")}` : ""}`);
}
const board = nQueens(6).first!;
for (const col of board) console.log(".".repeat(col) + "Q" + ".".repeat(6 - col - 1));

const puzzle = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const grid: Grid = [];
for (let r = 0; r < 9; r++)
  grid.push(
    puzzle
      .slice(r * 9, r * 9 + 9)
      .split("")
      .map(Number),
  );
console.log(`solved: ${solveSudoku(grid)}`);
for (const row of grid) console.log(row.join(" "));

console.log(
  permutations(["a", "b", "c"])
    .map((p) => p.join(""))
    .join(" "),
);
console.log(permutations([1, 2, 3, 4]).length);
console.log(JSON.stringify(subsetSums([3, 34, 4, 12, 5, 2], 9)));
