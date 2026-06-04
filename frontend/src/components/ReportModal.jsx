import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../context/ToastContext';
import api from '../utils/api';

const REASON_KEYS = ['spam', 'inappropriate', 'harassment', 'fake', 'other'];

/**
 * ReportModal
 * @param {'user'|'group'|'message'} type  - What is being reported
 * @param {number} id                       - ID of the reported entity
 * @param {string} name                     - Display name (shown in the title)
 * @param {function} onClose                - Called when the modal should close
 */
export const ReportModal = ({ type, id, name, onClose }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [reason, setReason]   = useState('');
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);

  const typeLabel = type === 'user' ? t('report.type.user') : type === 'group' ? t('report.type.group') : t('report.type.message');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reason) return;
    setLoading(true);
    try {
      await api.reports.create(type, id, reason, details);
      toast.success(t('report.success'));
      onClose();
    } catch {
      toast.error(t('report.error'));
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
            {t('report.titleFmt', { type: typeLabel })}
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
              {t('report.reasonLabel')}
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {REASON_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setReason(key)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 20,
                    border: `1.5px solid ${reason === key ? 'var(--accent-coral)' : 'rgba(255,255,255,0.15)'}`,
                    background: reason === key ? 'rgba(253,118,102,0.15)' : 'transparent',
                    color: reason === key ? 'var(--accent-coral)' : 'var(--text-light)',
                    fontSize: 13,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {t(`report.reasons.${key}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Optional details */}
          <div className="form-group">
            <label style={{ fontSize: 13, color: 'var(--text-light)' }}>
              {t('report.detailsLabel')}
            </label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={t('report.detailsPlaceholder')}
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
            {loading ? t('report.sending') : t('report.submit')}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ReportModal;
