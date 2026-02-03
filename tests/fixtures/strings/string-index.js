function getChar() {
  const str = "ABC";
  return str.charCodeAt(1); // Should return 66 (ASCII code for 'B')
}

process.exit(getChar());
