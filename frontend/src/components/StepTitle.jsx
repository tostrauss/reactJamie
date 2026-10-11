/**
 * Two-tone step headline: first line white, second line coral in the
 * wordmark's Archivo 900 italic — the split every titleLine1/titleLine2 i18n
 * pair carries. Moved out of pages/Onboarding.jsx so Register, Onboarding and
 * the onboarding clubs page share one heading (same markup and classes).
 * The .ob-title* rules live in styles/auth.css, which App.jsx loads globally.
 * `id` lets a step reference its heading (aria-labelledby).
 * The {' '} between the lines is for the accessible name only: without it a
 * screen reader reads „Werbist du?". The spans are display:block, so the
 * whitespace-only text between them never renders.
 */
export function StepTitle({ line1, line2, id, className = '' }) {
  return (
    <h1 className={`ob-title${className ? ` ${className}` : ''}`} id={id}>
      <span className="ob-title-line">{line1}</span>{' '}
      <span className="ob-title-line ob-title-accent">{line2}</span>
    </h1>
  );
}

export default StepTitle;
