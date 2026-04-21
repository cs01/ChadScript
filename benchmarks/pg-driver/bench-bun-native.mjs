// Bun's built-in native Postgres client (Bun.SQL). Only runs under Bun.
// Different from the `postgres` npm package — this is Bun's first-party
// C++-backed binding, so the fair comparison to libpq and chadscript-native.
//   bun bench-bun-native.mjs
import { SQL } from "bun";

const ITERS = 10000;
const RUNS = 3;

if (globalThis.Bun === undefined) {
  console.error("bun-native bench requires Bun runtime");
  process.exit(1);
}

async function runOnce() {
  const client = new SQL({
    host: "127.0.0.1",
    port: 5432,
    user: process.env.PGUSER ?? "postgres",
    database: process.env.PGDATABASE ?? "postgres",
    password: process.env.PGPASSWORD ?? "",
    max: 1,
  });
  await client`SELECT 1`;
  const t0 = Date.now();
  for (let i = 0; i < ITERS; i++) await client`SELECT 1`;
  const t1 = Date.now();
  await client.end();
  return t1 - t0;
}

const results = [];
for (let r = 0; r < RUNS; r++) results.push(await runOnce());
results.sort((a, b) => a - b);
const mid = results[1];
console.log(`bun-native iters=${ITERS} runs=${RUNS}`);
console.log(`runs_ms=${results.join(",")}`);
console.log(`median_ms=${mid} qps=${(ITERS / (mid / 1000)).toFixed(0)}`);
