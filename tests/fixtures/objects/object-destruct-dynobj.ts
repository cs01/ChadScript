function getPos(offset: number): { line: number; col: number } {
  return { line: offset + 1, col: offset * 2 };
}

const { line, col } = getPos(5);
console.log(line);
console.log(col);

function getInfo(): { name: string; active: boolean } {
  return { name: "test", active: true };
}

const { name, active } = getInfo();
console.log(name);
console.log(active);
