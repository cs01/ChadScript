# sqlite

SQLite database operations via `libsqlite3`. The `db` handle is an opaque pointer returned by `open()`.

## `sqlite.open(path)`

Open a database file. Use `":memory:"` for an in-memory database.

```typescript
const db = sqlite.open("myapp.db");
const memdb = sqlite.open(":memory:");
```

## `sqlite.exec(db, sql, params?)`

Execute DDL or DML statements (CREATE, INSERT, UPDATE, DELETE). Use `?` placeholders and pass values as a third argument to avoid SQL injection.

```typescript
sqlite.exec(db, "CREATE TABLE users (id INTEGER, name TEXT, age INTEGER)");
sqlite.exec(db, "INSERT INTO users VALUES (?, ?, ?)", [1, "Alice", 30]);
```

## `sqlite.get(db, sql, params?)`

Execute a query and return the first row as a string. Single-column results return the value directly; multi-column results are pipe-separated. For typed multi-column access, prefer `sqlite.getRow()`.

```typescript
const name = sqlite.get(db, "SELECT name FROM users WHERE id = ?", [1]);
// "Alice"
```

## `sqlite.getRow(db, sql, params?)`

Execute a query and return the first row as a typed object, or `null` if no row matches. The row type comes from the variable's type annotation — fields map to columns by position.

```typescript
interface User {
  id: string;
  name: string;
  age: string;
}

const user: User | null = sqlite.getRow(db, "SELECT id, name, age FROM users WHERE id = ?", [1]);
if (user !== null) {
  console.log(user.name); // "Alice"
}
```

## `sqlite.all(db, sql, params?)`

Execute a query and return all rows as a string array. Single-column results return values directly. For typed multi-column access, prefer `sqlite.query()`.

```typescript
const names = sqlite.all(db, "SELECT name FROM users WHERE age > ?", [25]);
// ["Alice", "Charlie"]
```

## `sqlite.query(db, sql, params?)`

Execute a query and return all rows as a typed object array. The row type comes from the variable's type annotation — fields map to columns by position. This is the recommended API for multi-column queries.

```typescript
interface User {
  id: string;
  name: string;
  age: string;
}

const users: User[] = sqlite.query(db, "SELECT id, name, age FROM users ORDER BY id");
for (const user of users) {
  console.log(user.name + " age " + user.age);
}

// With parameters:
const adults: User[] = sqlite.query(
  db,
  "SELECT id, name, age FROM users WHERE age >= ?",
  ["18"]
);
```

## `sqlite.close(db)`

Close the database connection.

```typescript
sqlite.close(db);
```

## Example

```typescript
const db = sqlite.open(":memory:");
sqlite.exec(db, "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)");
sqlite.exec(db, "INSERT INTO users (name, age) VALUES (?, ?)", ["Alice", 30]);
sqlite.exec(db, "INSERT INTO users (name, age) VALUES (?, ?)", ["Bob", 25]);

interface User {
  id: string;
  name: string;
  age: string;
}

const users: User[] = sqlite.query(db, "SELECT id, name, age FROM users ORDER BY name");
console.log(users.length); // 2
console.log(users[0].name); // "Alice"

const alice: User | null = sqlite.getRow(db, "SELECT id, name, age FROM users WHERE name = ?", ["Alice"]);
if (alice !== null) {
  console.log(alice.age); // "30"
}

sqlite.close(db);
```

## Parameterized Queries

Always use `?` placeholders with a params array instead of string interpolation. This prevents SQL injection and is the only safe approach when handling user input.

```typescript
// safe
const row = sqlite.getRow(db, "SELECT * FROM users WHERE name = ?", [userInput]);

// unsafe — never do this with user input
const row2 = sqlite.get(db, "SELECT * FROM users WHERE name = '" + userInput + "'");
```

## Native Implementation

| API | Maps to |
|-----|---------|
| `sqlite.open()` | `sqlite3_open()` |
| `sqlite.exec()` | `sqlite3_prepare_v2()` + `sqlite3_bind_text()` + `sqlite3_step()` |
| `sqlite.get()` | `sqlite3_prepare_v2()` + `sqlite3_step()` |
| `sqlite.getRow()` | `sqlite3_prepare_v2()` + `sqlite3_step()` → field struct |
| `sqlite.all()` | `sqlite3_prepare_v2()` + `sqlite3_step()` loop |
| `sqlite.query()` | `sqlite3_prepare_v2()` + `sqlite3_step()` loop → field structs |
| `sqlite.close()` | `sqlite3_close()` |
