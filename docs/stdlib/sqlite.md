# sqlite

SQLite database operations via `libsqlite3`. The `db` handle is an opaque pointer returned by `open()`.

## `sqlite.open(path)`

Open a database file. Use `":memory:"` for an in-memory database.

```typescript
const db = sqlite.open("myapp.db");
const memdb = sqlite.open(":memory:");
```

## `sqlite.exec(db, sql)`

Execute DDL or DML statements (CREATE, INSERT, UPDATE, DELETE).

```typescript
sqlite.exec(db, "CREATE TABLE users (id INTEGER, name TEXT)");
sqlite.exec(db, "INSERT INTO users VALUES (1, 'Alice')");
```

## `sqlite.get(db, sql)`

Execute a query and return the first row as a string. Multi-column results are pipe-separated.

```typescript
const name = sqlite.get(db, "SELECT name FROM users WHERE id = 1");
// "Alice"

const row = sqlite.get(db, "SELECT id, name FROM users WHERE id = 1");
// "1|Alice"
```

## `sqlite.all(db, sql)`

Execute a query and return all rows as a string array. Multi-column results are pipe-separated.

```typescript
const names = sqlite.all(db, "SELECT name FROM users ORDER BY id");
// ["Alice", "Bob"]

const rows = sqlite.all(db, "SELECT id, name FROM users ORDER BY id");
// ["1|Alice", "2|Bob"]
const parts = rows[0].split('|');
// parts[0] = "1", parts[1] = "Alice"
```

## `sqlite.close(db)`

Close the database connection.

```typescript
sqlite.close(db);
```

## Example

```typescript
const db = sqlite.open(":memory:");
sqlite.exec(db, "CREATE TABLE users (id INTEGER, name TEXT)");
sqlite.exec(db, "INSERT INTO users VALUES (1, 'Alice')");
sqlite.exec(db, "INSERT INTO users VALUES (2, 'Bob')");

const name = sqlite.get(db, "SELECT name FROM users WHERE id = 1");
console.log(name);    // "Alice"

const names = sqlite.all(db, "SELECT name FROM users ORDER BY id");
console.log(names.length);    // 2

sqlite.close(db);
```

::: tip
Multi-column queries return pipe-separated values. Use `.split('|')` to access individual columns.
:::

## Native Implementation

| API | Maps to |
|-----|---------|
| `sqlite.open()` | `sqlite3_open()` |
| `sqlite.exec()` | `sqlite3_exec()` |
| `sqlite.get()` | `sqlite3_prepare_v2()` + `sqlite3_step()` |
| `sqlite.all()` | `sqlite3_prepare_v2()` + `sqlite3_step()` loop |
| `sqlite.close()` | `sqlite3_close()` |
