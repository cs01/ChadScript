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

  sqlite.close(db);
  console.log("TEST_PASSED");
}
testSqlite();
