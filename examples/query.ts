// SQLite - embedded database with typed queries

interface User {
  id: string;
  name: string;
  role: string;
}

interface RoleCount {
  role: string;
  count: number;
}

const db = sqlite.open(":memory:");

sqlite.exec(db, "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, role TEXT)");
sqlite.exec(db, "INSERT INTO users (name, role) VALUES (?, ?)", ["Alice", "admin"]);
sqlite.exec(db, "INSERT INTO users (name, role) VALUES (?, ?)", ["Bob", "developer"]);
sqlite.exec(db, "INSERT INTO users (name, role) VALUES (?, ?)", ["Charlie", "developer"]);
sqlite.exec(db, "INSERT INTO users (name, role) VALUES (?, ?)", ["Diana", "designer"]);

const users: User[] = sqlite.query<User>(db, "SELECT id, name, role FROM users ORDER BY name");
for (let i = 0; i < users.length; i++) {
  console.log("  " + users[i].id + " | " + users[i].name + " | " + users[i].role);
}

const alice: User = sqlite.getRow<User>(
  db,
  "SELECT id, name, role FROM users WHERE name = ?",
  ["Alice"],
);
console.log("Alice's role: " + alice.role);

const counts: RoleCount[] = sqlite.query<RoleCount>(
  db,
  "SELECT role, COUNT(*) as count FROM users GROUP BY role ORDER BY count DESC",
);
for (let i = 0; i < counts.length; i++) {
  console.log("  " + counts[i].role + ": " + counts[i].count);
}

sqlite.close(db);
