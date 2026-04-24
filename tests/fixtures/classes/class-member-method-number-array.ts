// @test-description: subscript on this.field.method() returning number[] resolves correctly
class Scores {
  data: number[] = [];
  getAll(): number[] {
    const r: number[] = [];
    for (let i = 0; i < this.data.length; i++) {
      r.push(this.data[i]);
    }
    return r;
  }
}

class Board {
  scores: Scores;
  constructor() {
    this.scores = new Scores();
  }
  check(): void {
    this.scores.data.push(10);
    this.scores.data.push(42);
    const all = this.scores.getAll();
    const last = all[all.length - 1];
    if (last === 42) {
      console.log("TEST_PASSED");
    }
  }
}

function main(): void {
  const b = new Board();
  b.check();
}
main();
