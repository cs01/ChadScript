const a: number[] = [1, 2, 3];
const b: number[] = [0, ...a, 4, 5];
console.log(b.length);
for (let i = 0; i < b.length; i++) {
  console.log(b[i]);
}

const s1: string[] = ["hello"];
const s2: string[] = [...s1, "world"];
console.log(s2[0]);
console.log(s2[1]);

const c: number[] = [1, 2];
const d: number[] = [3, 4];
const e: number[] = [...c, ...d];
console.log(e.length);
for (let i = 0; i < e.length; i++) {
  console.log(e[i]);
}
