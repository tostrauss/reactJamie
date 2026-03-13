import { useState } from 'react';
import { useToast } from '../context/ToastContext';
import api from '../utils/api';

const REASONS = [
  { value: 'spam',          label: 'Spam' },
  { value: 'inappropriate', label: 'Unangemessen' },
  { value: 'harassment',    label: 'Belästigung' },
  { value: 'fake',          label: 'Fake-Profil' },
  { value: 'other',         label: 'Sonstiges' },
];

/**
 * ReportModal
 * @param {'user'|'group'|'message'} type  - What is being reported
 * @param {number} id                       - ID of the reported entity
 * @param {string} name                     - Display name (shown in the title)
 * @param {function} onClose                - Called when the modal should close
 */
export const ReportModal = ({ type, id, name, onClose }) => {
  const toast = useToast();
  const [reason, setReason]   = useState('');
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);

  const typeLabel = type === 'user' ? 'Nutzer' : type === 'group' ? 'Gruppe/Club' : 'Nachricht';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reason) return;
    setLoading(true);
    try {
      await api.reports.create(type, id, reason, details);
      toast.success('Meldung gesendet. Danke!');
      onClose();
    } catch {
      toast.error('Meldung konnte nicht gesendet werden');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="modal-overlay modal-overlay-center"
      style={{ zIndex: 1000 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-container create-action-modal" style={{ maxWidth: 380 }}>
        {/* Header */}
        <div className="modal-top-bar">
          <h3 style={{ margin: 0, fontSize: 18 }}>
            {typeLabel} melden
          </h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {name && (
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}>
            „{name}"
          </p>
        )}

        <form className="modal-form" onSubmit={handleSubmit}>
          {/* Reason chips */}
          <div>
            <label style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 10, display: 'block' }}>
              Grund *
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setReason(r.value)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 20,
                    border: `1.5px solid ${reason === r.value ? 'var(--accent-coral)' : 'rgba(255,255,255,0.15)'}`,
                    background: reason === r.value ? 'rgba(253,118,102,0.15)' : 'transparent',
                    color: reason === r.value ? 'var(--accent-coral)' : 'var(--text-light)',
                    fontSize: 13,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Optional details */}
          <div className="form-group">
            <label style={{ fontSize: 13, color: 'var(--text-light)' }}>
              Details (optional)
            </label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Beschreibe das Problem kurz..."
              maxLength={500}
              rows={3}
              style={{
                width: '100%',
                background: 'var(--bg-card)',
                border: '1.5px solid rgba(255,255,255,0.1)',
                borderRadius: 10,
                color: 'var(--text-white)',
                padding: '10px 12px',
                fontSize: 14,
                resize: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary modal-submit-btn"
            disabled={!reason || loading}
          >
            {loading ? 'Wird gesendet...' : 'Melden'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ReportModal;
