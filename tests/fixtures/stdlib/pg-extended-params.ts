// @test-requires-env: PG_TESTS_ENABLED
// Pure-TS Postgres — extended protocol + param binding (text mode).

import { Client } from "chadscript/pg";

function main(): void {
  const user = process.env.PGUSER ?? "postgres";
  const db = process.env.PGDATABASE ?? "chadtest";
  const pw = process.env.PGPASSWORD ?? "test";
  const c = new Client({
    host: "127.0.0.1",
    port: 5432,
    user: user,
    database: db,
    password: pw,
  });
  if (!c.connect()) {
    console.log("FAIL connect: " + c.lastError());
    return;
  }

  // Single int param
  const r1 = c.queryParams("SELECT $1::int AS n", ["42"]);
  if (r1.rowCount !== 1) {
    console.log("FAIL r1 rowCount=" + r1.rowCount + " err=" + c.lastError());
    return;
  }
  const row1 = r1.rows[0] as string[];
  if (row1[0] !== "42") {
    console.log("FAIL r1 val " + row1[0]);
    return;
  }

  // Multi params, mixed types (all bound as text, server casts)
  const r2 = c.queryParams("SELECT $1::int AS n, $2::text AS s, $3::text AS t", [
    "7",
    "hello",
    "world",
  ]);
  if (r2.rowCount !== 1) {
    console.log("FAIL r2 rc=" + r2.rowCount);
    return;
  }
  const row2 = r2.rows[0] as string[];
  if (row2[0] !== "7" || row2[1] !== "hello" || row2[2] !== "world") {
    console.log("FAIL r2 " + row2[0] + "|" + row2[1] + "|" + row2[2]);
    return;
  }

  // Param used twice
  const r3 = c.queryParams("SELECT $1::int * 2 AS double_n, $1::int + 1 AS inc", ["5"]);
  const row3 = r3.rows[0] as string[];
  if (row3[0] !== "10" || row3[1] !== "6") {
    console.log("FAIL r3 " + row3[0] + "|" + row3[1]);
    return;
  }

  // Multi-row w/ generate_series and a param
  const r4 = c.queryParams("SELECT n FROM generate_series(1, $1::int) AS n", ["3"]);
  if (r4.rowCount !== 3) {
    console.log("FAIL r4 rc=" + r4.rowCount);
    return;
  }
  const r40 = r4.rows[0] as string[];
  const r41 = r4.rows[1] as string[];
  const r42 = r4.rows[2] as string[];
  if (r40[0] !== "1" || r41[0] !== "2" || r42[0] !== "3") {
    console.log("FAIL r4 vals");
    return;
  }

  c.end();
  console.log("TEST_PASSED");
}

main();
