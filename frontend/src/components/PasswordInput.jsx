import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * PasswordInput — a password field with a show/hide eye toggle.
 *
 * Drop-in replacement for <input type="password" />: forwards every prop
 * (value, onChange, placeholder, className, autoComplete, required, name…) to
 * the underlying input, so each call site keeps its own styling. The input
 * carries `data-sentry-mask` so Session Replay keeps it masked even while the
 * user has it revealed as plain text (see main.jsx replay mask config).
 */
export const PasswordInput = ({ className = '', wrapperStyle, style, ...props }) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-input-wrap" style={wrapperStyle}>
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={className}
        // Inline padding-right reserves room for the eye regardless of which
        // stylesheet (.form-group input / .settings-input) styles this input.
        style={{ ...style, paddingRight: 44 }}
        data-sentry-mask
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? t('common.hidePassword') : t('common.showPassword')}
        title={visible ? t('common.hidePassword') : t('common.showPassword')}
        tabIndex={-1}
      >
        {visible ? (
          // eye-off
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          // eye
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
};

export default PasswordInput;
