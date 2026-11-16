import { createContext, useContext, useState, useCallback, useRef, useMemo, useEffect } from 'react';
import useSwipeDismiss from '../hooks/useSwipeDismiss';

const ToastContext = createContext();

let toastId = 0;

// Let go of a held toast → it stays at least this long, so the finger leaving
// it right before the time-out doesn't make it vanish in the same instant.
const MIN_RESUME_MS = 1500;

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  // The same list, readable synchronously: addToast has to know which toast
  // the max-5 cap pushes out, to take its timer with it (a displaced toast's
  // timer used to stay behind and fire later on an id that was long gone).
  const listRef = useRef([]);
  // id → { handle, deadline, remaining } — a countdown a finger can pause.
  const timersRef = useRef({});

  const commit = useCallback((next) => {
    listRef.current = next;
    setToasts(next);
  }, []);

  const clearTimer = useCallback((id) => {
    clearTimeout(timersRef.current[id]?.handle);
    delete timersRef.current[id];
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => Object.values(timers).forEach((timer) => clearTimeout(timer.handle));
  }, []);

  const removeToast = useCallback((id) => {
    clearTimer(id);
    if (!listRef.current.some(t => t.id === id)) return;
    commit(listRef.current.filter(t => t.id !== id));
  }, [clearTimer, commit]);

  const runTimer = useCallback((id, ms) => {
    const timer = timersRef.current[id] || (timersRef.current[id] = {});
    clearTimeout(timer.handle);
    timer.deadline = Date.now() + ms;
    timer.remaining = null;
    timer.handle = setTimeout(() => removeToast(id), ms);
  }, [removeToast]);

  const addToast = useCallback((message, type = 'info', duration = 4000, action = null) => {
    const id = ++toastId;
    const list = listRef.current;
    list.slice(0, -4).forEach(t => clearTimer(t.id)); // max 5 toasts — the oldest goes, timer and all
    commit([...list.slice(-4), { id, message, type, action }]);

    if (duration > 0) runTimer(id, duration);

    return id;
  }, [clearTimer, commit, runTimer]);

  // Finger down on a toast (useSwipeDismiss): its countdown stops, so it never
  // vanishes mid-swipe; on release it runs on with what was left.
  const holdToast = useCallback((id) => {
    const timer = timersRef.current[id];
    if (!timer || timer.remaining != null) return;
    clearTimeout(timer.handle);
    timer.remaining = Math.max(0, timer.deadline - Date.now());
  }, []);

  const releaseToast = useCallback((id) => {
    const timer = timersRef.current[id];
    if (!timer || timer.remaining == null) return;
    runTimer(id, Math.max(timer.remaining, MIN_RESUME_MS));
  }, [runTimer]);

  const success = useCallback((msg) => addToast(msg, 'success', 3000), [addToast]);
  const error = useCallback((msg) => addToast(msg, 'error', 5000), [addToast]);
  const warning = useCallback((msg) => addToast(msg, 'warning', 4000), [addToast]);
  const info = useCallback((msg) => addToast(msg, 'info', 4000), [addToast]);

  // Undoable toast: shows a small action button (e.g. "Rückgängig") that runs
  // `onUndo`. Longer default lifetime so there's time to react to an accidental
  // reject (Tobi 2026-07-31). Caller passes the localized label.
  const showUndo = useCallback((message, onUndo, label, duration = 6000) =>
    addToast(message, 'info', duration, { label, onClick: onUndo }), [addToast]);

  // Stable: the functions never change, so the ~35 useToast() consumers no
  // longer re-render every time a toast comes or goes.
  const value = useMemo(
    () => ({ addToast, removeToast, success, error, warning, info, showUndo }),
    [addToast, removeToast, success, error, warning, info, showUndo]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} onHold={holdToast} onRelease={releaseToast} />
    </ToastContext.Provider>
  );
};

const ICONS = {
  success: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M20 6L9 17l-5-5"/>
    </svg>
  ),
  error: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>
    </svg>
  ),
  warning: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  info: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  )
};

// Always rendered, also when empty: a live region that only appears together
// with its first toast is often not announced at all by VoiceOver/TalkBack.
const ToastContainer = ({ toasts, onRemove, onHold, onRelease }) => (
  <div className="toast-container" role="status" aria-live="polite">
    {toasts.map(toast => (
      <ToastItem key={toast.id} toast={toast} onRemove={onRemove} onHold={onHold} onRelease={onRelease} />
    ))}
  </div>
);

const ToastItem = ({ toast, onRemove, onHold, onRelease }) => {
  // Swipe up = gone (Tina 16.11.2026). For an undo toast that means „don't
  // undo": the reject is already saved, the toast only offered the way back.
  const swipe = useSwipeDismiss({
    onDismiss: () => onRemove(toast.id),
    onHold: () => onHold(toast.id),
    onRelease: () => onRelease(toast.id),
  });

  return (
    <div
      ref={swipe.ref}
      className={`toast toast-${toast.type}`}
      {...swipe.handlers}
      // A tap closes a plain toast — the one-finger alternative to the swipe.
      // Toasts with an action stay put on a stray body tap so the undo option
      // isn't lost; they go by swipe, by their button or by time-out.
      onClick={() => { if (!toast.action) onRemove(toast.id); }}
    >
      <span className="toast-icon">{ICONS[toast.type]}</span>
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(toast.id);
            toast.action.onClick();
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 14 4 9 9 4" />
            <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
          </svg>
          {toast.action.label}
        </button>
      )}
    </div>
  );
};

export default ToastProvider;
