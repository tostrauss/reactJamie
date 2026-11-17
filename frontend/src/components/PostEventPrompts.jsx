import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { reviews, postEventApi, communityNudgeApi } from '../utils/api';
import { EventReviewModal } from './EventReviewModal';
import ConnectSheet from './ConnectSheet';
import EventRatingModal from './EventRatingModal';
import CommunityNudgeCard from './CommunityNudgeCard';

// Everything the app asks or tells somebody AFTER an event, in one place and
// one at a time (Tina 17.11.2026):
//
//   reviews    „Wer war dabei?“ — the creator only (EventReviewModal)
//   connect    „Aus Fremden können Freundschaften werden!“ — everybody else
//   ratings    „Wie war’s bei X?“ — stars + feedback, everybody
//   community  „Hey, [Community] hat Potenzial! ✨“ — the card for a community
//              without a meetup; on the home screen only, one per session
//
// The server decides what is due; this only fetches the four lists and shows
// them in that order. It took over from App.jsx's single „pending reviews“
// effect, which loaded once per login — so after a tap on the review push in
// an app that was already running (iOS: the tap only navigates inside the
// SPA) nothing came up (audit S4-frage-kommt-ios). Now the lists are fetched
//
//   - when the user is known (login, cold start),
//   - whenever the app returns to the foreground (visibilitychange), at most
//     every CHECK_EVERY_MS,
//   - at once when a push link arrives: ?review=1 (the review push,
//     /home?review=1) or ?connect=1 (the Connect push, /group/<id>?connect=1 —
//     that event's list then comes first). The parameter is removed again.
//
// A list is only taken while its part of the queue is empty, so a dialog that
// is open is never replaced under the user's hands. Each fetch stands alone:
// an older server (404), a failed request or an api mock without the new
// exports only loses that one part.
//
// `suppressed` (sign-up and onboarding) shows nothing and keeps the queue.
// `onActiveChange` tells App whether a dialog is up, so the banners yield.

export const CHECK_EVERY_MS = 5 * 60 * 1000;
export const PROMPT_ORDER = ['reviews', 'connect', 'ratings', 'community'];
const EMPTY = { reviews: [], connect: [], ratings: [], community: [] };

/**
 * Which part of the queue is shown now — the first non-empty one in
 * PROMPT_ORDER that `can` be rendered. The community card only on the home
 * screen, and not again once one was seen this session.
 */
export function nextPrompt(queue, { pathname = '', communitySeen = false, can = PROMPT_ORDER } = {}) {
  for (const kind of PROMPT_ORDER) {
    if (!can.includes(kind) || !queue?.[kind]?.length) continue;
    if (kind === 'community' && (pathname !== '/home' || communitySeen)) continue;
    return kind;
  }
  return null;
}

// What each part renders. A part without an entry here is fetched but never
// shown (and never blocks the ones after it).
//   ({ items, done }) → element; `done` closes the item (or all of them).
const RENDERERS = {
  reviews: ({ items, done }) => <EventReviewModal pendingReviews={items} onDone={() => done({ all: true })} />,
  // The sheet walks through its events itself and reports when all are closed.
  connect: ({ items, done }) => <ConnectSheet items={items} onDone={() => done({ all: true })} />,
  ratings: ({ items, done }) => <EventRatingModal items={items} onDone={() => done({ all: true })} />,
  // One card per session, the newest: closing it ends this part (see `done`).
  community: ({ items, done }) => <CommunityNudgeCard nudge={items[0]} onClose={() => done()} />,
};

// Each call inside its own promise: a missing export (a test's api mock) or a
// synchronous throw rejects this one call instead of breaking the effect.
const safe = (fn) => Promise.resolve().then(fn);
const listOf = (settled) => (settled.status === 'fulfilled' && Array.isArray(settled.value?.data) ? settled.value.data : null);

// The event a Connect push asked for goes to the front.
const withFocus = (list, groupId) => {
  if (groupId == null || !list.some((e) => Number(e.group_id) === groupId)) return list;
  return [...list.filter((e) => Number(e.group_id) === groupId), ...list.filter((e) => Number(e.group_id) !== groupId)];
};

const PUSH_PARAMS = ['review', 'connect'];

export default function PostEventPrompts({ user, suppressed = false, onActiveChange }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [queue, setQueue] = useState(EMPTY);
  const [communitySeen, setCommunitySeen] = useState(false);
  const inFlight = useRef(false);
  const lastCheck = useRef(0);
  const focusGroup = useRef(null);

  const userId = user && !user.isGuest ? user.id : null;

  const check = useCallback(async ({ force = false } = {}) => {
    if (userId == null || inFlight.current) return;
    const now = Date.now();
    if (!force && now - lastCheck.current < CHECK_EVERY_MS) return;
    inFlight.current = true;
    lastCheck.current = now;
    try {
      const settled = await Promise.allSettled([
        safe(() => reviews.getPending()),
        safe(() => postEventApi.getConnectPending()),
        safe(() => postEventApi.getRatingsPending()),
        safe(() => communityNudgeApi.getMine()),
      ]);
      const fresh = Object.fromEntries(PROMPT_ORDER.map((kind, i) => [kind, listOf(settled[i])]));
      setQueue((q) => {
        const next = { ...q };
        for (const kind of PROMPT_ORDER) {
          // Only into an empty part — an open dialog is never replaced.
          if (fresh[kind] && !q[kind].length) next[kind] = fresh[kind];
        }
        next.connect = withFocus(next.connect, focusGroup.current);
        return next;
      });
    } finally {
      inFlight.current = false;
    }
  }, [userId]);

  // (a) The user is known — and another account starts with an empty queue.
  useEffect(() => {
    setQueue(EMPTY);
    setCommunitySeen(false);
    lastCheck.current = 0;
    check({ force: true });
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // (b) Back in the foreground (also fires in the iOS WKWebView).
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [check]);

  // (c) A push link: fetch at once, then take the parameter out of the URL.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const hit = PUSH_PARAMS.filter((p) => params.get(p) === '1');
    if (!hit.length) return;
    if (hit.includes('connect')) {
      const m = /^\/group\/(\d+)$/.exec(location.pathname);
      if (m) {
        focusGroup.current = Number(m[1]);
        setQueue((q) => ({ ...q, connect: withFocus(q.connect, focusGroup.current) }));
      }
    }
    check({ force: true });
    hit.forEach((p) => params.delete(p));
    const rest = params.toString();
    navigate(
      { pathname: location.pathname, search: rest ? `?${rest}` : '', hash: location.hash },
      { replace: true, state: location.state },
    );
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  const kind = userId == null ? null : nextPrompt(queue, {
    pathname: location.pathname, communitySeen, can: Object.keys(RENDERERS),
  });
  const active = !!kind && !suppressed;

  useEffect(() => { onActiveChange?.(active); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;

  // Close the first item of this part — or the whole part.
  const done = ({ all = false } = {}) => {
    if (kind === 'community') setCommunitySeen(true);
    setQueue((q) => ({ ...q, [kind]: all || kind === 'community' ? [] : q[kind].slice(1) }));
  };

  return RENDERERS[kind]({ items: queue[kind], done, navigate });
}
