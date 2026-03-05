// SQLite Query - demonstrates embedded SQLite database operations

interface User {
  id: string;
  name: string;
  role: string;
}

console.log("SQLite Demo");
console.log("  database: :memory:");
console.log("");

const db = sqlite.open(":memory:");
sqlite.exec(db, "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, role TEXT)");
sqlite.exec(db, "INSERT INTO users (name, role) VALUES (?, ?)", ["Alice", "admin"]);
sqlite.exec(db, "INSERT INTO users (name, role) VALUES (?, ?)", ["Bob", "developer"]);
sqlite.exec(db, "INSERT INTO users (name, role) VALUES (?, ?)", ["Charlie", "designer"]);

console.log("Inserted 3 users. Querying...");
console.log("");

const rows: User[] = sqlite.query<User>(db, "SELECT id, name, role FROM users ORDER BY name");
console.log("Found " + rows.length + " rows:");
for (let i = 0; i < rows.length; i++) {
  console.log("  " + rows[i].id + " | " + rows[i].name + " | " + rows[i].role);
}

console.log("");
const alice: User = sqlite.getRow<User>(db, "SELECT id, name, role FROM users WHERE name = ?", [
  "Alice",
]);
if (alice !== null) {
  console.log("Alice's role: " + alice.role);
}

sqlite.close(db);
console.log("");
console.log("Database closed.");
