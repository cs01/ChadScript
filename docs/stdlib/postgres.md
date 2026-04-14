# postgres

PostgreSQL client via `libpq`. Connect to a Postgres database, run queries, and read results as native strings. Imported as a module:

```typescript
import { Pool } from "chadscript/postgres";
```

`libpq` is required at build time. On macOS: `brew install libpq`. On Debian/Ubuntu: `apt install libpq-dev`.

## `new Pool(conninfo)`

Create a connection pool. The connection string follows [libpq's format](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING) — either key/value pairs or a URI.

```typescript
const pool = new Pool("host=127.0.0.1 port=5432 user=postgres password=secret dbname=mydb");
// or
const pool2 = new Pool("postgresql://postgres:secret@127.0.0.1:5432/mydb");
```

`Pool` is the recommended entry point for application code. It connects lazily on first query — the constructor does not block.

## `pool.query(sql)`

Execute a SQL statement and return a [`QueryResult`](#queryresult). Throws on SQL errors. Parameterized queries are coming in a follow-up; for now, build the SQL string yourself — **escape any user input** or you will ship an SQL injection.

```typescript
pool.query("CREATE TABLE users (id INT, name TEXT)");
pool.query("INSERT INTO users VALUES (1, 'alice')");

const res = pool.query("SELECT id, name FROM users ORDER BY id");
console.log(res.rowCount);            // 1
console.log(res.getValue(0, "name")); // "alice"
```

## `pool.end()`

Close the pool's underlying connection. Safe to call multiple times.

```typescript
pool.end();
```

## `Client` (low-level)

For cases where you need explicit connection lifecycle, use `Client` directly:

```typescript
import { Client } from "chadscript/postgres";

const c = new Client("postgresql://postgres:secret@127.0.0.1:5432/mydb");
c.connect();
const res = c.query("SELECT 1");
c.end();
```

Most application code should prefer `Pool`. `Client` requires you to call `connect()` before any queries — `Pool` handles this automatically.

## `QueryResult`

Returned by `client.query()`. All values are currently strings — type coercion (integer, boolean, date) is a follow-up.

| Field | Type | Description |
|-------|------|-------------|
| `rowCount` | `number` | Affected rows (INSERT/UPDATE/DELETE) or number of rows returned (SELECT) |
| `numRows` | `number` | Number of rows in the result set (SELECT) |
| `numCols` | `number` | Number of columns in the result set |
| `fields` | `string[]` | Column names in order |

### `result.getValue(row, col)`

Return the value at a given row index and column name, as a string.

```typescript
const res = c.query("SELECT id, name, city FROM users ORDER BY id");
for (let i = 0; i < res.numRows; i++) {
  const name = res.getValue(i, "name");
  const city = res.getValue(i, "city");
  console.log(name + " in " + city);
}
```

Column lookup by name is linear in the number of columns. If you're reading millions of rows in a tight loop, cache the column index:

```typescript
const nameIdx = res.fields.indexOf("name");
for (let i = 0; i < res.numRows; i++) {
  const r = res.getRow(i);
  console.log(r.getAt(nameIdx));
}
```

### `result.getRow(index)`

Return a lightweight `Row` view into the result set. The returned `Row` holds a reference to the parent result's data — it does not copy.

```typescript
const r = res.getRow(0);
const name = r.get("name");    // by column name
const first = r.getAt(0);      // by column index
```

## Example — CRUD

```typescript
import { Pool } from "chadscript/postgres";

const pool = new Pool("postgresql://postgres:secret@127.0.0.1:5432/mydb");

pool.query("DROP TABLE IF EXISTS users");
pool.query("CREATE TABLE users (id INT, name TEXT, city TEXT)");

pool.query("INSERT INTO users VALUES (1, 'alice', 'nyc'), (2, 'bob', 'sf')");

const res = pool.query("SELECT id, name, city FROM users ORDER BY id");
console.log("rows: " + res.numRows);
for (let i = 0; i < res.numRows; i++) {
  console.log(res.getValue(i, "id") + " " + res.getValue(i, "name") + " " + res.getValue(i, "city"));
}

const upd = pool.query("UPDATE users SET city = 'LA' WHERE id = 1");
console.log("updated " + upd.rowCount);

pool.end();
```

## Current Limitations

This module is under active development. Known gaps:

- **No parameterized queries yet** — every query is literal SQL. Build strings carefully and never concatenate user input. Coming soon.
- **All values are strings** — integers come back as `"42"`, booleans as `"t"`/`"f"`, dates as ISO-ish strings. Type coercion is a follow-up.
- **`Pool` is a thin wrapper over a single `Client`** — no real connection reuse yet. Calls are sequential. Real pooling (multiple connections, queuing, limits) needs async, which is a follow-up.
- **Synchronous under the hood** — `libpq` is called synchronously. Calls block the event loop. Real async (libuv integration) is a follow-up.
- **No `LISTEN`/`NOTIFY`, no `COPY`, no streaming** — the basics only.

## Native Implementation

| API | Maps to |
|-----|---------|
| `new Client()` / `connect()` | `PQconnectdb()` + `PQstatus()` |
| `client.query()` | `PQexec()` + `PQresultStatus()` + `PQgetvalue()` loop |
| `QueryResult.fields` | `PQfname()` per column |
| `QueryResult.numRows` / `numCols` | `PQntuples()` / `PQnfields()` |
| `client.end()` | `PQfinish()` |

All string values returned from `libpq` are copied into GC-managed memory before the underlying `PGresult` is cleared, so values remain valid after the next query.
