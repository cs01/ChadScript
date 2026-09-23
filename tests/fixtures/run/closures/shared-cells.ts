// Reassignment after the closure exists, nested closures sharing one cell, and cells of every
// representation (number, string, boolean, object, array, union, optional).
function main(): void {
  let msg = "before";
  const show = (): string => msg;
  msg = "after";
  console.log(show());

  // Nested: the inner closure and the outer function share the same variable.
  let depth = 0;
  const outer = (): (() => number) => {
    depth++;
    return () => {
      depth += 100;
      return depth;
    };
  };
  const inner = outer();
  console.log(depth, inner(), depth, inner());

  let flag = false;
  const toggle = (): boolean => {
    flag = !flag;
    return flag;
  };
  toggle();
  console.log(flag, toggle(), flag);

  let point = { x: 1, y: 2 };
  const move = (): void => {
    point = { x: point.x + 1, y: point.y * 2 };
  };
  move();
  move();
  console.log(point.x, point.y);

  let items: number[] = [];
  const reset = (): void => {
    items = [7, 8];
  };
  items.push(1);
  reset();
  items.push(9);
  console.log(items.join(","));

  // A union cell: the closure narrows its own read (no call in between, so tsc's narrowing is
  // exact there); the declaring scope reads it through a getter, where tsc does not narrow it.
  let v: number | string = 1;
  const flip = (): void => {
    v = typeof v === "number" ? `n${v}` : 5;
  };
  const getV = (): number | string => v;
  flip();
  console.log(getV());
  flip();
  console.log(getV());

  let maybe: string | undefined = undefined;
  const set = (s: string): void => {
    maybe = s;
  };
  const getMaybe = (): string | undefined => maybe;
  console.log(getMaybe() ?? "none");
  set("here");
  console.log(getMaybe() ?? "none");

  // Memoization through an optional cell.
  let cache: number | undefined = undefined;
  let computed = 0;
  const memo = (): number => {
    const cur: number | undefined = cache;
    if (cur !== undefined) return cur;
    computed++;
    const fresh = 6 * 7;
    cache = fresh;
    return fresh;
  };
  console.log(memo(), memo(), computed);

  // Two sibling closures, one writer and one reader, over a parameter-free cell.
  let total = 0;
  const add = (n: number): void => {
    total += n;
  };
  const read = (): number => total;
  [1, 2, 3, 4].forEach(add);
  console.log(read());
}
main();

// A captured parameter reassigned by the enclosing function AFTER the closure is made.
function late(n: number): () => number {
  const get = (): number => n;
  n = n * 10;
  return get;
}
const lateGet = late(4);
console.log(lateGet());
