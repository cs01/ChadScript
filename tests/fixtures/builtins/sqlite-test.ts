function testSqlite(): void {
  const db = sqlite.open(":memory:");

  sqlite.exec(db, "CREATE TABLE users (id INTEGER, name TEXT)");
  sqlite.exec(db, "INSERT INTO users VALUES (1, 'Alice')");
  sqlite.exec(db, "INSERT INTO users VALUES (2, 'Bob')");
  sqlite.exec(db, "INSERT INTO users VALUES (3, 'Charlie')");

  const name = sqlite.get(db, "SELECT name FROM users WHERE id = 1");
  if (name !== "Alice") {
    console.log("FAIL: expected Alice, got:");
    console.log(name);
    process.exit(1);
  }

  const names = sqlite.all(db, "SELECT name FROM users ORDER BY id");
  if (names.length !== 3) {
    console.log("FAIL: expected 3 rows");
    process.exit(1);
  }
  if (names[0] !== "Alice") {
    console.log("FAIL: first row should be Alice");
    process.exit(1);
  }
  if (names[1] !== "Bob") {
    console.log("FAIL: second row should be Bob");
    process.exit(1);
  }
  if (names[2] !== "Charlie") {
    console.log("FAIL: third row should be Charlie");
    process.exit(1);
  }

  sqlite.exec(db, "INSERT INTO users VALUES (?, ?)", [4, "Dave"]);

  const dave = sqlite.get(db, "SELECT name FROM users WHERE id = ?", [4]);
  if (dave !== "Dave") {
    console.log("FAIL: expected Dave, got:");
    console.log(dave);
    process.exit(1);
  }

  const after2 = sqlite.all(db, "SELECT name FROM users WHERE id > ? ORDER BY id", [2]);
  if (after2.length !== 2) {
    console.log("FAIL: expected 2 rows after id>2, got:");
    console.log(after2.length);
    process.exit(1);
  }
  if (after2[0] !== "Charlie") {
    console.log("FAIL: first row after id>2 should be Charlie");
    process.exit(1);
  }
  if (after2[1] !== "Dave") {
    console.log("FAIL: second row after id>2 should be Dave");
    process.exit(1);
  }

  const row = sqlite.get(db, "SELECT id, name FROM users WHERE id = 1");
  if (row !== "1|Alice") {
    console.log("FAIL: multi-col get expected '1|Alice', got:");
    console.log(row);
    process.exit(1);
  }

  const rows = sqlite.all(db, "SELECT id, name FROM users ORDER BY id");
  if (rows.length !== 4) {
    console.log("FAIL: multi-col all expected 4 rows, got:");
    console.log(rows.length);
    process.exit(1);
  }
  if (rows[0] !== "1|Alice") {
    console.log("FAIL: multi-col row 0 expected '1|Alice', got:");
    console.log(rows[0]);
    process.exit(1);
  }
  if (rows[1] !== "2|Bob") {
    console.log("FAIL: multi-col row 1 expected '2|Bob', got:");
    console.log(rows[1]);
    process.exit(1);
  }

  const parts = rows[0].split('|');
  if (parts[0] !== "1") {
    console.log("FAIL: split id expected '1', got:");
    console.log(parts[0]);
    process.exit(1);
  }
  if (parts[1] !== "Alice") {
    console.log("FAIL: split name expected 'Alice', got:");
    console.log(parts[1]);
    process.exit(1);
  }

  sqlite.close(db);
  console.log("TEST_PASSED");
}
testSqlite();
