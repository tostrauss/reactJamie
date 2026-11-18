import { useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { groups } from '../utils/api';
import { serverErrorMessage } from '../utils/apiError';
import { coverCardUrl, thumbUrl } from '../utils/images';
import { eventDateLocale } from '../utils/eventDate';
import { viennaTodayUTC } from '../utils/recurrence';
import { firstName, goingWhen } from '../utils/friendsHub';
import AvatarGateModal from './AvatarGateModal';
import { ChatNudgeSheet } from './ChatNudgeSheet';
import DailyLimitModal from './DailyLimitModal';

// „Wo gehen deine Freunde hin? 🎉“ (Tina, 17.11.2026 — the new Friends page):
// cards to swipe sideways. On each: the picture, the meetup's name, day and
// time, the friends who go („Fynn + 2 Freunde“) and the coral „Mitkommen“.
//
// „Mitkommen“ is the join of the meetup itself — the same endpoint, so the
// same daily limit, the same avatar rule, the same request flow:
//   open meetup          → in, the button reads „Du bist dabei“, and the
//                          „Sag kurz Hallo“ sheet of the meetup's own page
//                          opens (Tobi 18.11.2026); closing it stays here
//   meetup by request    → the request goes out, „Angefragt“
//   already in / asked   → the card comes with that state (my_status)
//   daily limit reached  → the „Tageslimit erreicht“ sheet, never the Pro
//                          sheet directly
//   no profile picture   → the avatar prompt, before and after the server's
//                          403 requiresAvatar
// A tap on the card outside the button opens the meetup.
//
// The list is the server's (GET /friends/going): only what the Gruppen feed
// would show this user, the next one first. No cards → no section.

// Tina's text names profile pictures of the friends on the card, her mockup
// shows the line of text alone. One switch: false = exactly the mockup.
export const SHOW_FRIEND_AVATARS = true;

// A second request while the first is open. Servers from before 17.11.2026
// answer 400 without a code (same fallback as ClubEventJoinButton).
const isPendingRefusal = (err) => {
  const data = err?.response?.data;
  if (data?.code) return data.code === 'JOIN_REQUEST_PENDING';
  return err?.response?.status === 400 && /ausstehend/i.test(data?.error || '');
};
const isAlreadyMember = (err) =>
  err?.response?.status === 400 && /already a member/i.test(err?.response?.data?.error || '');

function CardPicture({ src, name }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return <span className="fh-going-img fh-going-img--empty" aria-hidden="true">{(name || '?').slice(0, 1).toUpperCase()}</span>;
  }
  return (
    <span className="fh-going-img">
      <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
    </span>
  );
}

export function FriendsGoing({ cards, setCards }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const { user } = useContext(AuthContext) || {};
  const [busyId, setBusyId] = useState(null);
  const [avatarGate, setAvatarGate] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  // The card just joined, while its „Sag kurz Hallo“ sheet is open.
  const [hello, setHello] = useState(null);

  if (!Array.isArray(cards) || cards.length === 0) return null;

  const locale = eventDateLocale(i18n.resolvedLanguage || i18n.language);
  const today = viennaTodayUTC();
  const todayLabel = t('groups.card.dateHeute');

  const setStatus = (id, my_status) =>
    setCards((prev) => (prev || []).map((c) => (c.id === id ? { ...c, my_status } : c)));

  const join = async (card) => {
    if (busyId !== null) return;
    // The same order as on the meetup's own page: no picture, no join.
    if (!user?.avatar_url) { setAvatarGate(true); return; }
    setBusyId(card.id);
    try {
      const res = await groups.join(card.id);
      // As on the meetup's own page (GroupDetail): a direct join first shows
      // „Sag kurz Hallo“, and the contextual push ask (NotificationPrompt)
      // waits until that sheet closes, so the two never stack. A request
      // („Angefragt“) gets no sheet, there is no chat to write in yet.
      const pending = res?.data?.status === 'pending';
      setStatus(card.id, pending ? 'requested' : 'member');
      if (pending) window.dispatchEvent(new Event('jamie:push-prompt-after-join'));
      else setHello({ id: card.id, name: card.name });
    } catch (err) {
      const data = err?.response?.data;
      if (data?.requiresAvatar) setAvatarGate(true);
      else if (data?.code === 'DAILY_JOIN_LIMIT') setLimitOpen(true);
      // Not errors: the state on the card was simply stale.
      else if (isPendingRefusal(err)) setStatus(card.id, 'requested');
      else if (isAlreadyMember(err)) setStatus(card.id, 'member');
      else toast.error(serverErrorMessage(err, t, 'groups.detail.toast.joinLeaveError'));
    } finally {
      setBusyId(null);
    }
  };

  const closeHello = () => {
    window.dispatchEvent(new Event('jamie:push-prompt-after-join'));
    setHello(null);
  };

  return (
    <section className="fh-section" aria-labelledby="fh-going-title">
      <h3 className="fh-title" id="fh-going-title">{t('explore.friends.goingTitle')}</h3>
      <ul className="fh-rail">
        {cards.map((card) => {
          const friends = Array.isArray(card.friends) ? card.friends : [];
          const first = firstName(friends[0]?.name);
          const others = Math.max(0, (card.friend_count || friends.length) - 1);
          const when = goingWhen(card.next_at || card.date, { locale, today, todayLabel });
          return (
            <li key={card.id} className="fh-going-card">
              <button type="button" className="fh-going-open" onClick={() => navigate(`/group/${card.id}`)}>
                <CardPicture src={coverCardUrl(card.image_url)} name={card.name} />
                <span className="fh-going-name">{card.name}</span>
                {when && <span className="fh-going-when">{when}</span>}
                {SHOW_FRIEND_AVATARS && friends.length > 0 && (
                  <span className="fh-going-avatars" aria-hidden="true">
                    {friends.map((f) => (
                      <span key={f.id} className="fh-going-avatar">
                        {f.avatar_url
                          ? <img src={thumbUrl(f.avatar_url)} alt="" loading="lazy" decoding="async" />
                          : <span>{(f.name || '?').slice(0, 1).toUpperCase()}</span>}
                      </span>
                    ))}
                  </span>
                )}
                {first && (
                  <span className="fh-going-friends">
                    <span className="fh-going-first">{first}</span>
                    {others > 0 && (
                      <span className="fh-going-more">{' '}{t('explore.friends.goingOthers', { count: others })}</span>
                    )}
                  </span>
                )}
              </button>
              {card.my_status === 'member' ? (
                <span className="fh-pill fh-pill--done">{t('explore.friends.goingJoined')}</span>
              ) : card.my_status === 'requested' ? (
                <span className="fh-pill fh-pill--done">{t('explore.friends.btnRequested')}</span>
              ) : (
                <button type="button" className="fh-pill" disabled={busyId === card.id} onClick={() => join(card)}>
                  {t('explore.friends.goingJoin')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <AvatarGateModal isOpen={avatarGate} onClose={() => setAvatarGate(false)} />
      {limitOpen && <DailyLimitModal variant="join" onClose={() => setLimitOpen(false)} />}
      {hello && (
        <ChatNudgeSheet
          variant="joined"
          groupName={hello.name}
          onChat={() => { const { id } = hello; closeHello(); navigate(`/chat/${id}`); }}
          onClose={closeHello}
        />
      )}
    </section>
  );
}

export default FriendsGoing;
