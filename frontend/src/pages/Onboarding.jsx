import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { api } from '../utils/api';
import { ImageUpload } from '../components/ImageUpload';
import '../styles/auth.css';
import '../styles/home.css';

const INTEREST_OPTIONS = [
  'Sports', 'Music', 'Tech', 'Art', 'Social', 'Gaming', 
  'Fitness', 'Travel', 'Food', 'Movies', 'Reading', 'Photography',
  'Hiking', 'Yoga', 'Dancing', 'Cooking', 'Fashion', 'Nature'
];

const STEPS = ['Welcome', 'Profile', 'Interests', 'Photos', 'Complete'];

export const Onboarding = () => {
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form Data
  const [formData, setFormData] = useState({
    gender: '',
    location: '',
    bio: '',
    interests: [],
    photos: []
  });

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const toggleInterest = (interest) => {
    setFormData(prev => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter(i => i !== interest)
        : [...prev.interests, interest]
    }));
  };

  const handlePhotoUpload = (url) => {
    if (formData.photos.length < 6) {
      setFormData(prev => ({
        ...prev,
        photos: [...prev.photos, url]
      }));
    }
  };

  const removePhoto = (index) => {
    setFormData(prev => ({
      ...prev,
      photos: prev.photos.filter((_, i) => i !== index)
    }));
  };

  const handleComplete = async () => {
    setLoading(true);
    setError('');
    
    try {
      await api.put('/auth/onboarding', formData);
      navigate('/home');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save profile');
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    navigate('/home');
  };

  // Progress Bar
  const progress = ((currentStep + 1) / STEPS.length) * 100;

  return (
    <div className="auth-container" style={{ padding: '20px' }}>
      <div className="auth-box" style={{ maxWidth: '500px', padding: '30px' }}>
        
        {/* Progress Bar */}
        <div style={{ marginBottom: '30px' }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            marginBottom: '10px',
            fontSize: '12px',
            color: '#999'
          }}>
            <span>Step {currentStep + 1} of {STEPS.length}</span>
            <span>{STEPS[currentStep]}</span>
          </div>
          <div style={{ 
            height: '4px', 
            background: 'rgba(255,255,255,0.1)', 
            borderRadius: '2px',
            overflow: 'hidden'
          }}>
            <div style={{ 
              width: `${progress}%`, 
              height: '100%', 
              background: 'linear-gradient(135deg, #ff6b6b, #ff8585)',
              transition: 'width 0.3s ease'
            }} />
          </div>
        </div>

        {/* Step 0: Welcome */}
        {currentStep === 0 && (
          <div style={{ textAlign: 'center' }}>
            <h1 className="logo" style={{ fontSize: '36px' }}>Welcome to JAMIE! 🎉</h1>
            <p className="subtitle" style={{ marginBottom: '30px', lineHeight: '1.6' }}>
              Let's set up your profile so others can find you and you can discover amazing groups and clubs nearby.
            </p>
            <div style={{ 
              background: 'rgba(255,107,107,0.1)', 
              borderRadius: '15px', 
              padding: '20px',
              marginBottom: '30px'
            }}>
              <p style={{ fontSize: '14px', color: '#ddd' }}>
                ✨ This will only take a minute!
              </p>
            </div>
            <button onClick={handleNext} className="btn-primary" style={{ width: '100%', padding: '14px' }}>
              Let's Go!
            </button>
            <button onClick={handleSkip} className="btn-secondary" style={{ width: '100%', marginTop: '10px', padding: '12px' }}>
              Skip for now
            </button>
          </div>
        )}

        {/* Step 1: Basic Profile */}
        {currentStep === 1 && (
          <div>
            <h2 style={{ marginBottom: '10px', textAlign: 'center' }}>Tell us about yourself</h2>
            <p className="subtitle" style={{ textAlign: 'center', marginBottom: '25px' }}>
              This helps us personalize your experience
            </p>

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '13px' }}>
                Gender
              </label>
              <div style={{ display: 'flex', gap: '10px' }}>
                {['Male', 'Female', 'Other'].map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setFormData({ ...formData, gender: g.toLowerCase() })}
                    style={{
                      flex: 1,
                      padding: '12px',
                      borderRadius: '10px',
                      border: formData.gender === g.toLowerCase() 
                        ? '2px solid #ff6b6b' 
                        : '1px solid rgba(255,255,255,0.2)',
                      background: formData.gender === g.toLowerCase() 
                        ? 'rgba(255,107,107,0.2)' 
                        : 'rgba(255,255,255,0.05)',
                      color: '#fff',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '13px' }}>
                📍 Location
              </label>
              <input
                type="text"
                placeholder="e.g., Vienna, Austria"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                style={{ marginBottom: 0 }}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: '#ccc', fontSize: '13px' }}>
                ✍️ Bio (optional)
              </label>
              <textarea
                placeholder="Tell others a bit about yourself..."
                value={formData.bio}
                onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                style={{ minHeight: '100px', marginBottom: 0 }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '30px' }}>
              <button onClick={handleBack} className="btn-secondary" style={{ flex: 1 }}>
                Back
              </button>
              <button onClick={handleNext} className="btn-primary" style={{ flex: 2 }}>
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Interests */}
        {currentStep === 2 && (
          <div>
            <h2 style={{ marginBottom: '10px', textAlign: 'center' }}>What are you into?</h2>
            <p className="subtitle" style={{ textAlign: 'center', marginBottom: '25px' }}>
              Select at least 3 interests to help us match you with groups
            </p>

            <div style={{ 
              display: 'flex', 
              flexWrap: 'wrap', 
              gap: '10px',
              marginBottom: '30px'
            }}>
              {INTEREST_OPTIONS.map(interest => (
                <button
                  key={interest}
                  type="button"
                  onClick={() => toggleInterest(interest)}
                  style={{
                    padding: '10px 18px',
                    borderRadius: '25px',
                    border: formData.interests.includes(interest) 
                      ? '2px solid #ff6b6b' 
                      : '1px solid rgba(255,255,255,0.2)',
                    background: formData.interests.includes(interest) 
                      ? 'rgba(255,107,107,0.3)' 
                      : 'rgba(255,255,255,0.05)',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: '13px',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {interest}
                </button>
              ))}
            </div>

            <p style={{ 
              textAlign: 'center', 
              color: formData.interests.length >= 3 ? '#90ee90' : '#999',
              fontSize: '13px',
              marginBottom: '20px'
            }}>
              {formData.interests.length} selected {formData.interests.length < 3 && `(${3 - formData.interests.length} more needed)`}
            </p>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={handleBack} className="btn-secondary" style={{ flex: 1 }}>
                Back
              </button>
              <button 
                onClick={handleNext} 
                className="btn-primary" 
                style={{ flex: 2 }}
                disabled={formData.interests.length < 3}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Photos */}
        {currentStep === 3 && (
          <div>
            <h2 style={{ marginBottom: '10px', textAlign: 'center' }}>Add some photos</h2>
            <p className="subtitle" style={{ textAlign: 'center', marginBottom: '25px' }}>
              Show off your personality! Add up to 6 photos.
            </p>

            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(3, 1fr)', 
              gap: '10px',
              marginBottom: '20px'
            }}>
              {[...Array(6)].map((_, index) => (
                <div 
                  key={index}
                  style={{
                    aspectRatio: '1',
                    borderRadius: '12px',
                    border: '2px dashed rgba(255,255,255,0.2)',
                    background: 'rgba(255,255,255,0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    position: 'relative'
                  }}
                >
                  {formData.photos[index] ? (
                    <>
                      <img 
                        src={formData.photos[index]} 
                        alt={`Photo ${index + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(index)}
                        style={{
                          position: 'absolute',
                          top: '5px',
                          right: '5px',
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          background: 'rgba(0,0,0,0.7)',
                          border: 'none',
                          color: '#fff',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '14px'
                        }}
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <span style={{ color: '#666', fontSize: '24px' }}>+</span>
                  )}
                </div>
              ))}
            </div>

            <div style={{ textAlign: 'center', marginBottom: '30px' }}>
              <ImageUpload 
                onUpload={handlePhotoUpload} 
                label={`Add Photo (${formData.photos.length}/6)`}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={handleBack} className="btn-secondary" style={{ flex: 1 }}>
                Back
              </button>
              <button onClick={handleNext} className="btn-primary" style={{ flex: 2 }}>
                {formData.photos.length > 0 ? 'Continue' : 'Skip for now'}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Complete */}
        {currentStep === 4 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '60px', marginBottom: '20px' }}>🎊</div>
            <h2 style={{ marginBottom: '10px' }}>You're all set!</h2>
            <p className="subtitle" style={{ marginBottom: '30px', lineHeight: '1.6' }}>
              Your profile is ready. Start exploring groups and clubs, or create your own!
            </p>

            {/* Profile Preview */}
            <div style={{ 
              background: 'rgba(255,255,255,0.05)', 
              borderRadius: '15px', 
              padding: '20px',
              marginBottom: '30px',
              textAlign: 'left'
            }}>
              <h4 style={{ marginBottom: '15px', color: '#ff6b6b' }}>Profile Preview</h4>
              
              {formData.location && (
                <p style={{ fontSize: '13px', marginBottom: '8px' }}>
                  📍 {formData.location}
                </p>
              )}
              
              {formData.bio && (
                <p style={{ fontSize: '13px', marginBottom: '8px', color: '#ccc' }}>
                  "{formData.bio}"
                </p>
              )}
              
              {formData.interests.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '10px' }}>
                  {formData.interests.slice(0, 5).map(i => (
                    <span key={i} style={{ 
                      background: 'rgba(255,107,107,0.2)', 
                      padding: '4px 10px', 
                      borderRadius: '15px',
                      fontSize: '11px'
                    }}>
                      {i}
                    </span>
                  ))}
                  {formData.interests.length > 5 && (
                    <span style={{ fontSize: '11px', color: '#999' }}>
                      +{formData.interests.length - 5} more
                    </span>
                  )}
                </div>
              )}
            </div>

            {error && <p className="error" style={{ marginBottom: '15px' }}>{error}</p>}

            <button 
              onClick={handleComplete} 
              className="btn-primary" 
              style={{ width: '100%', padding: '14px' }}
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Start Exploring! 🚀'}
            </button>
            
            <button 
              onClick={handleBack} 
              className="btn-secondary" 
              style={{ width: '100%', marginTop: '10px', padding: '12px' }}
            >
              Go Back & Edit
            </button>
          </div>
        )}

      </div>
    </div>
  );
};