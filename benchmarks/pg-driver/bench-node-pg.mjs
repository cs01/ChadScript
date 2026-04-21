// node-pg benchmark (Node runtime). Usage: node bench-node-pg.mjs
import pg from "pg";

const ITERS = 10000;
const RUNS = 3;

async function runOnce() {
  const c = new pg.Client({
    host: "127.0.0.1",
    port: 5432,
    user: process.env.PGUSER ?? "postgres",
    database: process.env.PGDATABASE ?? "postgres",
    password: process.env.PGPASSWORD ?? "",
  });
  await c.connect();
  await c.query("SELECT 1");
  const t0 = Date.now();
  for (let i = 0; i < ITERS; i++) await c.query("SELECT 1");
  const t1 = Date.now();
  await c.end();
  return t1 - t0;
}

const results = [];
for (let r = 0; r < RUNS; r++) results.push(await runOnce());
results.sort((a, b) => a - b);
const mid = results[1];
console.log(`node-pg iters=${ITERS} runs=${RUNS}`);
console.log(`runs_ms=${results.join(",")}`);
console.log(`median_ms=${mid} qps=${(ITERS / (mid / 1000)).toFixed(0)}`);
