// @category: oop
// A strongly typed event emitter (event name -> payload type map), with on/off/once, listener
// counts, and an order-processing workflow built on top of it.

type Listener<T> = (payload: T) => void;

class TypedEmitter<Events extends Record<string, unknown>> {
  private listeners: { [K in keyof Events]?: Listener<Events[K]>[] } = {};

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    (this.listeners[event] ??= []).push(fn);
    return () => this.off(event, fn);
  }

  once<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    const wrapper: Listener<Events[K]> = (payload) => {
      this.off(event, wrapper);
      fn(payload);
    };
    this.on(event, wrapper);
  }

  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    const list = this.listeners[event];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): number {
    const list = [...(this.listeners[event] ?? [])];
    for (const fn of list) fn(payload);
    return list.length;
  }

  listenerCount(event: keyof Events): number {
    return this.listeners[event]?.length ?? 0;
  }
}

interface OrderEvents extends Record<string, unknown> {
  created: { id: number; total: number };
  paid: { id: number; method: "card" | "cash" };
  shipped: { id: number; carrier: string };
  error: Error;
}

class OrderService extends TypedEmitter<OrderEvents> {
  private nextId = 100;
  create(total: number): number {
    const id = this.nextId++;
    if (total <= 0) {
      this.emit("error", new Error(`order ${id} has invalid total ${total}`));
      return -1;
    }
    this.emit("created", { id, total });
    return id;
  }
}

const svc = new OrderService();
const audit: string[] = [];
svc.on("created", (o) => audit.push(`created #${o.id} $${o.total}`));
svc.on("paid", (p) => audit.push(`paid #${p.id} by ${p.method}`));
const stopShipping = svc.on("shipped", (s) => audit.push(`shipped #${s.id} via ${s.carrier}`));
svc.once("created", (o) => audit.push(`first order ever: #${o.id}`));
svc.on("error", (e) => audit.push(`ERROR ${e.message}`));

const a = svc.create(25);
const b = svc.create(0);
const c = svc.create(99.5);
svc.emit("paid", { id: a, method: "card" });
svc.emit("shipped", { id: a, carrier: "UPS" });
stopShipping();
const delivered = svc.emit("shipped", { id: c, carrier: "FedEx" });
console.log(audit.join("\n"));
console.log(`ids: ${a} ${b} ${c}, shipped listeners notified after off: ${delivered}`);
console.log(
  `listeners: created=${svc.listenerCount("created")} shipped=${svc.listenerCount("shipped")}`,
);
