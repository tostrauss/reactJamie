import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../context/ToastContext';
import { groups } from '../utils/api';
import { serverErrorMessage } from '../utils/apiError';

// The join button of one event in a club's event list, for somebody who is
// not in the event yet (audit ziel-d-privat-events, Tina-Update 17.11.2026,
// contract V-14).
//
// The list used to say „Beitreten“ on every event — also on one that only
// takes requests (a private event in a public club). The request went out,
// the button stayed, and the second tap ran into a 400 with a German sentence
// in every language. Now the button says what will happen, and what did:
//
//   „Beitreten“            straight in (open event, or a private club's event
//                          for its members)
//   „Beitritt anfragen“    the event takes requests (ev.joins_by_request)
//   „Anfrage ausstehend…“  asked, waiting — disabled
//   „Anfrage abgelehnt“    two rejections, no further request — disabled
//
// The three fields come from the server (utils/clubEventJoinState.js). An
// older server sends none of them: the button then reads „Beitreten“ exactly
// as before, and learns „ausstehend“ from the join's own answer.
//
// The event lives in the parent's list: every change is reported through
// onChange(patch), merged there. No lock symbol, no new texts (decision 10).
const PENDING = { joins_by_request: true, join_request_status: 'pending' };

// The new labels are longer than „Beitreten“. On one line („Anfrage
// ausstehend…“, fr „Demande en attente…“) the button pushed the event's name
// down to „W…“ at 390 px — the card also holds the calendar button. So a long
// label wraps onto two lines; „Beitreten“ still fits on one. Inline, because
// .cd-event-join-btn (nowrap) lives in club-detail.css, which is not this
// component's file.
const LABEL_WRAP = { whiteSpace: 'normal', maxWidth: 104, lineHeight: 1.15, textAlign: 'center' };

// A second request while the first is open. Servers from before 17.11.2026
// answer 400 without a code — the German sentence is all there is to go by
// (the same fallback as OnboardingClubs).
const isPendingRefusal = (err) => {
  const data = err?.response?.data;
  if (data?.code) return data.code === 'JOIN_REQUEST_PENDING';
  return err?.response?.status === 400 && /ausstehend/i.test(data?.error || '');
};

export default function ClubEventJoinButton({ ev, user, onChange, onNeedAvatar, onNeedLogin }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // The two final states: disabled, nothing to tap. (A disabled button runs no
  // click handler — a tap on it is kept from the card by the list's wrapper
  // .cd-event-actions, which stops every click inside it.)
  if (ev.join_request_blocked) {
    return (
      <button type="button" className="cd-event-join-btn" style={LABEL_WRAP} disabled>
        {t('groups.detail.actions.requestBlocked')}
      </button>
    );
  }
  if (ev.joins_by_request && ev.join_request_status === 'pending') {
    return (
      <button type="button" className="cd-event-join-btn" style={LABEL_WRAP} disabled>
        {t('groups.detail.actions.requestPending')}
      </button>
    );
  }

  const join = async (e) => {
    // The card around it opens the event — its wrapper stops the click too.
    e.stopPropagation();
    if (busy) return;
    if (!user) { onNeedLogin?.(); return; }
    setBusy(true);
    try {
      // Events are stored as groups under the hood — the groups join endpoint.
      const res = await groups.join(ev.id);
      window.dispatchEvent(new Event('jamie:push-prompt-after-join')); // contextual push ask (NotificationPrompt)
      if (res?.data?.status === 'pending') {
        onChange?.(PENDING);
        toast.success(t('clubDetail.events.requestSent'));
      } else {
        onChange?.({ is_member: true, members_count: (ev.members_count || 0) + 1 });
        toast.success(t('clubDetail.events.joinedToast'));
      }
    } catch (err) {
      const data = err?.response?.data;
      if (data?.requiresAvatar) {
        onNeedAvatar?.();
      } else if (isPendingRefusal(err)) {
        // Not an error: the request is on its way. Say so, in the app's language.
        onChange?.(PENDING);
        toast.info(t('errors.JOIN_REQUEST_PENDING'));
      } else if (data?.code === 'JOIN_REQUEST_BLOCKED') {
        onChange?.({ join_request_blocked: true });
      } else {
        toast.error(serverErrorMessage(err, t, 'clubDetail.events.joinError'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="cd-event-join-btn" style={LABEL_WRAP} disabled={busy} onClick={join}>
      {busy ? '…' : t(ev.joins_by_request ? 'groups.detail.actions.joinPrivate' : 'clubDetail.events.join')}
    </button>
  );
}
