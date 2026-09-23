// @category: simulation
// Conway's Game of Life on a toroidal grid: a glider and a blinker, generation statistics,
// cycle detection with a seen-states set, and the final board written to a file.
import { writeFileSync } from "node:fs";

class Life {
  private cells: boolean[][];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cells = [];
    for (let y = 0; y < height; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < width; x++) row.push(false);
      this.cells.push(row);
    }
  }

  set(x: number, y: number, alive = true): void {
    const row = this.cells[((y % this.height) + this.height) % this.height];
    if (row) row[((x % this.width) + this.width) % this.width] = alive;
  }

  get(x: number, y: number): boolean {
    const row = this.cells[((y % this.height) + this.height) % this.height];
    return row ? row[((x % this.width) + this.width) % this.width] === true : false;
  }

  neighbors(x: number, y: number): number {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx !== 0 || dy !== 0) && this.get(x + dx, y + dy)) n++;
      }
    }
    return n;
  }

  step(): void {
    const next: boolean[][] = [];
    for (let y = 0; y < this.height; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < this.width; x++) {
        const n = this.neighbors(x, y);
        row.push(n === 3 || (n === 2 && this.get(x, y)));
      }
      next.push(row);
    }
    this.cells = next;
  }

  population(): number {
    let count = 0;
    for (const row of this.cells) for (const c of row) if (c) count++;
    return count;
  }

  render(): string {
    return this.cells.map((row) => row.map((c) => (c ? "#" : ".")).join("")).join("\n");
  }
}

const life = new Life(12, 8);
// glider
life.set(1, 0);
life.set(2, 1);
life.set(0, 2);
life.set(1, 2);
life.set(2, 2);
// blinker
life.set(8, 5);
life.set(9, 5);
life.set(10, 5);

console.log(`gen 0 (pop ${life.population()}):\n${life.render()}`);
const seen = new Map<string, number>();
let gen = 0;
while (gen < 200) {
  const key = life.render();
  const prev = seen.get(key);
  if (prev !== undefined) {
    console.log(`cycle: generation ${gen} repeats generation ${prev} (period ${gen - prev})`);
    break;
  }
  seen.set(key, gen);
  life.step();
  gen++;
  if (gen === 4 || gen === 10)
    console.log(`gen ${gen} (pop ${life.population()}):\n${life.render()}`);
}
writeFileSync("final-board.txt", life.render() + "\n");
console.log(`stopped at generation ${gen}, population ${life.population()}`);
