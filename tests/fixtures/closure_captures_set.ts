function rewrite(s: string, names: Set<string>): string {
  if (names.has(s)) return s + "!";
  return s;
}

function doWork(data: string[]): string[] {
  const narrowed = new Set<string>();
  narrowed.add("hello");
  const result = data.map((s: string): string => rewrite(s, narrowed));
  return result;
}

const out = doWork(["hello", "world"]);
for (let i = 0; i < out.length; i++) {
  console.log(out[i]);
}
