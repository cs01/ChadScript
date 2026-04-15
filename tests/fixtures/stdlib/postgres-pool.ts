// @test-skip
import { Pool } from "chadscript/postgres";

const pool = new Pool("host=127.0.0.1 port=5432 user=postgres password=test dbname=chadtest");

pool.query("DROP TABLE IF EXISTS t_pool");
pool.query("CREATE TABLE t_pool (id INT, name TEXT)");
pool.query("INSERT INTO t_pool VALUES (1, 'alice'), (2, 'bob')");

const res = pool.query("SELECT id, name FROM t_pool ORDER BY id");
if (res.rowCount !== 2) {
  console.log("TEST_FAILED: rowCount was " + res.rowCount);
  process.exit(1);
}
const name0 = res.getValue(0, "name");
if (name0 !== "alice") {
  console.log("TEST_FAILED: name0 was " + name0);
  process.exit(1);
}

pool.query("DROP TABLE t_pool");
pool.end();
console.log("TEST_PASSED");
