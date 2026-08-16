interface Item {
  name: string;
  qty: number;
}
interface Order {
  id: number;
  items: Item[];
  tags: string[];
  note?: string;
  shipped: boolean;
}
const o: Order = JSON.parse(
  '{"id":7,"items":[{"name":"a","qty":2},{"name":"b","qty":3}],"tags":["x","y"],"shipped":false}',
);
console.log(o.id, o.shipped, o.tags.join("|"), o.note);
for (const it of o.items) {
  console.log(it.name, it.qty);
}
const nums: number[] = JSON.parse("[1,2,3]");
console.log(nums.length, nums.join(","));
const withNote: Order = JSON.parse('{"id":8,"items":[],"tags":[],"note":"hello","shipped":true}');
console.log(withNote.note);
