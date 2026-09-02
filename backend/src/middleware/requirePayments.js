import { paymentsEnabled } from '../config/features.js';

// Route-level payments kill-switch (review 2026-09-02): the in-controller
// guards work, but a gate that only exists inside controller bodies is
// invisible in the route tables — the next money endpoint gets written by
// copying a neighbouring route line and ships ungated. Mounting the gate ON
// the route makes it reviewable where money routes are declared, and gates
// paths the controller guards couldn't reach (restoreApple pre-processed
// every receipt before its inner verify hit the guard). The controller
// guards stay as defense-in-depth for direct invocation.
export const requirePayments = (_req, res, next) => {
  if (paymentsEnabled()) return next();
  res.status(403).json({ error: 'Zahlungen sind derzeit deaktiviert.', code: 'PAYMENTS_DISABLED' });
};
