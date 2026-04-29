type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "rect"; width: number; height: number };

function area(s: Shape): number {
  if (s.kind === "circle") {
    return Math.PI * s.radius * s.radius;
  }
  return s.width * s.height;
}

type Token =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "bool"; value: boolean };

function describe(t: Token): string {
  if (t.kind === "num") {
    return "num:" + t.value.toString();
  }
  if (t.kind === "str") {
    return "str:" + t.value;
  }
  return "bool:" + t.value.toString();
}

console.log(area({ kind: "circle", radius: 5 }).toFixed(4));
console.log(area({ kind: "rect", width: 3, height: 4 }));
console.log(describe({ kind: "num", value: 42 }));
console.log(describe({ kind: "str", value: "hello" }));
console.log(describe({ kind: "bool", value: true }));
