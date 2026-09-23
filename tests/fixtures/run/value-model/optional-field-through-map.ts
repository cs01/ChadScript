type R = { name: string; age?: number };
const people: R[] = [{ name: "a" }, { name: "b", age: 3 }];
const m = new Map<string, R>();
for (const p of people) m.set(p.name, p);
console.log(m.get("b")?.age ?? -1, m.get("zz")?.age ?? -1);
