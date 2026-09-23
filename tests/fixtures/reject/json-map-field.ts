// @expect-reject: CS1238
// Node serializes a Map as `{}`; the JSON formatter has no text for it.
const m = new Map<string, number>();
m.set("a", 1);
console.log(JSON.stringify({ m }));
