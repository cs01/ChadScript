// @category: simulation
// An elevator controller simulation: requests arrive on a timeline, the car uses the SCAN
// (elevator) algorithm, and the program reports each move plus per-passenger trip times.

type Direction = "up" | "down" | "idle";

interface Request {
  at: number;
  from: number;
  to: number;
  name: string;
}

interface Passenger extends Request {
  pickedUp: number | null;
  droppedOff: number | null;
}

class Elevator {
  floor = 0;
  direction: Direction = "idle";
  readonly riders: Passenger[] = [];
  readonly log: string[] = [];

  constructor(readonly floors: number) {}

  private stopsAbove(waiting: Passenger[]): boolean {
    return this.riders.some((p) => p.to > this.floor) || waiting.some((p) => p.from > this.floor);
  }

  private stopsBelow(waiting: Passenger[]): boolean {
    return this.riders.some((p) => p.to < this.floor) || waiting.some((p) => p.from < this.floor);
  }

  tick(time: number, waiting: Passenger[]): void {
    const leaving = this.riders.filter((p) => p.to === this.floor);
    for (const p of leaving) {
      p.droppedOff = time;
      this.riders.splice(this.riders.indexOf(p), 1);
      this.log.push(`t=${time} floor ${this.floor}: ${p.name} gets off`);
    }
    for (const p of waiting.filter((w) => w.from === this.floor)) {
      p.pickedUp = time;
      waiting.splice(waiting.indexOf(p), 1);
      this.riders.push(p);
      this.log.push(`t=${time} floor ${this.floor}: ${p.name} gets on (to ${p.to})`);
    }
    if (this.direction === "up" && !this.stopsAbove(waiting)) this.direction = "idle";
    if (this.direction === "down" && !this.stopsBelow(waiting)) this.direction = "idle";
    if (this.direction === "idle") {
      if (this.stopsAbove(waiting)) this.direction = "up";
      else if (this.stopsBelow(waiting)) this.direction = "down";
    }
    if (this.direction === "up") this.floor = Math.min(this.floors - 1, this.floor + 1);
    else if (this.direction === "down") this.floor = Math.max(0, this.floor - 1);
  }
}

const requests: Request[] = [
  { at: 0, from: 0, to: 5, name: "Ann" },
  { at: 1, from: 3, to: 1, name: "Ben" },
  { at: 2, from: 4, to: 8, name: "Cat" },
  { at: 6, from: 2, to: 0, name: "Dan" },
  { at: 7, from: 9, to: 0, name: "Eli" },
  { at: 12, from: 0, to: 3, name: "Fay" },
];

const all: Passenger[] = requests.map((r) => ({ ...r, pickedUp: null, droppedOff: null }));
const elevator = new Elevator(10);
const waiting: Passenger[] = [];
let time = 0;
while (time < 100 && all.some((p) => p.droppedOff === null)) {
  for (const p of all) if (p.at === time) waiting.push(p);
  elevator.tick(time, waiting);
  time++;
}
console.log(elevator.log.join("\n"));
for (const p of all) {
  const wait = (p.pickedUp ?? NaN) - p.at;
  const ride = (p.droppedOff ?? NaN) - (p.pickedUp ?? NaN);
  console.log(`${p.name}: waited ${wait}, rode ${ride}, floors ${Math.abs(p.to - p.from)}`);
}
const avg = all.reduce((s, p) => s + ((p.droppedOff ?? 0) - p.at), 0) / all.length;
console.log(`finished at t=${time}, average trip ${avg.toFixed(2)}`);
