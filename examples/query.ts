// SQLite Query - demonstrates embedded SQLite database operations

console.log("SQLite Demo");
console.log("  database: :memory:");
console.log("");

const db = sqlite.open(":memory:");
sqlite.exec(db, "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, role TEXT)");
sqlite.exec(db, "INSERT INTO users (name, role) VALUES ('Alice', 'admin')");
sqlite.exec(db, "INSERT INTO users (name, role) VALUES ('Bob', 'developer')");
sqlite.exec(db, "INSERT INTO users (name, role) VALUES ('Charlie', 'designer')");

console.log("Inserted 3 users. Querying...");
console.log("");

const rows = sqlite.all(db, "SELECT * FROM users");
console.log("Found " + rows.length + " rows:");
for (let i = 0; i < rows.length; i++) {
  console.log("  " + rows[i]);
}

sqlite.close(db);
console.log("");
console.log("Database closed.");
