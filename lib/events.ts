export class EventEmitter {
  private names: string[];
  private callbacks: Array<(data: string) => void>;
  private onceFlags: boolean[];

  constructor() {
    this.names = [];
    this.callbacks = [];
    this.onceFlags = [];
  }

  on(name: string, callback: (data: string) => void): void {
    this.names.push(name);
    this.callbacks.push(callback);
    this.onceFlags.push(false);
  }

  once(name: string, callback: (data: string) => void): void {
    this.names.push(name);
    this.callbacks.push(callback);
    this.onceFlags.push(true);
  }

  off(name: string, callback: (data: string) => void): void {
    const newNames: string[] = [];
    const newCbs: Array<(data: string) => void> = [];
    const newFlags: boolean[] = [];
    for (let i = 0; i < this.names.length; i++) {
      if (this.names[i] !== name || this.callbacks[i] !== callback) {
        newNames.push(this.names[i]);
        newCbs.push(this.callbacks[i]);
        newFlags.push(this.onceFlags[i]);
      }
    }
    this.names = newNames;
    this.callbacks = newCbs;
    this.onceFlags = newFlags;
  }

  emit(name: string, data: string): void {
    const newNames: string[] = [];
    const newCbs: Array<(data: string) => void> = [];
    const newFlags: boolean[] = [];
    for (let i = 0; i < this.names.length; i++) {
      if (this.names[i] === name) {
        this.callbacks[i](data);
        if (!this.onceFlags[i]) {
          newNames.push(this.names[i]);
          newCbs.push(this.callbacks[i]);
          newFlags.push(this.onceFlags[i]);
        }
      } else {
        newNames.push(this.names[i]);
        newCbs.push(this.callbacks[i]);
        newFlags.push(this.onceFlags[i]);
      }
    }
    this.names = newNames;
    this.callbacks = newCbs;
    this.onceFlags = newFlags;
  }

  listenerCount(name: string): number {
    let count = 0;
    for (let i = 0; i < this.names.length; i++) {
      if (this.names[i] === name) count = count + 1;
    }
    return count;
  }

  removeAllListeners(name: string): void {
    const newNames: string[] = [];
    const newCbs: Array<(data: string) => void> = [];
    const newFlags: boolean[] = [];
    for (let i = 0; i < this.names.length; i++) {
      if (this.names[i] !== name) {
        newNames.push(this.names[i]);
        newCbs.push(this.callbacks[i]);
        newFlags.push(this.onceFlags[i]);
      }
    }
    this.names = newNames;
    this.callbacks = newCbs;
    this.onceFlags = newFlags;
  }
}
