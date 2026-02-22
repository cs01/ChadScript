interface User {
  id: string;
  name: string;
  age: string;
}

const db = sqlite.open(":memory:");
sqlite.exec(db, "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)");
sqlite.exec(db, "INSERT INTO users (name, age) VALUES ('Alice', 30)");
sqlite.exec(db, "INSERT INTO users (name, age) VALUES ('Bob', 25)");
sqlite.exec(db, "INSERT INTO users (name, age) VALUES ('Charlie', 35)");

// Test basic query
const users: User[] = sqlite.query(db, "SELECT id, name, age FROM users ORDER BY id");
if (users.length !== 3) {
  process.exit(1);
}
if (users[0].name !== "Alice") {
  process.exit(2);
}
if (users[1].name !== "Bob") {
  process.exit(3);
}
if (users[2].age !== "35") {
  process.exit(4);
}

// Test parameterized query
const filtered: User[] = sqlite.query(db, "SELECT id, name, age FROM users WHERE age > ?", ["28"]);
if (filtered.length !== 2) {
  process.exit(5);
}

// Test empty result
const empty: User[] = sqlite.query(db, "SELECT id, name, age FROM users WHERE name = 'Nobody'");
if (empty.length !== 0) {
  process.exit(6);
}

sqlite.close(db);
console.log("TEST_PASSED");
