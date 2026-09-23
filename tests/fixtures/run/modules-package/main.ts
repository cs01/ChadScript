// A bare specifier that tsc resolves to TypeScript SOURCE under node_modules is compiled like user
// code, whole-program. The package declares a class and a helper with the same names as this
// module's, which per-module scoping keeps apart.
import greet, { Greeter as PkgGreeter, helper as pkgHelper } from "greet-pkg";

class Greeter {
  hi(): string {
    return "local greeter";
  }
}

function helper(): string {
  return "local helper";
}

console.log(greet("world"));
console.log(new Greeter().hi(), new PkgGreeter("pkg").hi());
console.log(helper(), pkgHelper());
