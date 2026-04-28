const m = new Map<string, number>();
m.set("a", 1);
m.set("b", 2);
m.set("c", 3);

const keys: string[] = [...m.keys()];
console.log(keys.length);
console.log(keys.join(","));

const vals: number[] = [...m.values()];
console.log(vals.length);

const m2 = new Map<number, string>();
m2.set(1, "one");
m2.set(2, "two");
const k2: number[] = [...m2.keys()];
console.log(k2.length);
const v2: string[] = [...m2.values()];
console.log(v2.join(","));
