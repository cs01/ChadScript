// @category: cli
// @args: --set server.port=9090 --set features.beta=true --profile staging
// Layered configuration: built-in defaults, then a JSON config file, then a profile section,
// then --set overrides from the command line, deep-merged, with the effective config written out.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

type ConfigValue = string | number | boolean | ConfigObject;
interface ConfigObject {
  [key: string]: ConfigValue;
}

const defaults: ConfigObject = {
  server: { host: "localhost", port: 8080, workers: 2 },
  logging: { level: "info", json: false },
  features: { beta: false, search: true },
};

function isObject(v: ConfigValue | undefined): v is ConfigObject {
  return typeof v === "object" && v !== null;
}

function deepMerge(base: ConfigObject, override: ConfigObject): ConfigObject {
  const out: ConfigObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key];
    out[key] = isObject(existing) && isObject(value) ? deepMerge(existing, value) : value;
  }
  return out;
}

function parseScalar(raw: string): ConfigValue {
  if (raw === "true" || raw === "false") return raw === "true";
  if (raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

function setPath(obj: ConfigObject, path: string, value: ConfigValue): void {
  const parts = path.split(".");
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    const next = cur[part];
    if (!isObject(next)) cur[part] = {};
    cur = cur[part] as ConfigObject;
  }
  cur[parts[parts.length - 1] as string] = value;
}

function flatten(obj: ConfigObject, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    isObject(v) ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}=${JSON.stringify(v)}`],
  );
}

const args = process.argv.slice(2);
const overrides: ConfigObject = {};
let profile = "development";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--set") {
    const [path, raw] = (args[++i] ?? "").split("=");
    if (!path || raw === undefined) throw new Error(`bad --set argument: ${args[i]}`);
    setPath(overrides, path, parseScalar(raw));
  } else if (args[i] === "--profile") {
    profile = args[++i] ?? profile;
  }
}

const fileConfig: ConfigObject = existsSync("app.config.json")
  ? (JSON.parse(readFileSync("app.config.json", "utf8")) as ConfigObject)
  : {
      logging: { level: "warn" },
      profiles: {
        staging: { server: { host: "staging.internal", workers: 4 } },
        production: { logging: { json: true } },
      },
    };

const profiles = fileConfig["profiles"];
const profileConfig =
  isObject(profiles) && isObject(profiles[profile]) ? (profiles[profile] as ConfigObject) : {};
const { profiles: _ignored, ...base } = fileConfig;
const effective = deepMerge(deepMerge(deepMerge(defaults, base), profileConfig), overrides);

console.log(`profile: ${profile}`);
for (const line of flatten(effective)) console.log(`  ${line}`);
writeFileSync("effective-config.json", JSON.stringify(effective, null, 2) + "\n");
console.log(
  `changed from defaults: ${flatten(effective).filter((l) => !flatten(defaults).includes(l)).length} keys`,
);
