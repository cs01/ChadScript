// @category: errors
// Exception control flow people rely on: finally ordering, finally overriding a return, rethrow
// with a cause, nested try blocks, errors thrown from callbacks, and resource cleanup helpers.

const trace: string[] = [];

function withResource<T>(name: string, body: (log: (msg: string) => void) => T): T {
  trace.push(`open ${name}`);
  try {
    return body((msg) => trace.push(`${name}: ${msg}`));
  } finally {
    trace.push(`close ${name}`);
  }
}

function finallyWins(): string {
  try {
    return "from try";
  } finally {
    trace.push("finally ran before the return completed");
  }
}

function countdown(n: number): number {
  let steps = 0;
  for (let i = n; ; i--) {
    try {
      if (i === 0) break;
      if (i % 2 === 0) continue;
      steps++;
    } finally {
      steps += 10;
    }
  }
  return steps;
}

class ParseError extends Error {
  override name = "ParseError";
}

function parsePort(s: string): number {
  try {
    const n = Number(s);
    if (!Number.isInteger(n)) throw new TypeError(`not an integer: ${s}`);
    if (n < 1 || n > 65535) throw new RangeError(`out of range: ${n}`);
    return n;
  } catch (e) {
    throw new ParseError(`invalid port "${s}"`, { cause: e });
  }
}

const r = withResource("db", (log) => {
  log("query 1");
  withResource("cache", (log2) => log2("warm"));
  return 42;
});
trace.push(`result ${r}`);

try {
  withResource("file", (log) => {
    log("write header");
    throw new Error("disk full");
  });
} catch (e) {
  trace.push(`caught: ${(e as Error).message}`);
}

trace.push(finallyWins());
trace.push(`countdown steps: ${countdown(5)}`);
console.log(trace.join("\n"));

for (const s of ["8080", "http", "70000", "22.5"]) {
  try {
    console.log(`port ${parsePort(s)}`);
  } catch (e) {
    const err = e as ParseError;
    const cause = err.cause as Error;
    console.log(`${err.name}: ${err.message} <- ${cause.name}: ${cause.message}`);
  }
}

const results = [1, 2, 3, 4].map((n) => {
  try {
    if (n === 3) throw new Error(`bad item ${n}`);
    return `ok ${n}`;
  } catch (e) {
    return `recovered from ${(e as Error).message}`;
  }
});
console.log(results);

let attempts = 0;
outer: for (const group of [["a", "b"], ["c", "boom", "d"], ["e"]]) {
  for (const item of group) {
    try {
      attempts++;
      if (item === "boom") throw new Error(item);
    } catch {
      console.log(`skipping rest of group after ${item}`);
      continue outer;
    }
    console.log(`processed ${item}`);
  }
}
console.log(`attempts: ${attempts}`);
