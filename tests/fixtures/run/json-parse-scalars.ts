interface Point {
  x: number;
  y: number;
  label: string;
  ok: boolean;
}
const p: Point = JSON.parse('{"x":1,"y":2.5,"label":"hi","ok":true}');
console.log(p.x, p.y, p.label, p.ok);
