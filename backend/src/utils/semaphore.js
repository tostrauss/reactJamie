// FIFO counting semaphore — caps how many callers run an expensive section
// concurrently; excess callers queue instead of piling onto the libuv
// threadpool (bcrypt + sharp share it) or spiking RSS. Extracted from the
// upload route's inline slot queue so /media thumbnailing and push fan-out
// can share the same discipline.
export const createSemaphore = (max) => {
  let inUse = 0;
  const queue = [];

  const acquire = () => new Promise((resolve) => {
    if (inUse < max) { inUse++; resolve(); }
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
