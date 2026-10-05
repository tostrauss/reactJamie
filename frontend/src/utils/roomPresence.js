/**
 * "Hidden is not reading" — keep a chat socket's room membership in step with
 * whether the page is actually on screen.
 *
 * The server skips the push for anyone with a socket IN a chat's room: that
 * person is reading along live (messageController.computePushRecipients, and
 * the DM equivalent in dmController). A chat left open in a backgrounded
 * Android TWA, on a locked phone or in a background browser tab kept its
 * socket in the room for minutes — or for good — and the member got no push
 * for that chat on ANY of their devices (tester 06.10.2026: "Die
 * Push-Benachrichtigungen klappen leider immer noch nicht bei mir").
 *
 * So: leave the room when the page is hidden; on return, re-join and back-fill
 * whatever arrived meanwhile (the socket may also not have noticed a dead
 * connection yet — ping timeout — but the user is looking NOW).
 *
 * A desktop window that is merely unattended stays 'visible' and still counts
 * as reading; the browser gives no better signal than visibility.
 *
 * Returns the cleanup, so it can be the body of a useEffect.
 */
export const bindRoomToVisibility = ({ join, leave, onReturn }) => {
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      leave();
    } else if (document.visibilityState === 'visible') {
      join();
      onReturn?.();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => document.removeEventListener('visibilitychange', onVisibility);
};

/** True while the app is in the background — joins should wait for return. */
export const isPageHidden = () =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';
