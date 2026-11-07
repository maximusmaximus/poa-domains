import { integer, need } from "./core.js";
export interface Clock {
  now(): number;
}
// Wall time sampled once, elapsed time from monotonic clock thereafter. Local only.
export class SystemClock implements Clock {
  private start = process.hrtime.bigint();
  private epoch = Math.floor(Date.now() / 1000);
  now(): number {
    return (
      this.epoch + Number((process.hrtime.bigint() - this.start) / 1000000000n)
    );
  }
}
// Test harness dependency injection, never an HTTP endpoint or intent field.
export class ManualClock implements Clock {
  constructor(private t: number) {
    integer(t);
  }
  now(): number {
    return this.t;
  }
  set(t: number): void {
    integer(t);
    need(t >= this.t, "CLOCK_BACKWARD");
    this.t = t;
  }
  advance(seconds: number): void {
    this.set(this.t + integer(seconds));
  }
}
