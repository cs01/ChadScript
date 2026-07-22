const s = new Set<number>([3, 1, 2, 1]);
console.log([...s].join(","));
console.log([...s].length);
const m = new Map<string, number>();
m.set("x", 1);
m.set("y", 2);
console.log([...m.keys()].join(","));
console.log([...m.values()].reduce((p: number, c: number): number => p + c, 0));
