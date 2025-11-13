// Regression test: Bitwise operations with doubles should convert to i64
// Tests fptosi double to i64 for bitwise ops

function test() {
  const a = 12.7;  // Should truncate to 12
  const b = 10.3;  // Should truncate to 10

  // Bitwise AND requires conversion to integers
  const result = a & b;  // 12 & 10 = 8 (in binary: 1100 & 1010 = 1000)

  return result;
}

process.exit(test());  // Should exit with 8
