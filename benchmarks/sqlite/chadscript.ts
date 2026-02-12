function runBenchmark(): void {
  const db = sqlite.open(":memory:");
  sqlite.exec(db, "CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");

  let i = 0;
  while (i < 100) {
    sqlite.exec(db, "INSERT INTO t VALUES (" + i + ", 'value_" + i + "')");
    i = i + 1;
  }

  const iterations = 100000;
  const start = Date.now();

  let j = 0;
  while (j < iterations) {
    const id = j % 100;
    sqlite.get(db, "SELECT val FROM t WHERE id = " + id);
    j = j + 1;
  }

  const end = Date.now();
  const elapsed = (end - start) / 1000;
  const qps = iterations / elapsed;
  console.log("Queries:  " + iterations);
  console.log("Time:     " + elapsed + "s");
  console.log("QPS:      " + qps);

  sqlite.close(db);
}

runBenchmark();
