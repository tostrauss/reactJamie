import { describe, it, expect } from 'vitest';
import { createSemaphore } from '../../src/utils/semaphore.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createSemaphore', () => {
  it('never runs more than `max` sections concurrently', async () => {
    const sem = createSemaphore(2);
    let running = 0;
    let peak = 0;
    const work = () =>
      sem.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await tick();
        running--;
      });
    await Promise.all([work(), work(), work(), work(), work()]);
    expect(peak).toBe(2);
    expect(sem.inUse).toBe(0);
    expect(sem.queued).toBe(0);
  });

  it('wakes waiters in FIFO order', async () => {
    const sem = createSemaphore(1);
    const order = [];
    const job = (id) => sem.run(async () => { order.push(id); await tick(); });
    await Promise.all([job('a'), job('b'), job('c')]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('releases the slot when the wrapped fn throws', async () => {
    const sem = createSemaphore(1);
    await expect(sem.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(sem.inUse).toBe(0);
    // The slot must be reusable afterwards.
    const result = await sem.run(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('propagates the return value', async () => {
    const sem = createSemaphore(3);
    expect(await sem.run(async () => 42)).toBe(42);
  });

  it('manual acquire/release keeps the count consistent (upload-route pattern)', async () => {
    const sem = createSemaphore(1);
    await sem.acquire();
    expect(sem.inUse).toBe(1);
    let secondEntered = false;
    const p = sem.acquire().then(() => { secondEntered = true; });
    await tick();
    expect(secondEntered).toBe(false); // still queued
    sem.release();
    await p;
    expect(secondEntered).toBe(true);
    sem.release();
    expect(sem.inUse).toBe(0);
  });
});
