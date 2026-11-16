import { describe, it, expect, vi, afterEach } from 'vitest';
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

// Ziel 4 (Tina 16.11.2026): what a card is must be clear WHILE swiping, so
// the type sits in the card — a band on top and a frame in the type's colour
// — and moves with it. The labels come from the server's facts only
// (getAllJoinRequests: group_type, group_club_type, parent_club_type,
// is_partner); dates are the stored Vienna wall-clock, read in UTC.
const card = () => document.querySelector('.request-card');
const band = () => document.querySelector('.request-type-band');
const join = (o = {}) => ({
  ...base, group_id: 7, group_name: 'Laufen (easy)', group_type: 'group', group_image: null,
  group_date: '2026-11-21T00:00:00.000Z', group_recurring: false, group_club_type: null,
  parent_club_id: null, parent_club_name: null, parent_club_image: null, parent_club_type: null,
  is_partner: false, ...o,
});
const clubEvent = (o = {}) => join({
  group_type: 'event', group_name: 'Punsch Night', group_date: '2026-11-21T19:00:00.000Z',
  parent_club_id: 3, parent_club_name: 'Café Soleá', parent_club_type: 'community', ...o,
});

describe('RequestCard — the type band (Ziel 4)', () => {
  // Monday 16.11.2026, 11:00 in Vienna. Only Date is faked.
  const at = (iso = '2026-11-16T10:00:00Z') => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
  };
  afterEach(() => { vi.useRealTimers(); });

  it('a friend request: „👋 Freundschaftsanfrage“, a neutral frame, no group in sight', () => {
    renderCard({ ...base, kind: 'friend' });
    expect(card()).toHaveClass('request-card--typed', 'request-card--friend');
    expect(band().querySelector('.request-type-band-thumb').textContent).toBe('👋');
    expect(band().textContent).toContain('Freundschaftsanfrage');
    expect(band().textContent).toContain('möchte mit dir befreundet sein');
    expect(document.querySelector('.request-type-band-name')).toBeNull();
    expect(screen.queryByText('Beitrittsanfrage')).toBeNull();
  });

  it('a group: „🔒 Beitrittsanfrage“, its name, „Gruppe“ and the day — a meetup has no time', () => {
    at();
    renderCard(join());
    expect(card()).toHaveClass('request-card--typed', 'request-card--group');
    expect(band().textContent).toContain('Beitrittsanfrage');
    expect(document.querySelector('.request-type-band-name').textContent).toBe('Laufen (easy)');
    expect(screen.getByText('Gruppe')).toHaveClass('chat-type-badge', 'group-badge');
    expect(document.querySelector('.request-type-band-date').textContent).toBe('21. Nov.');
  });

  it('an event of a community: „Community-Event“, with the time', () => {
    at();
    renderCard(clubEvent());
    expect(card()).toHaveClass('request-card--group');
    expect(screen.getByText('Community-Event')).toBeInTheDocument();
    expect(document.querySelector('.request-type-band-date').textContent).toBe('21. Nov., 19:00');
  });

  it('a member\'s event in an official club: „Club-Event“', () => {
    renderCard(clubEvent({ parent_club_type: 'official' }));
    expect(screen.getByText('Club-Event')).toBeInTheDocument();
    expect(card()).toHaveClass('request-card--group');
  });

  it('a partner\'s event: „☆ Partner“ in the partner yellow — the card framed in it too', () => {
    renderCard(clubEvent({ parent_club_type: 'official', is_partner: true }));
    expect(card()).toHaveClass('request-card--partner');
    expect(band().querySelector('.partner-badge')).toBeTruthy();
    expect(screen.getByText('Event eines JAMIE-Partners')).toBeInTheDocument();
    expect(screen.queryByText('Club-Event')).toBeNull();
  });

  it('a club and a community — purple, never a date (a club\'s date is only its next meetup)', () => {
    const { unmount } = renderCard(join({ group_type: 'club', group_name: 'Lauftreff', group_club_type: 'official', group_date: '2026-11-21T18:00:00.000Z' }));
    expect(card()).toHaveClass('request-card--club');
    expect(screen.getByText('Club')).toHaveClass('club-badge');
    expect(document.querySelector('.request-type-band-date')).toBeNull();
    unmount();
    renderCard(join({ group_type: 'club', group_name: 'Brettspiel-Runde', group_club_type: null }));
    expect(screen.getByText('Community')).toHaveClass('club-badge');
  });

  it('the day as the creator typed it — a late event stays on its day (UTC reading)', () => {
    at();
    renderCard(clubEvent({ group_date: '2026-11-21T23:30:00.000Z' }));
    expect(document.querySelector('.request-type-band-date').textContent).toBe('21. Nov., 23:30');
  });

  it('„Heute“ and „Morgen“ on the Vienna day', () => {
    at();
    const { unmount } = renderCard(clubEvent({ group_date: '2026-11-16T19:00:00.000Z' }));
    expect(document.querySelector('.request-type-band-date').textContent).toBe('Heute, 19:00');
    unmount();
    renderCard(join({ group_date: '2026-11-17T00:00:00.000Z' }));
    expect(document.querySelector('.request-type-band-date').textContent).toBe('Morgen');
  });

  it('a weekly series shows its next date, not the first one', () => {
    at();
    renderCard(join({ group_date: '2026-11-02T00:00:00.000Z', group_recurring: true }));
    expect(document.querySelector('.request-type-band-date').textContent).toBe('23. Nov.');
  });

  it('the picture: the group\'s own, else the club\'s, else its initial', () => {
    const { unmount } = renderCard(clubEvent({ group_image: '/media/uploads/punsch.webp', parent_club_image: '/media/uploads/solea.webp' }));
    expect(document.querySelector('.request-type-band-thumb img')).toHaveAttribute('src', '/media/uploads/punsch.webp?size=thumb');
    unmount();
    const second = renderCard(clubEvent({ parent_club_image: '/media/uploads/solea.webp' }));
    expect(document.querySelector('.request-type-band-thumb img')).toHaveAttribute('src', '/media/uploads/solea.webp?size=thumb');
    second.unmount();
    renderCard(clubEvent());
    expect(document.querySelector('.request-type-band-thumb').textContent).toBe('P');
  });

  it('a payload without kind or group (a server before 16.11.) keeps the plain card', () => {
    renderCard(base);
    expect(band()).toBeNull();
    expect(card()).not.toHaveClass('request-card--typed');
  });
});
