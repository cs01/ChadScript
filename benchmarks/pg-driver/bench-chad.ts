// ChadScript pure-TS postgres driver benchmark.
// Usage: chad build bench-chad.ts -o /tmp/b && /tmp/b
// Reports median of 3 runs of 10000 SELECT 1 queries (simple protocol).

import { Client } from "chadscript/pg";

const ITERS = 10000;
const RUNS = 3;

function runOnce(): number {
  const user = process.env.PGUSER ?? "postgres";
  const db = process.env.PGDATABASE ?? "postgres";
  const pw = process.env.PGPASSWORD ?? "";
  const c = new Client({
    host: "127.0.0.1",
    port: 5432,
    user: user,
    database: db,
    password: pw,
  });
  if (!c.connect()) {
    console.log("FAIL connect: " + c.lastError());
    return 0;
  }
  // warmup
  c.query("SELECT 1");
  const t0 = Date.now();
  let i = 0;
  while (i < ITERS) {
    c.query("SELECT 1");
    i = i + 1;
  }
  const t1 = Date.now();
  c.end();
  return t1 - t0;
}

function main(): void {
  const results: number[] = [];
  let run = 0;
  while (run < RUNS) {
    const ms = runOnce();
    if (ms === 0) return;
    results.push(ms);
    run = run + 1;
  }
  // median
  results.sort((a, b) => a - b);
  const mid = results[1];
  const qps = ITERS / (mid / 1000);
  console.log("chad iters=" + ITERS + " runs=" + RUNS);
  console.log(
    "runs_ms=" + results[0] + "," + results[1] + "," + results[2],
  );
  console.log("median_ms=" + mid + " qps=" + qps);
  console.log("TEST_PASSED");
}

main();
