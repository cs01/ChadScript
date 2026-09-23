type Handlers = { run: () => number };
const h: Handlers = { run: () => 42 };
console.log(h.run());
