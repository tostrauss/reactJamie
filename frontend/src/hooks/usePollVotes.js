import { useRef } from 'react';
import { messages } from '../utils/api';
import { applyVoteLocally, isRenderablePoll, mergePoll } from '../utils/polls';

/**
 * Optimistic voting for chat polls (B1).
 *
 * - A tap shows the tick at once (applyVoteLocally) and sends the COMPLETE
 *   selection. One request per poll at a time; taps made meanwhile are queued
 *   and only the LATEST intent is sent next — fast multi-select on a date poll
 *   neither drops taps nor fires a request per tap.
 * - Server answers are merged by version (mergePoll), so a late socket event
 *   or the echo of an earlier tap can never roll the bubble back.
 * - While a poll is busy, incoming summaries (socket, catch-up) are stashed
 *   and applied when the flight ends — only if they are newer.
 * - On error the last CONFIRMED state comes back (or the 409's poll, when the
 *   poll was closed meanwhile) and onError is told.
 *
 * The returned object is referentially stable (everything reads refs), so it
 * can sit in effect/useCallback deps without re-running them.
 */
export function usePollVotes({ setMessageList, onError }) {
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const setListRef = useRef(setMessageList);
  setListRef.current = setMessageList;
  // messageId → { inFlight, queued, confirmed, stash }
  const states = useRef(new Map());
  const api = useRef(null);

  if (!api.current) {
    const patch = (id, fn) => setListRef.current((prev) => {
      let changed = false;
      const next = prev.map((m) => {
        if (String(m.id) !== String(id) || !isRenderablePoll(m.poll)) return m;
        const p = fn(m.poll);
        if (p === m.poll) return m;
        changed = true;
        return { ...m, poll: p };
      });
      return changed ? next : prev;
    });

    const finish = (id, poll) => {
      states.current.delete(id);
      if (poll) patch(id, () => poll);
    };

    const send = async (id) => {
      const st = states.current.get(id);
      if (!st || st.inFlight || st.queued == null) return;
      const choices = st.queued;
      st.queued = null;
      st.inFlight = true;
      try {
        const res = await messages.votePoll(id, choices);
        st.confirmed = mergePoll(st.confirmed, res?.data?.poll);
        st.inFlight = false;
        if (st.queued != null) { send(id); return; }   // the latest intent wins
        finish(id, mergePoll(st.confirmed, st.stash));
      } catch (err) {
        st.inFlight = false;
        st.queued = null;
        const fromServer = err?.response?.data?.poll;
        finish(id, mergePoll(mergePoll(st.confirmed, fromServer), st.stash));
        onErrorRef.current?.(err);
      }
    };

    api.current = {
      vote(msg, choices) {
        const id = msg?.id;
        if (id == null || !isRenderablePoll(msg.poll)) return;
        let st = states.current.get(id);
        if (!st) { st = { inFlight: false, queued: null, confirmed: msg.poll, stash: null }; states.current.set(id, st); }
        st.queued = choices;
        patch(id, (p) => applyVoteLocally(p, choices));
        if (!st.inFlight) send(id);
      },
      // Socket poll_update, catch-up rows, close responses.
      receive(id, incoming) {
        if (!isRenderablePoll(incoming)) return;
        const st = states.current.get(id);
        if (st) {
          if (!st.stash || (Number(incoming.version) || 0) >= (Number(st.stash.version) || 0)) st.stash = incoming;
          return;
        }
        // Only rows that already show a poll: a row without one waits for the
        // catch-up, which carries my_votes — a vote is never computed from an
        // unknown selection.
        patch(id, (p) => mergePoll(p, incoming));
      },
      isBusy(id) { return states.current.has(id); },
    };
  }
  return api.current;
}

export default usePollVotes;
