import React from 'react';
import { captureException } from '../utils/sentry';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    captureException(error, { extra: errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '20px',
          background: '#1a1a2e',
          color: '#fff',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>Hoppla!</div>
          <h1 style={{ fontSize: '24px', marginBottom: '12px' }}>Etwas ist schiefgelaufen</h1>
          <p style={{ color: '#9BA2B0', marginBottom: '24px', maxWidth: '400px' }}>
            Ein unerwarteter Fehler ist aufgetreten. Bitte versuche die Seite neu zu laden.
          </p>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '12px 24px',
                borderRadius: '12px',
                border: 'none',
                background: '#FD7666',
                color: '#fff',
                fontSize: '16px',
                cursor: 'pointer'
              }}
            >
              Seite neu laden
            </button>
            <button
              onClick={this.handleReset}
              style={{
                padding: '12px 24px',
                borderRadius: '12px',
                border: '1px solid #333',
                background: 'transparent',
                color: '#9BA2B0',
                fontSize: '16px',
                cursor: 'pointer'
              }}
            >
              Nochmal versuchen
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
