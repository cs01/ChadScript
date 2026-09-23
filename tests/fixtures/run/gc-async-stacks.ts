// Collector roots on fiber stacks: each async body keeps its locals only on its own (suspended)
// stack while the others allocate. Stacks of finished fibers are recycled for new ones.
function churn(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += ("c" + i).length;
  return s;
}

async function worker(id: number): Promise<string> {
  const mine: string[] = [];
  const obj = { id: id, tag: "w" + id };
  for (let step = 0; step < 15; step++) {
    mine.push(obj.tag + "." + step);
    await Promise.resolve(step);
    churn(40);
  }
  return mine[0] + ".." + mine[14] + "/" + obj.id;
}

async function main(): Promise<void> {
  for (let wave = 0; wave < 3; wave++) {
    const ps: Promise<string>[] = [];
    for (let i = 0; i < 12; i++) ps.push(worker(wave * 100 + i));
    const done = await Promise.all(ps);
    console.log(wave, done.length, done[0], done[11]);
  }
}

main();
