interface Item {
  name: string;
  body: string[];
}

function rewriteStmt(narrowed: Set<string>, s: string): string {
  if (narrowed.has(s)) return s + "!";
  return s;
}

function tryNarrow(item: Item): boolean {
  return item.name.length > 3;
}

function narrowFnsPass(items: Item[]): void {
  const closureFns = new Set<string>();
  for (const item of items) {
    item.body.forEach((s: string): void => {
      if (s.length > 0) closureFns.add(s);
    });
  }

  const narrowed = new Set<string>();
  for (const item of items) {
    if (closureFns.has(item.name)) continue;
    if (tryNarrow(item)) narrowed.add(item.name);
  }
  if (narrowed.size === 0) return;
  for (const item of items) {
    item.body = item.body.map((s: string): string => rewriteStmt(narrowed, s));
  }
  for (const cls of items) {
    for (let i = 0; i < cls.body.length; i++) {
      console.log(cls.body[i]);
    }
  }
}

narrowFnsPass([
  { name: "hello", body: ["hello", "world"] },
  { name: "testing", body: ["testing", "one"] },
]);
