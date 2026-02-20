// Test property access on object literal (not just variables)
function testLiteralAccess() {
  return { x: 10, y: 20 }.x;
}

process.exit(testLiteralAccess());
