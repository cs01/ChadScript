// @category: algorithms
// A small Matrix class: multiplication, transpose, determinant, inverse via Gauss-Jordan, solving
// a linear system, and matrix power for Fibonacci numbers.

class Matrix {
  readonly rows: number;
  readonly cols: number;
  private data: number[][];

  constructor(data: number[][]) {
    this.rows = data.length;
    this.cols = data[0]?.length ?? 0;
    if (data.some((r) => r.length !== this.cols)) throw new Error("ragged matrix");
    this.data = data.map((r) => [...r]);
  }

  static identity(n: number): Matrix {
    return new Matrix(
      Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))),
    );
  }

  get(i: number, j: number): number {
    return this.data[i]![j]!;
  }

  mul(other: Matrix): Matrix {
    if (this.cols !== other.rows)
      throw new Error(`cannot multiply ${this.rows}x${this.cols} by ${other.rows}x${other.cols}`);
    const out: number[][] = [];
    for (let i = 0; i < this.rows; i++) {
      const row: number[] = [];
      for (let j = 0; j < other.cols; j++) {
        let s = 0;
        for (let k = 0; k < this.cols; k++) s += this.get(i, k) * other.get(k, j);
        row.push(s);
      }
      out.push(row);
    }
    return new Matrix(out);
  }

  transpose(): Matrix {
    return new Matrix(Array.from({ length: this.cols }, (_, j) => this.data.map((r) => r[j]!)));
  }

  determinant(): number {
    if (this.rows !== this.cols) throw new Error("not square");
    if (this.rows === 1) return this.get(0, 0);
    if (this.rows === 2) return this.get(0, 0) * this.get(1, 1) - this.get(0, 1) * this.get(1, 0);
    let det = 0;
    for (let j = 0; j < this.cols; j++) {
      const minor = new Matrix(this.data.slice(1).map((r) => r.filter((_, c) => c !== j)));
      det += (j % 2 === 0 ? 1 : -1) * this.get(0, j) * minor.determinant();
    }
    return det;
  }

  inverse(): Matrix {
    const n = this.rows;
    const a = this.data.map((r, i) => [...r, ...Matrix.identity(n).data[i]!]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++)
        if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
      if (Math.abs(a[pivot]![col]!) < 1e-12) throw new Error("matrix is singular");
      [a[col], a[pivot]] = [a[pivot]!, a[col]!];
      const p = a[col]![col]!;
      a[col] = a[col]!.map((v) => v / p);
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = a[r]![col]!;
        a[r] = a[r]!.map((v, c) => v - f * a[col]![c]!);
      }
    }
    return new Matrix(a.map((r) => r.slice(n)));
  }

  pow(e: number): Matrix {
    let result = Matrix.identity(this.rows);
    let base: Matrix = this;
    while (e > 0) {
      if (e & 1) result = result.mul(base);
      base = base.mul(base);
      e >>= 1;
    }
    return result;
  }

  toString(): string {
    return this.data
      .map((r) => r.map((v) => (Math.abs(v) < 1e-10 ? 0 : v).toFixed(3).padStart(9)).join(""))
      .join("\n");
  }
}

const a = new Matrix([
  [2, 1, 1],
  [1, 3, 2],
  [1, 0, 0],
]);
const b = new Matrix([
  [4, -1],
  [0, 2],
  [1, 1],
]);
console.log(`A*B =\n${a.mul(b)}`);
console.log(`B^T =\n${b.transpose()}`);
console.log(`det(A) = ${a.determinant()}`);
console.log(`A^-1 =\n${a.inverse()}`);
console.log(`A*A^-1 =\n${a.mul(a.inverse())}`);
const rhs = new Matrix([[4], [5], [6]]);
console.log(`solve Ax=b: x =\n${a.inverse().mul(rhs)}`);
const fib = new Matrix([
  [1, 1],
  [1, 0],
]);
console.log(`fib: ${[1, 2, 10, 30, 50, 70].map((n) => fib.pow(n).get(0, 1)).join(", ")}`);
for (const bad of [
  () => a.mul(a.transpose().mul(b).transpose()),
  () =>
    new Matrix([
      [1, 2],
      [2, 4],
    ]).inverse(),
]) {
  try {
    bad();
  } catch (e) {
    console.log(`error: ${(e as Error).message}`);
  }
}
