import React, { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import '../styles/modal.css';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';

// Icons (using simple text or you can import from lucide-react/react-icons if you have them)
const IconGroup = () => <span style={{ fontSize: '2rem' }}>📅</span>;
const IconClub = () => <span style={{ fontSize: '2rem' }}>🥂</span>;

const CreateActionModal = ({ isOpen, onClose }) => {
  const [step, setStep] = useState('selection'); // 'selection', 'group', 'club'
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(false);
   const [error, setError] = useState('');
  const navigate = useNavigate();

  // Reset state when opening/closing
  useEffect(() => {
    if (isOpen) {
      setStep('selection');
      setFormData({});
      setError('');
    }
  }, [isOpen]);

  // Close on ESC
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isGroupValid = useMemo(() => {
    return (
      formData.name &&
      formData.date &&
      formData.time &&
      formData.location
    );
  }, [formData.name, formData.date, formData.time, formData.location]);

  const isClubValid = useMemo(() => {
    return formData.name && formData.category;
  }, [formData.name, formData.category]);

  // Handle Form Submission
  const handleSubmit = async (e, type) => {
    e.preventDefault();
    setError('');

    if (type === 'group' && !isGroupValid) {
      setError('Bitte fülle alle Pflichtfelder aus.');
      return;
    }

    if (type === 'club' && !isClubValid) {
      setError('Bitte gib zumindest einen Namen und eine Kategorie an.');
      return;
    }

    setLoading(true);
    try {
      const endpoint = type === 'group' ? '/groups' : '/clubs';
      const payload = {
        ...formData,
        // Ensure backend type is set correctly
        ...(type === 'group' ? { type: 'group' } : { type: 'club' })
      };

      const { data } = await api.post(endpoint, payload);

      // Nach dem Erstellen direkt auf die Detailseite navigieren
      onClose();
      if (data?.id) {
        navigate(`/group/${data.id}`);
      } else {
        // Fallback: Seite neu laden, falls keine ID zurückkommt
        window.location.reload();
      }
    } catch (err) {
      console.error(err);
      setError(
        err.response?.data?.error ||
          'Erstellen fehlgeschlagen. Bitte versuche es erneut.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // The Content Logic
  const renderContent = () => {
    switch (step) {
      case 'selection':
        return (
          <div className="modal-selection-grid">
            <button className="selection-card" onClick={() => setStep('group')}>
              <IconGroup />
              <h3>Gruppe erstellen</h3>
              <p>Einmalige Aktivität mit Datum & Uhrzeit.</p>
            </button>
            <button className="selection-card" onClick={() => setStep('club')}>
              <IconClub />
              <h3>Club gründen</h3>
              <p>Dauerhafte Community für gemeinsame Interessen.</p>
            </button>
          </div>
        );

      case 'group':
        return (
          <form onSubmit={(e) => handleSubmit(e, 'group')} className="modal-form">
            <div className="modal-header-row">
              <span className="modal-step-label">Schritt 2 von 2 • Gruppe</span>
            </div>
            <h2 className="modal-title">Aktivität planen</h2>
            <div className="form-group">
              <label>Was macht ihr? *</label>
              <input
                type="text"
                name="name"
                placeholder="z.B. Volleyball im Prater"
                required
                onChange={handleInputChange}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Datum *</label>
                <input
                  type="date"
                  name="date"
                  required
                  onChange={handleInputChange}
                />
              </div>
              <div className="form-group">
                <label>Uhrzeit *</label>
                <input
                  type="time"
                  name="time"
                  required
                  onChange={handleInputChange}
                />
              </div>
            </div>
            <div className="form-group">
              <label>Ort *</label>
              <input
                type="text"
                name="location"
                placeholder="z.B. Donauinsel, Wien"
                required
                onChange={handleInputChange}
              />
            </div>
            <div className="form-group">
              <label>Beschreibung</label>
              <textarea
                name="description"
                placeholder="Kurze Beschreibung, z.B. Niveau, Mitbringen, Treffpunkt …"
                rows="3"
                onChange={handleInputChange}
              ></textarea>
            </div>
            {error && <p className="modal-error">{error}</p>}
            <button
              type="submit"
              className="btn btn-primary modal-submit-btn"
              disabled={loading || !isGroupValid}
            >
              {loading ? 'Wird erstellt…' : 'Gruppe erstellen'}
            </button>
          </form>
        );

      case 'club':
        return (
          <form onSubmit={(e) => handleSubmit(e, 'club')} className="modal-form">
            <div className="modal-header-row">
              <span className="modal-step-label">Schritt 2 von 2 • Club</span>
            </div>
            <h2 className="modal-title">Club gründen</h2>
            <div className="form-group">
              <label>Club-Name *</label>
              <input
                type="text"
                name="name"
                placeholder="z.B. Wiener Wanderfreunde"
                required
                onChange={handleInputChange}
              />
            </div>
            <div className="form-group">
              <label>Kategorie *</label>
              <select
                name="category"
                defaultValue=""
                onChange={handleInputChange}
              >
                <option value="" disabled>
                  Bitte wählen …
                </option>
                <option value="Sport">Sport</option>
                <option value="Ausgehen">Ausgehen</option>
                <option value="Outdoor">Outdoor</option>
                <option value="Kultur">Kultur</option>
                <option value="Essen & Trinken">Essen & Trinken</option>
              </select>
            </div>
            <div className="form-group">
              <label>Beschreibung</label>
              <textarea
                name="description"
                placeholder="Worum geht es in diesem Club?"
                rows="3"
                onChange={handleInputChange}
              ></textarea>
            </div>
            {error && <p className="modal-error">{error}</p>}
            <button
              type="submit"
              className="btn btn-primary modal-submit-btn"
              disabled={loading || !isClubValid}
            >
              {loading ? 'Wird erstellt…' : 'Club gründen'}
            </button>
          </form>
        );
      
      default:
        return null;
    }
  };

  // React Portal to render outside the root div (prevents z-index issues)
  return ReactDOM.createPortal(
    <div
      className="modal-overlay modal-overlay-center"
      onClick={onClose}
    >
      <div
        className="modal-container create-action-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-top-bar">
          {step !== 'selection' ? (
            <button
              className="modal-back"
              type="button"
              onClick={() => {
                setError('');
                setStep('selection');
              }}
            >
              ← Zurück
            </button>
          ) : (
            <span className="modal-step-label">Schritt 1 von 2</span>
          )}
          <button
            className="modal-close"
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          {renderContent()}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CreateActionModal;