interface Row {
  id: number;
  label: string;
}
const rows: Row[] = [];
rows.push({ id: 1, label: "one" });
rows.push({ id: 2, label: "two" });
for (const r of rows) {
  console.log(r.id, r.label);
}
