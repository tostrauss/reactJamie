// FIFO counting semaphore — caps how many callers run an expensive section
// concurrently; excess callers queue instead of piling onto the libuv
// threadpool (bcrypt + sharp share it) or spiking RSS. Extracted from the
// upload route's inline slot queue so /media thumbnailing and push fan-out
// can share the same discipline.
// Options:
//   maxQueue — cap on WAITING callers (default unbounded). When the queue is
//   full, acquire()/run() reject immediately with QUEUE_FULL instead of
//   parking a request handler for minutes behind a slow dependency — callers
//   with a fail-open fallback (geocode → create without a pin) catch and
//   degrade instead of stalling.
export const QUEUE_FULL = 'SEMAPHORE_QUEUE_FULL';

export const createSemaphore = (max, { maxQueue = Infinity } = {}) => {
  let inUse = 0;
  const queue = [];

  const acquire = () => new Promise((resolve, reject) => {
    if (inUse < max) { inUse++; resolve(); }
    else if (queue.length >= maxQueue) {
      const err = new Error('semaphore queue full');
      err.code = QUEUE_FULL;
      reject(err);
    }
    else queue.push(resolve);
  });

  const release = () => {
    const next = queue.shift();
    if (next) next(); // slot passes directly to the next waiter
    else inUse--;
  };

  // Preferred wrapper: guarantees release on both resolve and throw.
  const run = async (fn) => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };

  return {
    acquire,
    release,
    run,
    get inUse() { return inUse; },
    get queued() { return queue.length; },
  };
};
