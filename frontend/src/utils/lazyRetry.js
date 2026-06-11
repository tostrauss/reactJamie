import { lazy } from 'react';

// Wrap React.lazy so a failed chunk fetch recovers with ONE hard reload
// instead of dumping the user on the "Hoppla!" error page.
//
// Why chunks fail: after a deploy, the old hashed chunk files are gone. A
// user whose tab still runs the previous index.html navigates to a lazy
// route, requests e.g. Onboarding-OLDHASH.js, and the SPA fallback answers
// with index.html → the dynamic import rejects → ErrorBoundary. A reload
// fetches the fresh index.html and everything works again — so do that
// reload automatically. A sessionStorage flag prevents reload loops when
// the failure is genuine (e.g. offline mid-navigation).
const RELOAD_FLAG = 'jamie_chunk_reloaded';

export const lazyWithReload = (factory) => lazy(() =>
  factory()
    .then((mod) => {
      sessionStorage.removeItem(RELOAD_FLAG);
      return mod;
    })
    .catch((err) => {
      if (!sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, '1');
        window.location.reload();
        return new Promise(() => {}); // reload takes over — never resolve
      }
      throw err; // second failure in a row → real problem, surface it
    })
);
