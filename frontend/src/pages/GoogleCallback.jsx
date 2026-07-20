import { useEffect, useRef, useContext } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { consumeGoogleState, googleRedirectUri } from '../utils/googleAuth';

/**
 * Landing page for Google's auth-code redirect (see utils/googleAuth.js /
 * authController.googleLoginCode for why this replaced the popup flow).
 * Google sends the browser here with ?code=&state= on success, or ?error=
 * on cancel/denial. We validate the CSRF state, exchange the code for a
 * session server-side, and continue straight into the app — errors bounce
 * back to /login?error=google so the existing error UI there handles them.
 */
const GoogleCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithGoogleCode } = useContext(AuthContext);
  // StrictMode/dev double-invokes effects, and the code is single-use — guard
  // so a re-run doesn't burn it and cause a spurious "expired" failure.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const oauthError = searchParams.get('error'); // e.g. access_denied on cancel

    if (oauthError || !code || !consumeGoogleState(state)) {
      navigate('/login?error=google', { replace: true });
      return;
    }

    loginWithGoogleCode(code, googleRedirectUri())
      .then(() => navigate('/home', { replace: true }))
      .catch(() => navigate('/login?error=google', { replace: true }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100dvh',
      background: 'var(--bg-primary, #1a1a2e)',
      color: '#fff',
      padding: 20,
      textAlign: 'center',
    }}>
      <div className="loading-spinner" />
    </div>
  );
};

export default GoogleCallback;
