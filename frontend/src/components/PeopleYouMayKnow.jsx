import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { thumbUrl } from '../utils/images';
import { UserName } from './UserName';

// „Leute, die du kennen könntest“ (Tina, 17.11.2026 — the new Friends page):
// cards to swipe sideways. On each: profile picture, name, „War mit dir bei
// Kochabend“ (the most recent meetup shared with that person) and „Anfrage
// senden“ — after the tap it reads „Angefragt“.
//
// The request is the one friendship flow of the app (useFriendActions, handed
// in as `actions`): optimistic, and the 6th request of a free account's day
// opens the „Tageslimit erreicht“ sheet. A tap on the person opens the profile.
//
// `data` is the server's { people, has_shared } (GET /friends/people):
//   people                → the cards
//   nobody, no shared     → Tina's sentence in light lilac instead of cards
//     meetup at all         („Keine gemeinsamen Gruppen?“)
//   nobody, but shared    → nothing: everybody from those meetups is a friend
//     meetups (or unknown)   or asked already, the sentence would be wrong —
//                            and after a failed load it could be wrong too
export function PeopleYouMayKnow({ data, setData, actions }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  if (!data) return null;

  const people = Array.isArray(data.people) ? data.people : [];
  if (people.length === 0 && data.has_shared !== false) return null;

  const setStatus = (id, friend_status) => setData((prev) => (prev
    ? { ...prev, people: (prev.people || []).map((p) => (p.id === id ? { ...p, friend_status } : p)) }
    : prev));

  return (
    <section className="fh-section" aria-labelledby="fh-people-title">
      <h3 className="fh-title" id="fh-people-title">{t('explore.friends.peopleTitle')}</h3>
      {people.length === 0 ? (
        <p className="fh-people-empty">{t('explore.friends.peopleEmpty')}</p>
      ) : (
        <ul className="fh-rail">
          {people.map((p) => (
            <li key={p.id} className="fh-person-card">
              <button type="button" className="fh-person-open" onClick={() => navigate(`/user/${p.id}`)}>
                <span className="fh-person-top">
                  <span className="fh-person-av">
                    {p.avatar_url
                      ? <img src={thumbUrl(p.avatar_url)} alt="" loading="lazy" decoding="async" />
                      : <span>{(p.name || '?').slice(0, 1).toUpperCase()}</span>}
                  </span>
                  <UserName className="fh-person-name" name={p.name} age={p.age} />
                </span>
                {p.event_name && (
                  <span className="fh-person-with">{t('explore.friends.peopleWith', { name: p.event_name })}</span>
                )}
              </button>
              {p.friend_status === 'pending_out' ? (
                <span className="fh-pill fh-pill--done">{t('explore.friends.btnRequested')}</span>
              ) : p.friend_status === 'accepted' ? (
                <span className="fh-pill fh-pill--done">{t('explore.friends.btnFriends')}</span>
              ) : (
                <button
                  type="button"
                  className="fh-pill"
                  disabled={actions.busyId === p.id}
                  onClick={() => actions.request(p, setStatus)}
                >
                  {t('explore.friends.peopleRequest')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default PeopleYouMayKnow;
