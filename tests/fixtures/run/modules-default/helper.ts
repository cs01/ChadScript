// The local name of a default-exported function and the importer's name for it are one binding:
// the recursive call here and `helper(3)` in main reach the same function.
export default function helper(n: number): number {
  return n <= 0 ? inner() : 1 + helper(n - 1);
}

function inner(): number {
  return 41;
}
