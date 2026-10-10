// A reset cancels every outstanding UI wait before a new game can start.
export class Cancelled extends Error {}

export class Session {
  constructor() { this.pending = new Set(); this.cancelled = false; }
  assert() { if (this.cancelled) throw new Cancelled(); }
  wait(register) {
    if (this.cancelled) return Promise.reject(new Cancelled());
    return new Promise((resolve, reject) => {
      let cleanup = () => {};
      let settled = false;
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        this.pending.delete(cancel);
        cleanup();
        error ? reject(error) : resolve(value);
      };
      const cancel = () => finish(null, new Cancelled());
      this.pending.add(cancel);
      cleanup = register(value => finish(value)) || (() => {});
      if (settled) cleanup();
    }).then(value => { this.assert(); return value; });
  }
  delay(ms) {
    return this.wait(resolve => {
      const timer = setTimeout(resolve, ms);
      return () => clearTimeout(timer);
    });
  }
  cancel() {
    this.cancelled = true;
    for (const cancel of [...this.pending]) cancel();
  }
}
