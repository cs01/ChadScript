const a: number | null = null;
console.log("a=" + String(a ?? 42));

const x: any = null;
console.log("x=" + String(x ?? 99));

const s: string | null = null;
console.log("s=" + (s ?? "fallback"));

const n: number | null = 5;
console.log("n=" + String(n ?? 100));

const truthyZero: number | null = 0;
console.log("zero=" + String(truthyZero ?? 999));
