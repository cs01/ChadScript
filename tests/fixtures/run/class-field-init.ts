// Class field initializers (`x = expr`): run at construction. Covers a synthesized constructor
// (no explicit ctor), an explicit ctor that also has inits, and inheritance ordering (base field
// inits run via super() before the derived ctor body).
class Point {
  x = 1;
  y: number = 2;
  label: string = "p";
  tags: string[] = [];
  active = true;
}
const p = new Point(); // synthesized ctor runs all inits
console.log(p.x, p.y, p.label, p.active); // 1 2 p true
p.tags.push("a");
console.log(p.tags.length); // 1

class Base {
  kind: string = "base";
  n = 10;
}
class Derived extends Base {
  extra = "d";
  constructor(bump: number) {
    super(); // base field inits (kind, n) run here
    this.n = this.n + bump; // reads base-initialized n (10)
  }
}
const d = new Derived(5);
console.log(d.kind, d.n, d.extra); // base 15 d
