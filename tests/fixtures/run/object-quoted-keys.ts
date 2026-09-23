// Quoted field names in object literals: printed quoted unless they are identifiers, serialized with
// JSON escaping, and usable through an interface that declares them.
interface Headers {
  "content-type": string;
  "x-count": number;
  plain: boolean;
}
const h: Headers = { "content-type": "text/plain", "x-count": 2, plain: true };
console.log(h);
console.log(JSON.stringify(h));
console.log(h["content-type"], h.plain);
const odd = { $dollar: 1, "a b": 2, "": 3, "it's": 4, 'q"q': 5, "back\\slash": 6, _ok: 7, "1x": 8 };
console.log(odd);
console.log(JSON.stringify(odd));
console.log(Object.keys(odd));
const fns = { "do-it": (n: number) => n + 1 };
const doIt = fns["do-it"];
console.log(fns, doIt(1));
