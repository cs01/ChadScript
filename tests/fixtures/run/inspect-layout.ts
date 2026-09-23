// util.inspect layout rules beyond the 80-column break: cycles, quoting, empty containers past the
// depth cutoff, `... N more items`, long strings split at newlines, Map/Set breaking.
class Link {
  next: Link | null = null;
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}
const a = new Link("a");
const b = new Link("b");
a.next = b;
b.next = a;
console.log(a);
console.log([a, b]);
const self = new Link("self");
self.next = self;
console.log({ self, other: self });

console.log(["plain", "it's", 'say "hi"', "both ' and \"", "all ' \" `", "tpl ${x} ' \""]);
console.log(["tab\there", "nl\nx", "bell\u0007", "del\u007f", "back\\slash"]);

const none: number[] = [];
const empty: number[][][][] = [[[none]]];
const full: number[][][][] = [[[[1]]]];
console.log(empty, full);

const many: number[] = [];
for (let i = 0; i < 130; i++) many.push(i);
console.log(many);
const words: string[] = [];
for (let i = 0; i < 101; i++) words.push("w" + String(i));
console.log(words);
const floats: number[] = [];
for (let i = 0; i < 12; i++) floats.push(i * 1.25 - 3);
console.log(floats);

const long =
  "first line of a fairly long string\nsecond line of the same string\nthird line, " +
  "which runs on for a while so the whole thing is long\n";
console.log([long]);
console.log({ text: long, short: "x\ny" });

const m = new Map<string, number[]>();
for (let i = 0; i < 6; i++) m.set("key number " + String(i), [i, i * 2, i * 3]);
console.log(m);
const s = new Set<string>();
for (let i = 0; i < 12; i++) s.add("element-" + String(i));
console.log(s);
const bigSet = new Set<number>();
for (let i = 0; i < 105; i++) bigSet.add(i);
console.log(bigSet);
