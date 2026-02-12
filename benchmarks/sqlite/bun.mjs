import { Database } from "bun:sqlite";

const db = new Database(":memory:");
db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");

for (let i = 0; i < 100; i++) {
  db.exec(`INSERT INTO t VALUES (${i}, 'value_${i}')`);
}

const iterations = 100000;
const start = performance.now();

for (let j = 0; j < iterations; j++) {
  const id = j % 100;
  db.query(`SELECT val FROM t WHERE id = ${id}`).get();
}

const end = performance.now();
const elapsed = (end - start) / 1000;
const qps = Math.round(iterations / elapsed);
console.log(`Queries:  ${iterations}`);
console.log(`Time:     ${elapsed.toFixed(3)}s`);
console.log(`QPS:      ${qps}`);

db.close();
