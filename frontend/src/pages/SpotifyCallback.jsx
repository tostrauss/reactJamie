import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { spotify } from '../utils/api';
import { useToast } from '../context/ToastContext';

const SpotifyCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      toast.error(t('spotify.callback.cancelled'));
      setTimeout(() => navigate('/profile/edit'), 2000);
      return;
    }

    if (!code) {
      setStatus('error');
      toast.error(t('spotify.callback.noCode'));
      setTimeout(() => navigate('/profile/edit'), 2000);
      return;
    }

    const exchangeCode = async () => {
      try {
        const res = await spotify.handleCallback(code, state);
        setStatus('success');
        toast.success(res.data.message || t('spotify.callback.connectedToast'));
        setTimeout(() => navigate('/profile/edit'), 1500);
      } catch (err) {
        setStatus('error');
        toast.error(err.response?.data?.error || t('spotify.callback.connectError'));
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
          <h2 style={{ marginBottom: '8px' }}>{t('spotify.callback.connecting')}</h2>
          <p style={{ color: 'var(--text-muted, #9BA2B0)' }}>{t('spotify.callback.pleaseWait')}</p>
          <div className="loading-spinner" style={{ marginTop: '20px' }} />
        </>
      )}
      {status === 'success' && (
        <>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
          <h2 style={{ marginBottom: '8px' }}>{t('spotify.callback.successTitle')}</h2>
          <p style={{ color: 'var(--text-muted, #9BA2B0)' }}>{t('spotify.callback.redirecting')}</p>
        </>
      )}
      {status === 'error' && (
        <>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>❌</div>
          <h2 style={{ marginBottom: '8px' }}>{t('spotify.callback.errorTitle')}</h2>
          <p style={{ color: 'var(--text-muted, #9BA2B0)' }}>{t('spotify.callback.redirecting')}</p>
        </>
      )}
    </div>
  );
};

export default SpotifyCallback;
