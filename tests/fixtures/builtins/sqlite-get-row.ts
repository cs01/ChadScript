// @test-description: sqlite getRow returns typed struct

interface User {
  id: string;
  name: string;
  age: string;
}

function testGetRow(): void {
  const db = sqlite.open(":memory:");
  sqlite.exec(db, "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)");
  sqlite.exec(db, "INSERT INTO users (name, age) VALUES (?, ?)", ["Alice", 30]);
  sqlite.exec(db, "INSERT INTO users (name, age) VALUES (?, ?)", ["Bob", 25]);

  const alice: User = sqlite.getRow<User>(db, "SELECT id, name, age FROM users WHERE name = ?", [
    "Alice",
  ]);
  if (alice === null) {
    process.exit(1);
  }
  if (alice.name !== "Alice") {
    process.exit(2);
  }
  if (alice.age !== "30") {
    process.exit(3);
  }

  const nobody: User = sqlite.getRow<User>(db, "SELECT id, name, age FROM users WHERE name = ?", [
    "Nobody",
  ]);
  if (nobody !== null) {
    process.exit(4);
  }

  const first: User = sqlite.getRow<User>(db, "SELECT id, name, age FROM users ORDER BY id");
  if (first === null) {
    process.exit(5);
  }
  if (first.name !== "Alice") {
    process.exit(6);
  }

  sqlite.close(db);
  console.log("TEST_PASSED");
}
testGetRow();
