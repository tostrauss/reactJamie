import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RequestCard } from '../components/RequestCard';

// The "Anfragen" swipe deck card — the seal and the Abzeichen-Stufe are
// independent (tester 06.10.2026): either can appear without the other, and an
// older server that does not send the field renders exactly as before. The
// level comes from user_attendance_step (five steps since 18.10.2026);
// user_attendance_tier is the old bundles' three-step scale and never read.
const base = { id: 1, user_id: 2, user_name: 'Anna', user_avatar: null, user_age: 24, user_interests: '[]' };
const renderCard = (request) => render(<MemoryRouter><RequestCard request={request} /></MemoryRouter>);

describe('RequestCard', () => {
  it('a step without the seal', () => {
    renderCard({ ...base, user_trusted: false, user_attendance_tier: 3, user_attendance_step: 5 });
    expect(screen.getByRole('img', { name: /mindestens 100-mal bestätigt/ })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Verifiziert' })).toBeNull();
  });

  it('🌟 for 25 meetups — where the old three-step field says 2', () => {
    renderCard({ ...base, user_trusted: false, user_attendance_tier: 2, user_attendance_step: 3 });
    expect(screen.getByRole('img', { name: /mindestens 25-mal bestätigt/ })).toBeTruthy();
  });

  it('the seal without a step', () => {
    renderCard({ ...base, user_trusted: true, user_attendance_tier: 0, user_attendance_step: 0 });
    expect(screen.getByRole('img', { name: 'Verifiziert' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: /bestätigt dabei/ })).toBeNull();
  });

  it('an old payload without the field renders no step', () => {
    renderCard({ ...base, user_trusted: true });
    expect(screen.queryByRole('img', { name: /bestätigt dabei/ })).toBeNull();
  });

  it('never reads the three-step *_tier field on the five-step ladder (a 3 there is 🎆, not 🌟)', () => {
    renderCard({ ...base, user_trusted: true, user_attendance_tier: 3 });
    expect(screen.queryByRole('img', { name: /bestätigt dabei/ })).toBeNull();
  });
});
