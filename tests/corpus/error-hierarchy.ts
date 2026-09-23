// @category: errors
// An HTTP-style error hierarchy: a base AppError with a status code, subclasses for each
// failure, a handler that maps errors to responses with instanceof, and wrapping unknown throws.

class AppError extends Error {
  readonly status: number = 500;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
  toResponse(): { status: number; body: string } {
    return { status: this.status, body: `${this.name}: ${this.message}` };
  }
}

class NotFound extends AppError {
  override readonly status = 404;
}

class ValidationFailed extends AppError {
  override readonly status = 422;
  constructor(readonly fields: string[]) {
    super(`invalid fields: ${fields.join(", ")}`);
  }
}

class Unauthorized extends AppError {
  override readonly status = 401;
}

class RateLimited extends AppError {
  override readonly status = 429;
  constructor(readonly retryAfter: number) {
    super(`retry after ${retryAfter}s`);
  }
}

interface Request {
  path: string;
  user?: string;
  body?: Record<string, string>;
}

const users = new Map([["ada", { name: "Ada", role: "admin" }]]);
const hits = new Map<string, number>();

function route(req: Request): string {
  const count = (hits.get(req.user ?? "anon") ?? 0) + 1;
  hits.set(req.user ?? "anon", count);
  if (count > 3) throw new RateLimited(30);
  if (req.path === "/crash") throw new TypeError("cannot read properties of undefined");
  if (req.path === "/panic") throw "a string, not an Error";
  if (!req.user) throw new Unauthorized("login required");
  if (req.path.startsWith("/users/")) {
    const id = req.path.slice(7);
    const u = users.get(id);
    if (!u) throw new NotFound(`user ${id}`);
    return `${u.name} (${u.role})`;
  }
  if (req.path === "/signup") {
    const missing = ["name", "email"].filter((f) => !req.body?.[f]);
    if (missing.length) throw new ValidationFailed(missing);
    return "created";
  }
  throw new NotFound(req.path);
}

function handle(req: Request): string {
  try {
    return `200 ${route(req)}`;
  } catch (e) {
    const err =
      e instanceof AppError
        ? e
        : new AppError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    const res = err.toResponse();
    const extra =
      err instanceof RateLimited
        ? ` (Retry-After: ${err.retryAfter})`
        : err instanceof ValidationFailed
          ? ` [${err.fields.length}]`
          : "";
    return `${res.status} ${res.body}${extra}`;
  }
}

const requests: Request[] = [
  { path: "/users/ada", user: "ada" },
  { path: "/users/bob", user: "ada" },
  { path: "/users/ada" },
  { path: "/signup", user: "eve", body: { name: "Eve" } },
  { path: "/signup", user: "eve", body: { name: "Eve", email: "e@x" } },
  { path: "/crash", user: "eve" },
  { path: "/panic", user: "zed" },
  { path: "/nowhere", user: "ada" },
  { path: "/users/ada", user: "ada" },
];
for (const r of requests) console.log(`${r.path.padEnd(12)} ${handle(r)}`);
const e = new ValidationFailed(["x"]);
console.log(
  e instanceof ValidationFailed,
  e instanceof AppError,
  e instanceof Error,
  e.name,
  String(e),
);
