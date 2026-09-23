// @known-bug: `new Map(entries)` passes the validator and then ICEs in lower (should be admitted or rejected with a CS code); found writing the docs console example
const m = new Map<string, number>([["a", 1]]);
console.log(m.get("a"));
