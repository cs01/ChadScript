// @test-skip
import { Client } from "chadscript/postgres";

const c = new Client("host=127.0.0.1 port=5432 user=postgres password=test dbname=chadtest");
c.connect();

c.query("DROP TABLE IF EXISTS t_rowcount");
c.query("CREATE TABLE t_rowcount (id INT, name TEXT)");

const ins1 = c.query("INSERT INTO t_rowcount VALUES (1, 'alice')");
if (ins1.rowCount !== 1) {
  console.log("TEST_FAILED: insert rowCount was " + ins1.rowCount);
  process.exit(1);
}

const ins2 = c.query("INSERT INTO t_rowcount VALUES (2, 'bob'), (3, 'carol')");
if (ins2.rowCount !== 2) {
  console.log("TEST_FAILED: bulk insert rowCount was " + ins2.rowCount);
  process.exit(1);
}

const upd = c.query("UPDATE t_rowcount SET name = 'ALICE' WHERE id = 1");
if (upd.rowCount !== 1) {
  console.log("TEST_FAILED: update rowCount was " + upd.rowCount);
  process.exit(1);
}

const del = c.query("DELETE FROM t_rowcount WHERE id > 0");
if (del.rowCount !== 3) {
  console.log("TEST_FAILED: delete rowCount was " + del.rowCount);
  process.exit(1);
}

c.query("DROP TABLE t_rowcount");
c.end();
console.log("TEST_PASSED");
