import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import '../styles/modal.css'; // We will create this styling next
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';

// Icons (using simple text or you can import from lucide-react/react-icons if you have them)
const IconGroup = () => <span style={{ fontSize: '2rem' }}>📅</span>;
const IconClub = () => <span style={{ fontSize: '2rem' }}>🥂</span>;

const CreateActionModal = ({ isOpen, onClose }) => {
  const [step, setStep] = useState('selection'); // 'selection', 'group', 'club'
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Reset state when opening/closing
  useEffect(() => {
    if (isOpen) {
      setStep('selection');
      setFormData({});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Handle Form Submission
  const handleSubmit = async (e, type) => {
    e.preventDefault();
    setLoading(true);
    try {
      const endpoint = type === 'group' ? '/groups' : '/clubs'; // Adjust based on your API
      // Add logic here to match your specific API fields
      const payload = { ...formData }; 
      
      const { data } = await api.post(endpoint, payload);
      
      // Success feedback
      onClose();
      // Optionally refresh the list or navigate to the new item
      window.location.reload(); 
    } catch (err) {
      console.error(err);
      alert('Failed to create. Please try again.');
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
              <h3>Create Group</h3>
              <p>One-time activity with specific date & time.</p>
            </button>
            <button className="selection-card" onClick={() => setStep('club')}>
              <IconClub />
              <h3>Create Club</h3>
              <p>A permanent community for ongoing interests.</p>
            </button>
          </div>
        );

      case 'group':
        return (
          <form onSubmit={(e) => handleSubmit(e, 'group')} className="modal-form">
            <h2 className="modal-title">Plan a Group Activity</h2>
            <div className="form-group">
              <label>What are we doing?</label>
              <input type="text" name="name" placeholder="e.g. Sunday Brunch" required onChange={handleInputChange} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Date</label>
                <input type="date" name="date" required onChange={handleInputChange} />
              </div>
              <div className="form-group">
                <label>Time</label>
                <input type="time" name="time" required onChange={handleInputChange} />
              </div>
            </div>
            <div className="form-group">
              <label>Location</label>
              <input type="text" name="location" placeholder="e.g. Central Park" required onChange={handleInputChange} />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea name="description" placeholder="Details about the event..." rows="3" onChange={handleInputChange}></textarea>
            </div>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Launch Group'}
            </button>
          </form>
        );

      case 'club':
        return (
          <form onSubmit={(e) => handleSubmit(e, 'club')} className="modal-form">
            <h2 className="modal-title">Start a Club</h2>
            <div className="form-group">
              <label>Club Name</label>
              <input type="text" name="name" placeholder="e.g. Vienna Hikers" required onChange={handleInputChange} />
            </div>
            <div className="form-group">
              <label>Category</label>
              <select name="category" onChange={handleInputChange}>
                <option value="general">General</option>
                <option value="sports">Sports</option>
                <option value="social">Social</option>
                <option value="music">Music</option>
              </select>
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea name="description" placeholder="What is this club about?" rows="3" onChange={handleInputChange}></textarea>
            </div>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Found Club'}
            </button>
          </form>
        );
      
      default:
        return null;
    }
  };

  // React Portal to render outside the root div (prevents z-index issues)
  return ReactDOM.createPortal(
    <div className="modal-overlay">
      <div className="modal-container">
        <button className="modal-close" onClick={onClose}>&times;</button>
        {step !== 'selection' && (
          <button className="modal-back" onClick={() => setStep('selection')}>← Back</button>
        )}
        <div className="modal-body">
          {renderContent()}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CreateActionModal;