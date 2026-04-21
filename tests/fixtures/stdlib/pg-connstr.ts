import { parseConnectionString } from "chadscript/pg";

function check(label: string, actual: string, expected: string): boolean {
  if (actual !== expected) {
    console.log("FAIL " + label + ": got '" + actual + "' want '" + expected + "'");
    return false;
  }
  return true;
}

function checkN(label: string, actual: number, expected: number): boolean {
  if (actual !== expected) {
    console.log("FAIL " + label + ": got " + actual + " want " + expected);
    return false;
  }
  return true;
}

function main(): void {
  // Full URL
  const o1 = parseConnectionString("postgres://alice:secret@db.example.com:6543/myapp");
  if (!check("o1.host", o1.host, "db.example.com")) return;
  if (!checkN("o1.port", o1.port, 6543)) return;
  if (!check("o1.user", o1.user, "alice")) return;
  if (!check("o1.password", o1.password, "secret")) return;
  if (!check("o1.database", o1.database, "myapp")) return;

  // postgresql:// scheme
  const o2 = parseConnectionString("postgresql://bob@localhost/testdb");
  if (!check("o2.user", o2.user, "bob")) return;
  if (!check("o2.database", o2.database, "testdb")) return;
  if (!check("o2.password", o2.password, "")) return;
  if (!checkN("o2.port", o2.port, 5432)) return;

  // Host only → database stays empty (caller supplies default)
  const o3 = parseConnectionString("postgres://pguser@host1");
  if (!check("o3.host", o3.host, "host1")) return;
  if (!check("o3.user", o3.user, "pguser")) return;
  if (!check("o3.database", o3.database, "")) return;

  // IPv6 host
  const o7 = parseConnectionString("postgres://u@[::1]:5433/d");
  if (!check("o7.host", o7.host, "::1")) return;
  if (!checkN("o7.port", o7.port, 5433)) return;
  if (!check("o7.database", o7.database, "d")) return;

  // Query params override
  const o4 = parseConnectionString("postgres://host2:5433/?user=qu&password=qp&dbname=qdb");
  if (!check("o4.user", o4.user, "qu")) return;
  if (!check("o4.password", o4.password, "qp")) return;
  if (!check("o4.database", o4.database, "qdb")) return;
  if (!checkN("o4.port", o4.port, 5433)) return;

  // Percent-decoding
  const o5 = parseConnectionString("postgres://us%40er:p%3Ass@h/d");
  if (!check("o5.user", o5.user, "us@er")) return;
  if (!check("o5.password", o5.password, "p:ss")) return;

  // Malformed URL throws
  let threw = false;
  try {
    parseConnectionString("notaurl");
  } catch (_e) {
    threw = true;
  }
  if (!threw) {
    console.log("FAIL: expected throw on bad URL");
    return;
  }

  console.log("TEST_PASSED");
}

main();
