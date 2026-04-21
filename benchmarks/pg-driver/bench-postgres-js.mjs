// postgres.js benchmark (works on Node or Bun). Usage:
//   node bench-postgres-js.mjs    OR
//   bun bench-postgres-js.mjs
import postgres from "postgres";

const ITERS = 10000;
const RUNS = 3;

async function runOnce() {
  const sql = postgres({
    host: "127.0.0.1",
    port: 5432,
    user: process.env.PGUSER ?? "postgres",
    database: process.env.PGDATABASE ?? "postgres",
    password: process.env.PGPASSWORD ?? "",
    max: 1,
  });
  await sql`SELECT 1`;
  const t0 = Date.now();
  for (let i = 0; i < ITERS; i++) await sql`SELECT 1`;
  const t1 = Date.now();
  await sql.end();
  return t1 - t0;
}

const results = [];
for (let r = 0; r < RUNS; r++) results.push(await runOnce());
results.sort((a, b) => a - b);
const mid = results[1];
const host = globalThis.Bun !== undefined ? "bun" : "node";
console.log(`postgres.js-${host} iters=${ITERS} runs=${RUNS}`);
console.log(`runs_ms=${results.join(",")}`);
console.log(`median_ms=${mid} qps=${(ITERS / (mid / 1000)).toFixed(0)}`);
