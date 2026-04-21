// @test-requires-env: PG_SCRAM_TESTS_ENABLED
// SCRAM-SHA-256 auth handshake against a Postgres server configured with
// password_encryption=scram-sha-256. Kept behind PG_SCRAM_TESTS_ENABLED so
// the default PG_TESTS_ENABLED runs (which expect md5) stay green — the
// scram CI matrix flips the gate once postgres is reconfigured.

import { Client } from "chadscript/pg";

function main(): void {
  // CI provisions `scramuser` (scram-sha-256 hashed) alongside the default
  // `postgres` user (md5-hashed). Local runs can override via PG_SCRAM_USER.
  const user = process.env.PG_SCRAM_USER ?? "scramuser";
  const db = process.env.PGDATABASE ?? "chadtest";
  const pw = process.env.PG_SCRAM_PASSWORD ?? "test";
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
  const row = r.rows[0] as string[];
  if (row[0] !== "1" || row[1] !== "hello") {
    console.log("FAIL row " + row[0] + "|" + row[1]);
    return;
  }
  c.end();
  console.log("TEST_PASSED");
}

main();
