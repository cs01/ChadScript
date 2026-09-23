// @expect-reject: CS1233
function run(): number {
  let cache: number | undefined = undefined;
  const v = ((): number => {
    const cur: number | undefined = cache;
    if (cur !== undefined) return cur;
    return 7;
  })();
  cache = v;
  return v;
}
console.log(run());
