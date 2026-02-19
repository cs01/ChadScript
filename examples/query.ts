const db = sqlite.open("app.db");
sqlite.exec(db, "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)");
sqlite.exec(db, "INSERT INTO users (name) VALUES ('Alice')");
const rows = sqlite.all(db, "SELECT * FROM users");
console.log(rows.length + " rows");
for (let i = 0; i < rows.length; i++) {
  console.log(rows[i]);
}
sqlite.close(db);
