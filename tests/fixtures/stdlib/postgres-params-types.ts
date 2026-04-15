// @test-requires-env: PG_TESTS_ENABLED
import { Pool } from "chadscript/postgres";

const pool = new Pool("host=127.0.0.1 port=5432 user=postgres password=test dbname=chadtest");

pool.query("DROP TABLE IF EXISTS t_typed");
pool.query("CREATE TABLE t_typed (id INT, price REAL, active BOOLEAN, name TEXT)");

pool.query("INSERT INTO t_typed VALUES ($1, $2, $3, $4)", ["1", "19.99", "true", "widget"]);
pool.query("INSERT INTO t_typed VALUES ($1, $2, $3, $4)", ["2", "3.5", "false", "gadget"]);

const sel = pool.query("SELECT id, price, active, name FROM t_typed WHERE id = $1", ["1"]);
if (sel.rowCount !== 1) {
  console.log("TEST_FAILED: rowCount " + sel.rowCount);
  process.exit(1);
}

const id = sel.getInt(0, "id");
if (id !== 1) {
  console.log("TEST_FAILED: id " + id);
  process.exit(1);
}

const price = sel.getFloat(0, "price");
if (price < 19.98 || price > 20.0) {
  console.log("TEST_FAILED: price " + price);
  process.exit(1);
}

const active = sel.getBool(0, "active");
if (!active) {
  console.log("TEST_FAILED: active was false");
  process.exit(1);
}

const name = sel.getValue(0, "name");
if (name !== "widget") {
  console.log("TEST_FAILED: name " + name);
  process.exit(1);
}

const all = pool.query("SELECT id, active FROM t_typed ORDER BY id");
if (all.numRows !== 2) {
  console.log("TEST_FAILED: all.numRows " + all.numRows);
  process.exit(1);
}
if (all.getBool(1, "active")) {
  console.log("TEST_FAILED: row 1 active should be false");
  process.exit(1);
}

pool.query("INSERT INTO t_typed VALUES ($1, $2, $3, $4)", ["99", "0", "false", "sql-safe ' test"]);
const safe = pool.query("SELECT name FROM t_typed WHERE id = $1", ["99"]);
if (safe.getValue(0, "name") !== "sql-safe ' test") {
  console.log("TEST_FAILED: injection-unsafe name " + safe.getValue(0, "name"));
  process.exit(1);
}

pool.query("DROP TABLE t_typed");
pool.end();
console.log("TEST_PASSED");
