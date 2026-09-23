// @category: algorithms
// Tic-tac-toe with a minimax AI (alpha-beta pruning): the AI plays itself to a draw, then beats a
// scripted opponent. Counts evaluated positions.

type Player = "X" | "O";
type Cell = Player | null;
type Board = Cell[];

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

let evaluated = 0;

function winner(b: Board): Player | null {
  for (const [a, c, d] of LINES) {
    const v = b[a!];
    if (v && v === b[c!] && v === b[d!]) return v;
  }
  return null;
}

function moves(b: Board): number[] {
  const out: number[] = [];
  b.forEach((c, i) => {
    if (c === null) out.push(i);
  });
  return out;
}

function minimax(
  b: Board,
  turn: Player,
  me: Player,
  depth: number,
  alpha: number,
  beta: number,
): number {
  evaluated++;
  const w = winner(b);
  if (w) return w === me ? 10 - depth : depth - 10;
  const free = moves(b);
  if (free.length === 0) return 0;
  const next: Player = turn === "X" ? "O" : "X";
  if (turn === me) {
    let best = -Infinity;
    for (const m of free) {
      b[m] = turn;
      best = Math.max(best, minimax(b, next, me, depth + 1, alpha, beta));
      b[m] = null;
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }
  let best = Infinity;
  for (const m of free) {
    b[m] = turn;
    best = Math.min(best, minimax(b, next, me, depth + 1, alpha, beta));
    b[m] = null;
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

function bestMove(b: Board, me: Player): number {
  let best = -Infinity;
  let move = -1;
  for (const m of moves(b)) {
    b[m] = me;
    const score = minimax(b, me === "X" ? "O" : "X", me, 1, -Infinity, Infinity);
    b[m] = null;
    if (score > best) {
      best = score;
      move = m;
    }
  }
  return move;
}

function show(b: Board): string {
  return [0, 3, 6]
    .map((r) =>
      b
        .slice(r, r + 3)
        .map((c) => c ?? ".")
        .join(""),
    )
    .join("/");
}

function play(xMove: (b: Board) => number, oMove: (b: Board) => number): string {
  const b: Board = new Array<Cell>(9).fill(null);
  let turn: Player = "X";
  const history: string[] = [];
  while (!winner(b) && moves(b).length > 0) {
    const m = turn === "X" ? xMove(b) : oMove(b);
    b[m] = turn;
    history.push(`${turn}${m}`);
    turn = turn === "X" ? "O" : "X";
  }
  return `${history.join(" ")} => ${show(b)} ${winner(b) ?? "draw"}`;
}

console.log(
  play(
    (b) => bestMove(b, "X"),
    (b) => bestMove(b, "O"),
  ),
);
console.log(`positions evaluated: ${evaluated}`);
evaluated = 0;
const scripted = [4, 0, 8, 6, 2, 1, 3, 5, 7];
console.log(
  play(
    (b) => scripted.find((m) => b[m] === null)!,
    (b) => bestMove(b, "O"),
  ),
);
console.log(
  play(
    (b) => bestMove(b, "X"),
    (b) => moves(b)[0]!,
  ),
);
console.log(`positions evaluated: ${evaluated}`);
