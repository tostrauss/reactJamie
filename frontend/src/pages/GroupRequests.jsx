import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

export const GroupRequests = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [requests, setRequests] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [swipeDirection, setSwipeDirection] = useState(null);
  const [startX, setStartX] = useState(0);
  const [offsetX, setOffsetX] = useState(0);
  const cardRef = useRef(null);

  useEffect(() => {
    loadRequests();
  }, [id]);

  const loadRequests = async () => {
    try {
      const mockRequests = [
        {
          id: 1,
          user: {
            id: 101,
            name: 'Max',
            age: 22,
            avatar: 'https://i.pravatar.cc/400?img=11',
            message: 'Hey, hätte mega Lust dabei zu sein',
            interests: ['Hiking', 'Tennis', 'Golf'],
            verified: true
          }
        },
        {
          id: 2,
          user: {
            id: 102,
            name: 'Lisa',
            age: 24,
            avatar: 'https://i.pravatar.cc/400?img=12',
            message: 'Bin Anfänger aber sehr motiviert!',
            interests: ['Yoga', 'Running', 'Swimming'],
            verified: true
          }
        },
        {
          id: 3,
          user: {
            id: 103,
            name: 'Tom',
            age: 28,
            avatar: 'https://i.pravatar.cc/400?img=13',
            message: 'Spiele seit 5 Jahren, würde mich freuen!',
            interests: ['Volleyball', 'Fitness', 'Cycling'],
            verified: false
          }
        }
      ];
      
      setRequests(mockRequests);
    } catch (err) {
      console.error('Failed to load requests:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTouchStart = (e) => {
    setStartX(e.touches[0].clientX);
  };

  const handleTouchMove = (e) => {
    const currentX = e.touches[0].clientX;
    const diff = currentX - startX;
    setOffsetX(diff);
    
    if (diff > 50) {
      setSwipeDirection('right');
    } else if (diff < -50) {
      setSwipeDirection('left');
    } else {
      setSwipeDirection(null);
    }
  };

  const handleTouchEnd = () => {
    if (offsetX > 100) {
      handleAccept();
    } else if (offsetX < -100) {
      handleDecline();
    } else {
      setOffsetX(0);
      setSwipeDirection(null);
    }
  };

  const handleAccept = async () => {
    const request = requests[currentIndex];
    
    try {
      console.log('Accepted:', request.user.name);
    } catch (err) {
      console.error('Failed to accept:', err);
    }
    
    setSwipeDirection('right');
    setOffsetX(300);
    
    setTimeout(() => {
      goToNext();
    }, 300);
  };

  const handleDecline = async () => {
    const request = requests[currentIndex];
    
    try {
      console.log('Declined:', request.user.name);
    } catch (err) {
      console.error('Failed to decline:', err);
    }
    
    setSwipeDirection('left');
    setOffsetX(-300);
    
    setTimeout(() => {
      goToNext();
    }, 300);
  };

  const goToNext = () => {
    setOffsetX(0);
    setSwipeDirection(null);
    
    if (currentIndex < requests.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setCurrentIndex(requests.length);
    }
  };

  const currentRequest = requests[currentIndex];

  if (loading) {
    return (
      <div className="page">
        <div className="loading-container">
          <div className="loading-spinner" />
          <p>Lade Anfragen...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page requests-page">
      <div className="requests-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h1 className="requests-title">
          {requests.length - currentIndex} neue Anfragen
        </h1>
        <div style={{ width: 40 }} />
      </div>

      <div className="requests-content">
        {currentIndex >= requests.length ? (
          <div className="empty-state">
            <div className="empty-state-icon">✅</div>
            <h2 className="empty-state-title">Alle Anfragen bearbeitet!</h2>
            <p className="empty-state-text">
              Du hast alle Beitrittsanfragen durchgesehen.
            </p>
            <button className="btn btn-primary" onClick={() => navigate(-1)}>
              Zurück zur Gruppe
            </button>
          </div>
        ) : currentRequest ? (
          <div 
            className="request-card-wrapper"
            ref={cardRef}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            style={{
              transform: `translateX(${offsetX}px) rotate(${offsetX * 0.05}deg)`,
              transition: Math.abs(offsetX) > 100 ? 'transform 0.3s ease' : 'none'
            }}
          >
            <div className={`swipe-indicator swipe-accept ${swipeDirection === 'right' ? 'visible' : ''}`}>
              <span>✓</span>
              <span>Annehmen</span>
            </div>
            <div className={`swipe-indicator swipe-decline ${swipeDirection === 'left' ? 'visible' : ''}`}>
              <span>✕</span>
              <span>Ablehnen</span>
            </div>

            <div className="request-card">
              <div className="request-image-container">
                <img 
                  src={currentRequest.user.avatar} 
                  alt={currentRequest.user.name}
                  className="request-user-image"
                />
                {currentRequest.user.verified && (
                  <div className="verified-badge">✓</div>
                )}
              </div>
              
              <div className="request-user-info">
                <h2 className="request-name">
                  {currentRequest.user.name}, {currentRequest.user.age}
                </h2>
                
                <p className="request-message">
                  {currentRequest.user.message}
                </p>
                
                <div className="request-interests">
                  {currentRequest.user.interests.map(interest => (
                    <span key={interest} className="interest-tag">
                      {interest}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {currentIndex < requests.length - 1 && (
              <div className="next-card-preview">
                <img 
                  src={requests[currentIndex + 1].user.avatar} 
                  alt="Next"
                />
              </div>
            )}
          </div>
        ) : null}
      </div>

      {currentIndex < requests.length && (
        <div className="requests-actions">
          <button className="action-btn decline" onClick={handleDecline}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
          
          <button className="action-btn accept" onClick={handleAccept}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20,6 9,17 4,12"/>
            </svg>
          </button>
        </div>
      )}

      <style>{`
        .requests-page {
          display: flex;
          flex-direction: column;
          height: 100vh;
          padding-bottom: 0;
        }
        .requests-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          padding-top: calc(env(safe-area-inset-top, 20px) + 16px);
        }
        .back-btn {
          background: none;
          border: none;
          color: var(--text-white);
          cursor: pointer;
          padding: 8px;
        }
        .requests-title {
          font-size: 18px;
          font-weight: 600;
          color: var(--text-white);
        }
        .requests-content {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          overflow: hidden;
        }
        .request-card-wrapper {
          position: relative;
          width: 100%;
          max-width: 340px;
          user-select: none;
        }
        .swipe-indicator {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          font-weight: 600;
          opacity: 0;
          transition: opacity 0.2s;
          z-index: 10;
        }
        .swipe-indicator span:first-child {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
        }
        .swipe-accept {
          right: -20px;
          color: var(--accent-green);
        }
        .swipe-accept span:first-child {
          background: var(--accent-green);
          color: white;
        }
        .swipe-decline {
          left: -20px;
          color: var(--status-busy);
        }
        .swipe-decline span:first-child {
          background: var(--status-busy);
          color: white;
        }
        .swipe-indicator.visible {
          opacity: 1;
        }
        .request-card {
          background: var(--bg-card);
          border-radius: 20px;
          overflow: hidden;
          box-shadow: var(--shadow-lg);
        }
        .request-image-container {
          position: relative;
          width: 100%;
          aspect-ratio: 3/4;
        }
        .request-user-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .verified-badge {
          position: absolute;
          bottom: 16px;
          right: 16px;
          width: 32px;
          height: 32px;
          background: var(--accent-green);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 18px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        .request-user-info {
          padding: 20px;
          text-align: center;
        }
        .request-name {
          font-size: 24px;
          font-weight: 700;
          color: var(--text-white);
          margin-bottom: 8px;
        }
        .request-message {
          font-size: 14px;
          color: var(--text-muted);
          margin-bottom: 16px;
          line-height: 1.4;
        }
        .request-interests {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 8px;
        }
        .interest-tag {
          padding: 8px 16px;
          background: var(--bg-input);
          border-radius: 20px;
          font-size: 13px;
          color: var(--text-light);
        }
        .next-card-preview {
          position: absolute;
          bottom: -60px;
          left: 50%;
          transform: translateX(-50%);
          width: 80%;
          height: 60px;
          border-radius: 20px 20px 0 0;
          overflow: hidden;
          opacity: 0.5;
          z-index: -1;
        }
        .next-card-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          filter: blur(2px);
        }
        .requests-actions {
          display: flex;
          justify-content: center;
          gap: 40px;
          padding: 24px;
          padding-bottom: calc(env(safe-area-inset-bottom, 20px) + 24px);
        }
        .action-btn {
          width: 70px;
          height: 70px;
          border-radius: 50%;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .action-btn:hover {
          transform: scale(1.1);
        }
        .action-btn:active {
          transform: scale(0.95);
        }
        .action-btn.decline {
          background: var(--bg-input);
          color: var(--text-muted);
        }
        .action-btn.decline:hover {
          background: var(--status-busy);
          color: white;
          box-shadow: 0 4px 20px rgba(255, 59, 48, 0.4);
        }
        .action-btn.accept {
          background: var(--accent-green);
          color: white;
          box-shadow: 0 4px 20px rgba(76, 217, 100, 0.4);
        }
        .action-btn.accept:hover {
          box-shadow: 0 6px 25px rgba(76, 217, 100, 0.5);
        }
        .empty-state {
          text-align: center;
          padding: 40px 20px;
        }
        .empty-state-icon {
          font-size: 64px;
          margin-bottom: 16px;
        }
        .empty-state-title {
          font-size: 20px;
          font-weight: 600;
          color: var(--text-white);
          margin-bottom: 8px;
        }
        .empty-state-text {
          font-size: 14px;
          color: var(--text-muted);
          margin-bottom: 24px;
        }
      `}</style>
    </div>
  );
};