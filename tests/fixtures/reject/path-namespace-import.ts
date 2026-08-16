// @expect-reject: CS1226
// A namespace import needs a module object at runtime. `node:path` is no exception — the
// specifier being allowlisted does not admit every import FORM.
import * as path from "node:path";

console.log(path.join("a", "b"));
