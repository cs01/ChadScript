// JSON.parse objects take their key order (and which optional keys exist) from the JSON text, so
// one static type reaches records of many layouts; every read must still find the right field.
// (Field names are short so Node prints each object on one line.)
interface Inner {
  f: boolean;
  l?: string;
}
interface Rec {
  id: number;
  nm: string;
  in: Inner;
  tg: string[];
  nt?: string;
  sc: number | null;
  ex?: number | null;
}

function describe(r: Rec): string {
  const l = r.in.l ?? "-";
  return `${r.id}:${r.nm}:${r.in.f}:${l}:${r.tg.join("|")}:${r.nt ?? "none"}:${r.sc}:${r.ex}`;
}

const texts: string[] = [
  '{"id":1,"nm":"a","in":{"f":true},"tg":[],"sc":1}',
  '{"sc":null,"tg":["x"],"in":{"l":"L","f":false},"nm":"b","id":2}',
  '{"id":3,"nm":"c","sc":3,"in":{"f":true,"l":"M"},"tg":[],"ex":null}',
  '{"id":4,"id":44,"nm":"d","in":{"f":false},"tg":[],"sc":0,"ex":7,"nm":"dd"}',
  '{ "tg" : [ ] , "in" : { "f" : true } , "sc" : 2 , "nm" : "e" , "id" : 5, "nt": "q" }',
];
const recs: Rec[] = [];
for (const t of texts) {
  const r: Rec = JSON.parse(t);
  recs.push(r);
  console.log(r);
  console.log(JSON.stringify(r));
  console.log(Object.keys(r).join(","), Object.keys(r.in).join(","));
  console.log(describe(r));
}

// A literal of the same type reaches the same reads.
const lit: Rec = { id: 9, nm: "lit", in: { f: true }, tg: ["t"], sc: 5 };
recs.push(lit);
for (const r of recs) {
  const { id, nm } = r;
  console.log(id, nm, describe(r));
}

// Writes to fields every layout has go through the same caches.
for (const r of recs) {
  r.sc = (r.sc ?? 0) + 1;
  r.in.f = !r.in.f;
}
console.log(recs.map((r) => `${r.sc}/${r.in.f}`).join(" "));
const second = recs[1];
if (second !== undefined) console.log(JSON.stringify(second, null, 2));

const list: Inner[] = JSON.parse('[{"f":true},{"l":"q","f":false},{"f":true,"l":"r"}]');
console.log(list);
console.log(list.map((i) => i.l ?? "?").join(","));
