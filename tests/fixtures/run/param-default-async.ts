// Defaults on async functions and async arrows: the default is evaluated at the call, before the
// body's first await, in call order.
const log: string[] = [];
function mark(s: string): number {
  log.push(s);
  return s.length;
}
async function job(name: string, delay: number = mark(name)): Promise<string> {
  log.push("start " + name);
  await Promise.resolve(0);
  log.push("end " + name);
  return `${name}:${delay}`;
}
const later = async (x?: number, y = 2): Promise<number> => {
  await Promise.resolve(0);
  return (x ?? 1) * y;
};
async function main(): Promise<void> {
  const p1 = job("alpha");
  const p2 = job("beta", 7);
  log.push("spawned");
  console.log(await p1, await p2);
  console.log(await later(), await later(5), await later(5, 3));
  console.log(log.join(","));
}
main();
