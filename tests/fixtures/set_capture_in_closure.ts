function rewrite(s: string, items: Set<string>): string {
  if (items.has(s)) return s + "!";
  return s;
}

function process(data: string[]): void {
  const narrowed = new Set<string>();
  narrowed.add("hello");
  narrowed.add("world");

  for (let i = 0; i < data.length; i++) {
    const r = rewrite(data[i], narrowed);
    console.log(r);
  }
}

process(["hello", "foo", "world"]);
