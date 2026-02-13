const MIN_DEPTH = 4;
const MAX_DEPTH = 18;

function makeTree(depth) {
  if (depth === 0) return { left: null, right: null };
  return { left: makeTree(depth - 1), right: makeTree(depth - 1) };
}

function checkTree(node) {
  if (node.left === null) return 1;
  return 1 + checkTree(node.left) + checkTree(node.right);
}

const start = performance.now();

const stretchDepth = MAX_DEPTH + 1;
console.log(`stretch: ${checkTree(makeTree(stretchDepth))}`);

const longLived = makeTree(MAX_DEPTH);

for (let depth = MIN_DEPTH; depth <= MAX_DEPTH; depth += 2) {
  const iterations = 1 << (MAX_DEPTH - depth + MIN_DEPTH);
  let check = 0;
  for (let i = 0; i < iterations; i++) {
    check += checkTree(makeTree(depth));
  }
  console.log(`depth ${depth} check: ${check}`);
}

console.log(`long lived: ${checkTree(longLived)}`);

const elapsed = (performance.now() - start) / 1000;
console.log(`Time:     ${elapsed.toFixed(3)}s`);
