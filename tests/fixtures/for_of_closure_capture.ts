interface Item {
  name: string;
  body: string[];
}

function rewrite(s: string, names: Set<string>): string {
  if (names.has(s)) return s + "!";
  return s;
}

function doWork(items: Item[]): void {
  const narrowed = new Set<string>();
  for (const item of items) {
    narrowed.add(item.name);
  }
  for (const item of items) {
    item.body = item.body.map((s: string): string => rewrite(s, narrowed));
  }
  for (const item of items) {
    for (let i = 0; i < item.body.length; i++) {
      console.log(item.body[i]);
    }
  }
}

doWork([
  { name: "hello", body: ["hello", "world"] },
  { name: "world", body: ["foo", "world"] },
]);
