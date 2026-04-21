// @test-requires-env: PG_TESTS_ENABLED
// Pure-TS Postgres driver — trust/md5 auth + simple 'Q' protocol.

import { Client } from "chadscript/pg";

function main(): void {
  // Defaults match the credentials the CI workflow provisions for the
  // `postgres` service (POSTGRES_USER=postgres POSTGRES_PASSWORD=test
  // POSTGRES_DB=chadtest). Override via env for local runs against a
  // different pg instance.
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
  const r = c.query("SELECT 1 AS x, 'hello'::text AS msg");
  if (r.rowCount !== 1) {
    console.log("FAIL rowCount " + r.rowCount);
    return;
  }
  if (r.fields.length !== 2) {
    console.log("FAIL fields " + r.fields.length);
    return;
  }
  const row = r.rows[0] as string[];
  if (row[0] !== "1" || row[1] !== "hello") {
    console.log("FAIL row " + row[0] + "|" + row[1]);
    return;
  }

  const r2 = c.query("SELECT generate_series(1,3) AS n");
  if (r2.rowCount !== 3) {
    console.log("FAIL multi rows " + r2.rowCount);
    return;
  }
  const r20 = r2.rows[0] as string[];
  const r21 = r2.rows[1] as string[];
  const r22 = r2.rows[2] as string[];
  if (r20[0] !== "1" || r21[0] !== "2" || r22[0] !== "3") {
    console.log("FAIL multi vals");
    return;
  }

  c.end();
  console.log("TEST_PASSED");
}

main();
