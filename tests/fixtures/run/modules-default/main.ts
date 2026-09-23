// Default exports of every declaration kind, combined and renamed imports, and export aliases.
import helper from "./helper";
import Counter from "./counter";
import LIMIT from "./limit";
import greet, { PREFIX as P, suffix } from "./greet";
import { renamed, alsoTwo } from "./aliases";
import sameLimit from "./forward";

console.log(helper(3));
const c = new Counter(3);
c.bump();
console.log(c.n, c instanceof Counter);
console.log(LIMIT * 2, sameLimit);
console.log(greet("bob"), P, suffix);
console.log(renamed(5), alsoTwo);
