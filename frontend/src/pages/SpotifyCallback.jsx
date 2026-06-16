import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { spotify } from '../utils/api';
import { useToast } from '../context/ToastContext';

const SpotifyCallback = () => {
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const { t } = useTranslation();
  const [status, setStatus] = useState('connecting');

  // No navigation here: on the iOS home-screen PWA this page runs in an
  // isolated in-app browser with no session, so navigating to a protected page
  // would bounce to /login. We finish the exchange (identity comes from the
  // state nonce) and ask the user to close the window. ProfileEdit re-checks
  // the connection when it becomes visible again.
  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      toast.error(t('spotify.callback.cancelled'));
      return;
    }

    if (!code) {
      setStatus('error');
      toast.error(t('spotify.callback.noCode'));
      return;
    }

    const exchangeCode = async () => {
      try {
        const res = await spotify.handleCallback(code, state);
        setStatus('success');
        toast.success(res.data.message || t('spotify.callback.connectedToast'));
      } catch (err) {
        setStatus('error');
        toast.error(err.response?.data?.error || t('spotify.callback.connectError'));
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
          <p style={{ color: 'var(--text-muted, #9BA2B0)' }}>{t('spotify.callback.closeWindow')}</p>
        </>
      )}
      {status === 'error' && (
        <>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>❌</div>
          <h2 style={{ marginBottom: '8px' }}>{t('spotify.callback.errorTitle')}</h2>
          <p style={{ color: 'var(--text-muted, #9BA2B0)' }}>{t('spotify.callback.closeWindow')}</p>
        </>
      )}
    </div>
  );
};

export default SpotifyCallback;
