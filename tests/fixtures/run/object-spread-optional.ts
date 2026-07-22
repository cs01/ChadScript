interface Opts {
  name: string;
  tag?: string;
}
const o1: Opts = { name: "x" };
const o2: Opts = { ...o1, tag: "hello" };
console.log(o2.name);
console.log(o2.tag ?? "no-tag");
console.log(o1.tag ?? "no-tag");
const o3: Opts = { ...o2 };
console.log(o3.tag ?? "none");
