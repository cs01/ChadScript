// @expect-reject: CS1216
const s: string = "abc";
for (const c of s) {
  console.log(c);
}
