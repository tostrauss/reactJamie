import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { spotify } from '../utils/api';
import { useToast } from '../context/ToastContext';

const SpotifyCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      toast.error('Spotify-Verbindung abgebrochen');
      setTimeout(() => navigate('/profile/edit'), 2000);
      return;
    }

    if (!code) {
      setStatus('error');
      toast.error('Kein Autorisierungscode erhalten');
      setTimeout(() => navigate('/profile/edit'), 2000);
      return;
    }

    const exchangeCode = async () => {
      try {
        const res = await spotify.handleCallback(code, state);
        setStatus('success');
        toast.success(res.data.message || 'Spotify erfolgreich verbunden!');
        setTimeout(() => navigate('/profile/edit'), 1500);
      } catch (err) {
        setStatus('error');
        toast.error(err.response?.data?.error || 'Spotify-Verbindung fehlgeschlagen');
        setTimeout(() => navigate('/profile/edit'), 2000);
      }
    };

    exchangeCode();
  }, [searchParams]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'var(--bg-primary, #1a1a2e)',
      color: '#fff',
      padding: '20px',
      textAlign: 'center'
    }}>
      {status === 'connecting' && (
        <>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎵</div>
          <h2 style={{ marginBottom: '8px' }}>Verbinde mit Spotify...</h2>
          <p style={{ color: 'var(--text-muted, #9BA2B0)' }}>Bitte warten</p>
          <div className="loading-spinner" style={{ marginTop: '20px' }} />
        </>
      )}
      {status === 'success' && (
        <>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
          <h2 style={{ marginBottom: '8px' }}>Spotify verbunden!</h2>
          <p style={{ color: 'var(--text-muted, #9BA2B0)' }}>Du wirst weitergeleitet...</p>
        </>
      )}
      {status === 'error' && (
        <>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>❌</div>
          <h2 style={{ marginBottom: '8px' }}>Verbindung fehlgeschlagen</h2>
          <p style={{ color: 'var(--text-muted, #9BA2B0)' }}>Du wirst weitergeleitet...</p>
        </>
      )}
    </div>
  );
};

export default SpotifyCallback;
