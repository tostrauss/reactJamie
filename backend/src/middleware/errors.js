// Typed error + async plumbing (audit 2026-09-02, code-health lens).
//
// The app already has a final error middleware (server.js) with Sentry's
// Express handler in front of it — but async controllers each try/catch by
// hand, so nothing ever REACHES it, and a thrown error had no way to carry
// its intended HTTP status. These two pieces close that gap for new and
// migrated routes; existing handlers migrate opportunistically as they're
// touched (don't churn working code for style).
//
// Usage:
//   router.get('/thing/:id', asyncHandler(async (req, res) => {
//     const id = Number.parseInt(req.params.id, 10);
//     if (!Number.isFinite(id)) throw new AppError(400, 'Ungültige ID');
//     ...
//   }));

export class AppError extends Error {
  constructor(status, message, code = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    if (code) this.code = code;
  }
}

// Routes a rejected async handler into Express' error chain instead of an
// unhandled rejection. Without this, `throw` inside an async route handler
// hangs the request until the client times out.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
