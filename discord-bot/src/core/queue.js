/**
 * Sequential job runner for bulk Discord changes (builder, backups, mass role edits).
 * discord.js already respects REST rate limits; this adds a small spacing between calls so a
 * 300-channel build does not hit the global limit, retries transient failures, reports progress
 * and an ETA, and supports cancellation and checkpoints (resume after a restart).
 */
import { logger } from '../lib/logger.js';

const log = logger.child('queue');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export class JobQueue {
  /**
   * @param {Array<{ label:string, run:()=>Promise<any> }>} steps
   * @param {{ spacingMs?:number, retries?:number, startAt?:number, onProgress?:Function, onCheckpoint?:Function, onError?:Function }} opts
   */
  constructor(steps, opts = {}) {
    this.steps = steps;
    this.spacingMs = opts.spacingMs ?? 350;
    this.retries = opts.retries ?? 2;
    this.index = opts.startAt ?? 0;
    this.onProgress = opts.onProgress || (() => {});
    this.onCheckpoint = opts.onCheckpoint || (() => {});
    this.onError = opts.onError || (() => {});
    this.cancelled = false;
    this.errors = [];
    this.startedAt = 0;
  }

  cancel() { this.cancelled = true; }

  eta() {
    const done = this.index - (this.startIndex ?? 0);
    if (done <= 0) return null;
    const per = (Date.now() - this.startedAt) / done;
    return Math.round(per * (this.steps.length - this.index));
  }

  async run() {
    this.startedAt = Date.now();
    this.startIndex = this.index;
    let lastReport = 0;
    while (this.index < this.steps.length && !this.cancelled) {
      const step = this.steps[this.index];
      let attempt = 0;
      for (;;) {
        try { await step.run(); break; } catch (err) {
          const retryable = err?.status >= 500 || err?.code === 'ECONNRESET' || err?.name === 'AbortError' || err?.status === 429;
          if (retryable && attempt < this.retries) { attempt++; await sleep(1500 * attempt); continue; }
          log.warn('step failed', { step: step.label, err });
          this.errors.push({ step: step.label, error: err?.message || String(err) });
          this.onError(step, err);
          break;
        }
      }
      this.index++;
      await this.onCheckpoint(this.index);
      if (Date.now() - lastReport > 3000 || this.index === this.steps.length) {
        lastReport = Date.now();
        await this.onProgress({ done: this.index, total: this.steps.length, label: step.label, eta: this.eta(), errors: this.errors.length });
      }
      if (this.spacingMs) await sleep(this.spacingMs);
    }
    return { done: this.index, total: this.steps.length, cancelled: this.cancelled, errors: this.errors };
  }
}
