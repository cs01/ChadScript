// @test-requires-env: PG_TESTS_ENABLED
// Pure-TS Postgres — round-robin Pool w/ N clients, auto-reconnect.

import { Pool } from "chadscript/pg";

function main(): void {
  const user = process.env.PGUSER ?? "postgres";
  const db = process.env.PGDATABASE ?? "chadtest";
  const pw = process.env.PGPASSWORD ?? "test";
  const p = new Pool({
    host: "127.0.0.1",
    port: 5432,
    user: user,
    database: db,
    password: pw,
    size: 3,
  });
  if (p.size() !== 3) {
    console.log("FAIL size " + p.size());
    return;
  }

  // Run 10 queries — should round-robin across 3 conns
  let i = 0;
  while (i < 10) {
    const r = p.queryParams("SELECT $1::int AS n", ["" + i]);
    if (r.rowCount !== 1) {
      console.log("FAIL iter " + i + " rc=" + r.rowCount + " err=" + p.lastError());
      return;
    }
    const row = r.rows[0] as string[];
    if (row[0] !== "" + i) {
      console.log("FAIL iter " + i + " got " + row[0]);
      return;
    }
    i = i + 1;
  }

  // Verify each conn has distinct backend pid (would fail if all went through
  // one client — Pool round-robin should spread them).
  const seen: string[] = [];
  let j = 0;
  while (j < 6) {
    const r = p.query("SELECT pg_backend_pid()::text AS pid");
    const row = r.rows[0] as string[];
    const pid = row[0];
    let found = 0;
    let k = 0;
    while (k < seen.length) {
      if (seen[k] === pid) {
        found = 1;
        break;
      }
      k = k + 1;
    }
    if (found === 0) seen.push(pid);
    j = j + 1;
  }
  if (seen.length !== 3) {
    console.log("FAIL distinct pids " + seen.length + " expected 3");
    return;
  }

  p.end();
  console.log("TEST_PASSED");
}

main();
