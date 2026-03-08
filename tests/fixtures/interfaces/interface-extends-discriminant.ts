interface Typed {
  type: 'cat';
  name: string;
}

interface Cat extends Typed {
  lives: number;
}

const c: Cat = { type: 'cat', name: "Whiskers", lives: 9 };

let result = "unknown";
if (c.type === 'cat') {
  result = c.name + ":" + c.lives;
}

if (result === "Whiskers:9") {
  console.log("TEST_PASSED");
}
