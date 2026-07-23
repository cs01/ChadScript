// JSON.stringify optional-field rules: an `undefined` value omits the key, `null` emits null, a
// present value emits normally. Comma placement is decided at runtime as fields are (or aren't) written.
interface Config {
  name: string;
  port?: number;
  host?: string;
  fallback: string | null;
}
const full: Config = { name: "a", port: 8080, host: "localhost", fallback: "x" };
const minimal: Config = { name: "b", fallback: null };
const partial: Config = { name: "c", host: "h", fallback: null };
console.log(JSON.stringify(full));
console.log(JSON.stringify(minimal));
console.log(JSON.stringify(partial));
// nested object with optional fields
interface Wrap {
  inner: Config;
}
const w: Wrap = { inner: { name: "d", fallback: null } };
console.log(JSON.stringify(w));
