// @expect-reject: CS1227
// Two classes named `Point` would generate one set of `Point.*` symbols and share a vtable.
import { makePoint } from "./other.ts";

class Point {
  z: number;
  constructor(z: number) {
    this.z = z;
  }
}

console.log(new Point(1).z, makePoint(2).x);
