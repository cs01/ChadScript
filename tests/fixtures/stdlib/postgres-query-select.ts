// @test-skip
import { Client } from "chadscript/postgres";

const c = new Client("host=127.0.0.1 port=5432 user=postgres password=test dbname=chadtest");
c.connect();

c.query("DROP TABLE IF EXISTS t_select");
c.query("CREATE TABLE t_select (id INT, name TEXT, city TEXT)");
c.query("INSERT INTO t_select VALUES (1, 'alice', 'nyc'), (2, 'bob', 'sf'), (3, 'carol', 'la')");

const res = c.query("SELECT id, name, city FROM t_select ORDER BY id");

if (res.rowCount !== 3) {
  console.log("TEST_FAILED: rowCount was " + res.rowCount);
  process.exit(1);
}
if (res.numRows !== 3) {
  console.log("TEST_FAILED: numRows was " + res.numRows);
  process.exit(1);
}
if (res.fields.length !== 3) {
  console.log("TEST_FAILED: fields.length was " + res.fields.length);
  process.exit(1);
}

if (res.fields[0] !== "id" || res.fields[1] !== "name" || res.fields[2] !== "city") {
  console.log(
    "TEST_FAILED: fields were " + res.fields[0] + "," + res.fields[1] + "," + res.fields[2],
  );
  process.exit(1);
}

const name0 = res.getValue(0, "name");
if (name0 !== "alice") {
  console.log("TEST_FAILED: row 0 name was " + name0);
  process.exit(1);
}
const city1 = res.getValue(1, "city");
if (city1 !== "sf") {
  console.log("TEST_FAILED: row 1 city was " + city1);
  process.exit(1);
}
const id2 = res.getValue(2, "id");
if (id2 !== "3") {
  console.log("TEST_FAILED: row 2 id was " + id2);
  process.exit(1);
}

const empty = c.query("SELECT id FROM t_select WHERE id > 100");
if (empty.numRows !== 0) {
  console.log("TEST_FAILED: empty query returned " + empty.numRows + " rows");
  process.exit(1);
}

c.query("DROP TABLE t_select");
c.end();
console.log("TEST_PASSED");
