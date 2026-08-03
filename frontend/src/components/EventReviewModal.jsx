import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { reviews } from '../utils/api';
import { UserName } from './UserName';

/**
 * Post-event feedback modal.
 * Props:
 *   pendingReviews  - array of { group_id, group_name, event_date, members: [{ id, name, avatar_url }] }
 *   onDone          - called when all reviews are submitted or skipped
 */
export const EventReviewModal = ({ pendingReviews, onDone }) => {
  const { t, i18n } = useTranslation();
  const dateLocale = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en-US' : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('it') ? 'it-IT' : ((i18n.resolvedLanguage || i18n.language || 'de').startsWith('fr') ? 'fr-FR' : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('es') ? 'es-ES' : 'de-AT');
  const [index, setIndex] = useState(0);
  const [attendances, setAttendances] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  if (!pendingReviews?.length) return null;

  const current = pendingReviews[index];
  const isLast = index >= pendingReviews.length - 1;

  const toggle = (memberId, wasPresent) => {
    setAttendances(prev => ({
      ...prev,
      [memberId]: prev[memberId] === wasPresent ? undefined : wasPresent,
    }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(false);
    try {
      const marked = current.members
        .filter(m => attendances[m.id] !== undefined)
        .map(m => ({ user_id: m.id, was_present: attendances[m.id] }));
      await reviews.submit(current.group_id, marked);
      advance();
    } catch (err) {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    // Snooze, don't submit: records a dismissal so the auto-popup stops nagging
    // but the review stays re-openable from the event page later.
    reviews.dismiss(current.group_id).catch(() => {});
    advance();
  };

  const advance = () => {
    setAttendances({});
    if (isLast) {
      onDone();
    } else {
      setIndex(i => i + 1);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: '#1e2235',
        borderRadius: '24px 24px 0 0',
        padding: 'calc(env(safe-area-inset-top, 0px) + 20px) 20px calc(env(safe-area-inset-bottom, 0px) + 24px)',
        // Cap the sheet so its top edge stops 12px below the status bar
        // even when there are many pending reviews to scroll through.
        maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 12px)',
        overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Skip — always visible at top */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>
              {t('eventReview.counterFmt', { current: index + 1, total: pendingReviews.length })}
            </div>
            <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: 0 }}>
              {current.group_name}
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, margin: '4px 0 0' }}>
              {new Date(current.event_date).toLocaleDateString(dateLocale, { day: 'numeric', month: 'long' })}
            </p>
          </div>
          <button
            onClick={handleSkip}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: 'none', borderRadius: 20,
              color: 'rgba(255,255,255,0.6)',
              fontSize: 13, fontWeight: 600,
              padding: '8px 16px', cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {t('eventReview.skip')}
          </button>
        </div>

        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, marginBottom: 16 }}>
          {t('eventReview.prompt')}
        </p>

        {/* Member list */}
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 20 }}>
          {current.members.map(member => {
            const state = attendances[member.id]; // true | false | undefined
            return (
              <div key={member.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 0',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}>
                {/* Avatar */}
                <div style={{
                  width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                  background: '#FD7666', overflow: 'hidden',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, fontWeight: 700, color: '#fff',
                }}>
                  {member.avatar_url
                    ? <img src={member.avatar_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : member.name?.[0]?.toUpperCase()}
                </div>

                <UserName
                  style={{ flex: 1, color: '#fff', fontSize: 15, fontWeight: 500 }}
                  name={member.name}
                  age={member.age}
                />

                {/* ✓ / ✗ toggles */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => toggle(member.id, true)}
                    style={{
                      width: 40, height: 40, borderRadius: '50%', border: 'none',
                      background: state === true ? '#4ade80' : 'rgba(74,222,128,0.12)',
                      color: state === true ? '#fff' : '#4ade80',
                      fontSize: 18, cursor: 'pointer', fontWeight: 700,
                      transition: 'all 0.15s',
                    }}
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => toggle(member.id, false)}
                    style={{
                      width: 40, height: 40, borderRadius: '50%', border: 'none',
                      background: state === false ? '#f87171' : 'rgba(248,113,113,0.12)',
                      color: state === false ? '#fff' : '#f87171',
                      fontSize: 18, cursor: 'pointer', fontWeight: 700,
                      transition: 'all 0.15s',
                    }}
                  >
                    ✗
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {submitError && (
          <p style={{ color: '#f87171', fontSize: 13, textAlign: 'center', marginBottom: 8 }}>
            {t('eventReview.submitError')}
          </p>
        )}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            width: '100%', padding: 16, borderRadius: 14,
            background: submitError ? '#ef4444' : '#FD7666', color: '#fff',
            fontSize: 16, fontWeight: 700, border: 'none',
            cursor: 'pointer', opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? t('eventReview.sending') : submitError ? t('eventReview.retry') : isLast ? t('eventReview.done') : t('eventReview.next')}
        </button>
      </div>
    </div>
  );
};

export default EventReviewModal;
