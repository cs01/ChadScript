// @category: cli
// @args: --verbose --output=report.txt -n 3 -xz --tag a --tag b input1.txt -- --not-a-flag
// A getopt-style argument parser: long options with = or a separate value, bundled short
// flags, repeated options, `--` terminator, defaults, and validation with a usage message.
import { writeFileSync } from "node:fs";

type OptionSpec = {
  name: string;
  short?: string;
  kind: "flag" | "string" | "number" | "list";
  default?: string | number | boolean | string[];
  help: string;
};

type ParsedValue = string | number | boolean | string[];

const SPECS: OptionSpec[] = [
  { name: "verbose", short: "v", kind: "flag", help: "print more" },
  { name: "output", short: "o", kind: "string", default: "out.txt", help: "output file" },
  { name: "count", short: "n", kind: "number", default: 1, help: "repeat count" },
  { name: "extract", short: "x", kind: "flag", help: "extract mode" },
  { name: "gzip", short: "z", kind: "flag", help: "compress" },
  { name: "tag", short: "t", kind: "list", default: [], help: "add a tag (repeatable)" },
];

class UsageError extends Error {}

function usage(): string {
  const lines = ["usage: tool [options] <files...>"];
  for (const s of SPECS) {
    const flag = `${s.short ? `-${s.short}, ` : "    "}--${s.name}${s.kind === "flag" ? "" : ` <${s.kind}>`}`;
    lines.push(
      `  ${flag.padEnd(26)}${s.help}${s.default !== undefined ? ` (default: ${JSON.stringify(s.default)})` : ""}`,
    );
  }
  return lines.join("\n");
}

function parse(argv: string[]): { options: Map<string, ParsedValue>; positional: string[] } {
  const options = new Map<string, ParsedValue>();
  for (const s of SPECS) if (s.default !== undefined) options.set(s.name, s.default);
  const positional: string[] = [];

  const assign = (spec: OptionSpec, value: string | undefined): void => {
    switch (spec.kind) {
      case "flag":
        options.set(spec.name, true);
        return;
      case "string":
        if (value === undefined) throw new UsageError(`--${spec.name} needs a value`);
        options.set(spec.name, value);
        return;
      case "number": {
        const n = Number(value);
        if (value === undefined || Number.isNaN(n))
          throw new UsageError(`--${spec.name} needs a number`);
        options.set(spec.name, n);
        return;
      }
      case "list": {
        if (value === undefined) throw new UsageError(`--${spec.name} needs a value`);
        const prev = options.get(spec.name);
        options.set(spec.name, [...(Array.isArray(prev) ? prev : []), value]);
        return;
      }
    }
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split("=", 2) as [string, string | undefined];
      const spec = SPECS.find((s) => s.name === name);
      if (!spec) throw new UsageError(`unknown option --${name}`);
      const value = spec.kind === "flag" ? undefined : (inline ?? argv[++i]);
      assign(spec, value);
    } else if (arg.startsWith("-") && arg.length > 1) {
      const letters = arg.slice(1);
      for (let j = 0; j < letters.length; j++) {
        const spec = SPECS.find((s) => s.short === letters[j]);
        if (!spec) throw new UsageError(`unknown option -${letters[j]}`);
        if (spec.kind === "flag") {
          assign(spec, undefined);
        } else {
          const rest = letters.slice(j + 1);
          assign(spec, rest !== "" ? rest : argv[++i]);
          break;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { options, positional };
}

try {
  const { options, positional } = parse(process.argv.slice(2));
  for (const [k, v] of [...options].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${k.padEnd(8)} = ${JSON.stringify(v)}`);
  }
  console.log(`files: ${positional.join(", ")}`);
  const out = String(options.get("output"));
  const lines: string[] = [];
  for (let i = 0; i < Number(options.get("count")); i++)
    lines.push(`run ${i + 1}: ${positional.join(" ")}`);
  writeFileSync(out, lines.join("\n") + "\n");
  if (options.get("verbose")) console.log(`wrote ${lines.length} lines to ${out}`);
  parse(["--count", "many"]);
} catch (e) {
  if (e instanceof UsageError) {
    console.log(`error: ${e.message}\n${usage()}`);
    process.exit(2);
  }
  throw e;
}
