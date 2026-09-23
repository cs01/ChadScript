// JSON.parse into targets whose fields are Value unions: the JSON value's own kind picks the member.
interface Row {
  id: number | string;
  val: boolean | number[] | null;
  note?: string | number;
}
const rows: Row[] = JSON.parse(
  '[{"id":1,"val":true},{"id":"x","val":[1,2],"note":7},{"val":null,"id":2,"note":"n"}]',
);
for (const r of rows) {
  console.log(r, typeof r.id, r.note ?? "-");
}
console.log(JSON.stringify(rows));
const top: number | string = JSON.parse('"just a string"');
console.log(top, typeof top);
