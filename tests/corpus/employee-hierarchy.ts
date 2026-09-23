// @category: oop
// An org chart: Employee and Manager classes (manager has reports), an interface for payable
// things, recursive traversals for headcount and payroll, and a printed tree.

interface Payable {
  monthlyCost(): number;
}

class Employee implements Payable {
  constructor(
    public name: string,
    public title: string,
    public salary: number,
  ) {}

  monthlyCost(): number {
    return this.salary / 12;
  }

  headcount(): number {
    return 1;
  }

  describe(indent: string): string[] {
    return [`${indent}${this.name} (${this.title})`];
  }

  raise(pct: number): void {
    this.salary = Math.round(this.salary * (1 + pct / 100));
  }
}

class Manager extends Employee {
  reports: Employee[] = [];

  constructor(
    name: string,
    title: string,
    salary: number,
    public bonus: number,
  ) {
    super(name, title, salary);
  }

  add(...people: Employee[]): Manager {
    this.reports.push(...people);
    return this;
  }

  override monthlyCost(): number {
    let total = super.monthlyCost() + this.bonus / 12;
    for (const r of this.reports) total += r.monthlyCost();
    return total;
  }

  override headcount(): number {
    return 1 + this.reports.reduce((n, r) => n + r.headcount(), 0);
  }

  override describe(indent: string): string[] {
    const lines = [`${indent}${this.name} (${this.title}, ${this.reports.length} direct)`];
    for (const r of this.reports) lines.push(...r.describe(indent + "  "));
    return lines;
  }

  override raise(pct: number): void {
    super.raise(pct);
    for (const r of this.reports) r.raise(pct);
  }

  find(name: string): Employee | undefined {
    for (const r of this.reports) {
      if (r.name === name) return r;
      if (r instanceof Manager) {
        const hit = r.find(name);
        if (hit) return hit;
      }
    }
    return undefined;
  }
}

class Contractor implements Payable {
  constructor(
    public name: string,
    public hourly: number,
    public hours: number,
  ) {}
  monthlyCost(): number {
    return this.hourly * this.hours;
  }
}

const ceo = new Manager("Grace", "CEO", 250000, 50000);
const cto = new Manager("Linus", "CTO", 200000, 30000);
const eng = new Manager("Ada", "Eng Manager", 160000, 10000);
eng.add(new Employee("Ken", "Engineer", 130000), new Employee("Barbara", "Engineer", 135000));
cto.add(eng, new Employee("Margaret", "Architect", 170000));
ceo.add(cto, new Employee("Joan", "CFO", 190000));

console.log(ceo.describe("").join("\n"));
console.log(`headcount: ${ceo.headcount()}`);
const payables: Payable[] = [ceo, new Contractor("Dennis", 120, 80)];
const monthly = payables.reduce((s, p) => s + p.monthlyCost(), 0);
console.log(`monthly cost: ${Math.round(monthly)}`);
cto.raise(10);
console.log(`after 10% raise for CTO org: ${Math.round(ceo.monthlyCost())}`);
const ken = ceo.find("Ken");
console.log(
  ken ? `${ken.name} earns ${ken.salary}` : "not found",
  ceo.find("Nobody") === undefined,
);
console.log([ceo, cto, eng, ken].map((e) => (e instanceof Manager ? "M" : "E")).join(""));
