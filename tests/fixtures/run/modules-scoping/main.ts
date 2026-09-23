// Two modules each declare a top-level `class Point`, `function helper` and `const label`. Every
// top-level symbol is namespaced by its module, so they never collide: methods, vtables,
// instanceof and printing all see the right class.
import { makePoint, helper as otherHelper, label as otherLabel, isOtherPoint } from "./other";

class Point {
  z: number;
  constructor(z: number) {
    this.z = z;
  }
  describe(): string {
    return `main point ${this.z}`;
  }
}

function helper(): string {
  return "main helper";
}

const label = "main";

const mine = new Point(1);
const theirs = makePoint(2);
console.log(mine.z, theirs.x);
console.log(mine.describe(), theirs.describe());
console.log(helper(), otherHelper(), label, otherLabel);
console.log(mine instanceof Point, isOtherPoint(theirs));
console.log(mine);
console.log(theirs);
