class Vehicle {
  name: string;
  speed: number;
  constructor(name: string, speed: number) {
    this.name = name;
    this.speed = speed;
  }
  describe(): string {
    return this.name;
  }
}

class Car extends Vehicle {
  doors: number;
  constructor(name: string, speed: number, doors: number) {
    super(name, speed);
    this.doors = doors;
  }
}

const car = new Car("Sedan", 120, 4);
if (car.name === "Sedan" && car.speed === 120 && car.doors === 4) {
  console.log("TEST_PASSED");
} else {
  console.log(
    "FAILED: name=" +
      car.name +
      " speed=" +
      car.speed.toString() +
      " doors=" +
      car.doors.toString(),
  );
}
