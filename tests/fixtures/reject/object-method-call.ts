// @expect-reject: CS1225
type Handlers = { run: () => number };
const h: Handlers = { run: () => 42 };
console.log(h.run());
