// @category: parsing
// Semantic versions: parsing (with prerelease and build metadata), precedence comparison per
// the spec, sorting, bumping, and npm-style range checks (^, ~, >=, <, exact, x-ranges).

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  pre: (string | number)[];
  build: string;
}

class SemVerError extends Error {}

function parse(v: string): SemVer {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(v.trim());
  if (!m) throw new SemVerError(`invalid version: ${v}`);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [],
    build: m[5] ?? "",
  };
}

function format(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}${v.pre.length ? "-" + v.pre.join(".") : ""}`;
}

function compare(a: SemVer, b: SemVer): number {
  for (const k of ["major", "minor", "patch"] as const) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  if (a.pre.length === 0 || b.pre.length === 0) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x < y ? -1 : 1;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function bump(v: SemVer, part: "major" | "minor" | "patch"): SemVer {
  if (part === "major") return { major: v.major + 1, minor: 0, patch: 0, pre: [], build: "" };
  if (part === "minor") return { ...v, minor: v.minor + 1, patch: 0, pre: [], build: "" };
  return { ...v, patch: v.patch + 1, pre: [], build: "" };
}

function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  return range.split(" ").every((clause) => {
    if (clause === "*" || clause === "") return true;
    if (clause.startsWith("^")) {
      const base = parse(clause.slice(1));
      const upper =
        base.major > 0
          ? bump(base, "major")
          : base.minor > 0
            ? bump(base, "minor")
            : bump(base, "patch");
      return compare(v, base) >= 0 && compare(v, upper) < 0;
    }
    if (clause.startsWith("~")) {
      const base = parse(clause.slice(1));
      return compare(v, base) >= 0 && compare(v, bump(base, "minor")) < 0;
    }
    const op = /^(>=|<=|>|<|=)?(.*)$/.exec(clause)!;
    const target = op[2]!.replace(/\.x/g, ".0");
    if (op[2]!.includes("x")) {
      const parts = op[2]!.split(".");
      return parts.every((p, i) => p === "x" || Number(p) === [v.major, v.minor, v.patch][i]);
    }
    const c = compare(v, parse(target));
    switch (op[1]) {
      case ">=":
        return c >= 0;
      case "<=":
        return c <= 0;
      case ">":
        return c > 0;
      case "<":
        return c < 0;
      default:
        return c === 0;
    }
  });
}

const versions = [
  "1.0.0",
  "1.0.0-alpha",
  "1.0.0-alpha.1",
  "1.0.0-beta.2",
  "1.0.0-beta.11",
  "1.0.0-rc.1",
  "0.9.12",
  "1.10.0",
  "1.2.3+build.5",
  "2.0.0-0",
  "v1.2.4",
];
const sorted = versions.map(parse).sort(compare).map(format);
console.log(sorted.join(" < "));
console.log(
  format(bump(parse("1.2.3-beta"), "patch")),
  format(bump(parse("1.2.3"), "minor")),
  format(bump(parse("1.9.9"), "major")),
);
const ranges = ["^1.2.0", "~1.2.0", ">=1.0.0 <2.0.0", "1.x", "^0.2.3", "=1.2.3", "*"];
for (const v of ["1.2.3", "1.3.0", "2.0.0", "0.2.9", "1.0.0-rc.1"]) {
  console.log(
    `${v.padEnd(10)} ${ranges.map((r) => `${r}:${satisfies(v, r) ? "y" : "n"}`).join(" ")}`,
  );
}
for (const bad of ["1.2", "a.b.c", "1.2.3.4"]) {
  try {
    parse(bad);
  } catch (e) {
    console.log(e instanceof SemVerError ? `SemVerError: ${e.message}` : "unexpected");
  }
}
