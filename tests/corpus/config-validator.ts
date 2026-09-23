// @category: errors
// Validates configuration objects against a small schema, collecting every problem with its path,
// then aggregates them into one error. Exits with status 3 when the last config is invalid.

type Schema =
  | { type: "string"; minLength?: number; pattern?: string }
  | { type: "number"; min?: number; max?: number; integer?: boolean }
  | { type: "boolean" }
  | { type: "array"; items: Schema; maxItems?: number }
  | { type: "object"; properties: Record<string, Schema>; required?: string[] };

interface Issue {
  path: string;
  message: string;
}

class ValidationError extends Error {
  constructor(readonly issues: Issue[]) {
    super(
      `${issues.length} validation issue(s):\n` +
        issues.map((i) => `  ${i.path}: ${i.message}`).join("\n"),
    );
    this.name = "ValidationError";
  }
}

function validate(value: unknown, schema: Schema, path = "$", issues: Issue[] = []): Issue[] {
  const fail = (message: string): Issue[] => {
    issues.push({ path, message });
    return issues;
  };
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") return fail(`expected string, got ${typeof value}`);
      if (schema.minLength !== undefined && value.length < schema.minLength)
        fail(`shorter than ${schema.minLength}`);
      if (schema.pattern !== undefined && !value.includes(schema.pattern))
        fail(`must contain "${schema.pattern}"`);
      break;
    case "number":
      if (typeof value !== "number" || Number.isNaN(value))
        return fail(`expected number, got ${JSON.stringify(value)}`);
      if (schema.integer && !Number.isInteger(value)) fail("must be an integer");
      if (schema.min !== undefined && value < schema.min) fail(`must be >= ${schema.min}`);
      if (schema.max !== undefined && value > schema.max) fail(`must be <= ${schema.max}`);
      break;
    case "boolean":
      if (typeof value !== "boolean") fail(`expected boolean, got ${typeof value}`);
      break;
    case "array":
      if (!Array.isArray(value)) return fail("expected array");
      if (schema.maxItems !== undefined && value.length > schema.maxItems)
        fail(`more than ${schema.maxItems} items`);
      value.forEach((v, i) => validate(v, schema.items, `${path}[${i}]`, issues));
      break;
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value))
        return fail("expected object");
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? [])
        if (!(key in obj)) issues.push({ path: `${path}.${key}`, message: "is required" });
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in obj) validate(obj[key], sub, `${path}.${key}`, issues);
      }
      for (const key of Object.keys(obj))
        if (!(key in schema.properties))
          issues.push({ path: `${path}.${key}`, message: "unknown key" });
      break;
    }
  }
  return issues;
}

const serverSchema: Schema = {
  type: "object",
  required: ["host", "port"],
  properties: {
    host: { type: "string", minLength: 1 },
    port: { type: "number", min: 1, max: 65535, integer: true },
    secure: { type: "boolean" },
    admins: { type: "array", items: { type: "string", pattern: "@" }, maxItems: 3 },
    limits: {
      type: "object",
      properties: { rps: { type: "number", min: 0 }, burst: { type: "number", integer: true } },
    },
  },
};

const configs: unknown[] = [
  { host: "example.com", port: 443, secure: true, admins: ["root@example.com"] },
  {
    host: "",
    port: 70000.5,
    admins: ["bob", "amy@x", "c@d", "e@f"],
    limits: { rps: -1, burst: 2.5 },
  },
  JSON.parse('{"port": "80", "debug": true, "limits": []}'),
];

let lastOk = true;
for (const [i, cfg] of configs.entries()) {
  try {
    const issues = validate(cfg, serverSchema);
    if (issues.length > 0) throw new ValidationError(issues);
    console.log(`config ${i}: valid`);
    lastOk = true;
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    console.log(`config ${i}: ${e.message}`);
    lastOk = false;
  }
}
if (!lastOk) process.exit(3);
