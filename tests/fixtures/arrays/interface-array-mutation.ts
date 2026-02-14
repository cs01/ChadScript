interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function makeBody(x: number, y: number, vx: number, vy: number): Body {
  return { x: x, y: y, vx: vx, vy: vy };
}

const bodies: Body[] = [
  makeBody(1.0, 2.0, 0.1, 0.2),
  makeBody(3.0, 4.0, 0.3, 0.4)
];

bodies[0].vx = 9.9;
bodies[1].vy = 8.8;

let i = 0;
while (i < 2) {
  bodies[i].x = bodies[i].x + bodies[i].vx;
  bodies[i].y = bodies[i].y + bodies[i].vy;
  i = i + 1;
}

const ok1 = bodies[0].x === 10.9;
const ok2 = bodies[0].vx === 9.9;
const ok3 = bodies[1].vy === 8.8;
const ok4 = bodies[1].y === 12.8;

if (ok1 && ok2 && ok3 && ok4) {
  console.log("TEST_PASSED");
}
