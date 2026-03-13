function testMapDeleteReinsert(): void {
  const m = new Map<number, number>();
  m.set(1, 100);
  m.set(2, 200);
  m.set(3, 300);
  if (m.size !== 3) process.exit(1);
  m.delete(2);
  if (m.size !== 2) process.exit(1);
  if (!m.has(1)) process.exit(1);
  if (!m.has(3)) process.exit(1);
  const v3 = m.get(3);
  if (v3 !== 300) process.exit(1);
  m.set(2, 999);
  if (m.size !== 3) process.exit(1);
  const v2new = m.get(2);
  if (v2new !== 999) process.exit(1);
  console.log("TEST_PASSED");
}
testMapDeleteReinsert();
