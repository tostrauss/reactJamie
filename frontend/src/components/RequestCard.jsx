import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import VerifiedBadge from './VerifiedBadge';

// Shared join-request card so /group/:id/requests (page) and the chat-list
// requests modal render IDENTICALLY (Tobi 2026-07-31: "beide sollen genau
// gleich aussehen"). Both are fed the same payload from groups.getRequests.
// Styling lives in chat.css (.request-*), the single source of truth — import
// it wherever this card is used.
export function RequestCard({ request }) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Age: prefer the exact DOB calc, fall back to the server-computed age.
  const age = request.user_dob
    ? Math.floor((Date.now() - new Date(request.user_dob)) / 31557600000)
    : (request.user_age ?? null);

  let interests = [];
  try {
    interests = request.user_interests
      ? (typeof request.user_interests === 'string' ? JSON.parse(request.user_interests) : request.user_interests)
      : [];
  } catch { /* malformed interests JSON — just show none */ }

  return (
    <div className="request-card">
      <div className="request-image-container request-image-tall">
        {request.user_avatar
          ? <img src={request.user_avatar} alt={request.user_name} className="request-user-image" loading="lazy" decoding="async" />
          : <div className="request-avatar-placeholder">{(request.user_name || '?')[0].toUpperCase()}</div>}
        {request.user_trusted && (
          <VerifiedBadge className="request-trusted-badge" size={34} />
        )}
      </div>

      <div className="request-user-info">
        <h2 className="request-name">
          {request.user_name}{age ? `, ${age}` : ''}
        </h2>

        <button
          type="button"
          className="request-profile-link"
          onClick={() => navigate(`/user/${request.user_id}`)}
        >
          {t('common.viewProfile')}
        </button>

        {request.message && (
          <p className="request-bio">{request.message}</p>
        )}

        {interests.length > 0 && (
          <div className="request-interests">
            {interests.slice(0, 5).map((tag, i) => (
              <span key={i} className="request-interest-tag">{tag}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default RequestCard;
