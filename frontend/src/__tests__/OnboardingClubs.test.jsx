import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// „Clubs für dich" — the extra page after onboarding (Tina's checklist
// 10.10.2026: „Clubs anzeigen, extra Seite … wir sortieren Clubs im Admin-
// Dashboard"). The admin's order, one button per club, joining needs a
// profile picture, and any trouble skips the page. Real German i18n.
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock('../utils/api', () => ({
  clubs: { getFeatured: vi.fn(), join: vi.fn() },
  auth: { updateProfile: vi.fn() },
  upload: { image: vi.fn() },
}));
vi.mock('../utils/images', () => ({
  downscaleImageFile: vi.fn(async (f) => f),
  thumbUrl: (u) => u,
  chatImageUrl: (u) => u,
  coverCardUrl: (u) => u,
}));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));

const { clubs, auth, upload } = await import('../utils/api');
const { OnboardingClubs } = await import('../pages/OnboardingClubs');

const ME = { id: 1301, name: 'Tina', avatar_url: '/media/uploads/me.webp', onboarding_completed: true };
const NO_PIC = { ...ME, avatar_url: null };
const CLUBS = [
  { id: 800, type: 'club', name: 'JAMIE Groups Official', is_private: false, members_count: 1204, location: 'Wien', image_url: '/media/uploads/c1.webp' },
  { id: 801, type: 'club', name: 'Laufclub Prater', is_private: false, members_count: 1, location: 'Wien', image_url: null },
  { id: 803, type: 'club', name: 'Spiele-Stammtisch', is_private: true, members_count: 24, location: '' },
];

const renderPage = async (user = ME, refreshProfile = vi.fn(async () => ({ ...user, avatar_url: '/media/uploads/new.webp' }))) => {
  const utils = render(
    <AuthContext.Provider value={{ user, refreshProfile, setUser: vi.fn() }}>
      <MemoryRouter initialEntries={['/onboarding/clubs']}>
        <Routes>
          <Route path="/onboarding/clubs" element={<OnboardingClubs />} />
          <Route path="/home" element={<div>HOME PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});
  return { ...utils, refreshProfile };
};

const card = (name) => screen.getByText(name, { selector: '.obc-card-title' }).closest('li');
const cardButton = (name) => within(card(name)).getByRole('button');
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const fail = (status, data) => Promise.reject({ response: { status, data } });

beforeEach(() => {
  vi.mocked(clubs.getFeatured).mockReset();
  vi.mocked(clubs.getFeatured).mockResolvedValue({ data: CLUBS });
  vi.mocked(clubs.join).mockReset();
  vi.mocked(clubs.join).mockResolvedValue({ data: { status: 'joined' } });
  vi.mocked(auth.updateProfile).mockReset();
  vi.mocked(auth.updateProfile).mockResolvedValue({ data: {} });
  vi.mocked(upload.image).mockReset();
  toast.error.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('OnboardingClubs — the list', () => {
  it('shows the curated clubs in the admin order, Home-card style, one button each', async () => {
    await renderPage();
    expect(screen.getByText('Clubs')).toBeTruthy();
    expect(screen.getByText('für dich')).toBeTruthy();
    expect([...document.querySelectorAll('.obc-card-title')].map((h) => h.textContent))
      .toEqual(['JAMIE Groups Official', 'Laufclub Prater', 'Spiele‑Stammtisch']);
    expect(within(card('JAMIE Groups Official')).getByText('1204 Mitglieder')).toBeTruthy();
    expect(within(card('Laufclub Prater')).getByText('1 Mitglied')).toBeTruthy();
    expect(within(card('JAMIE Groups Official')).getByText('📍 Wien')).toBeTruthy();
    expect(within(card('JAMIE Groups Official')).getByText('Öffentlich')).toBeTruthy();
    expect(within(card('Spiele‑Stammtisch')).getByText('Privat')).toBeTruthy();
    // Public → Beitreten, private → Anfragen.
    expect(cardButton('JAMIE Groups Official').textContent).toBe('Beitreten');
    expect(cardButton('Spiele‑Stammtisch').textContent).toBe('Anfragen');
    // No cover → the first letter instead of a broken picture.
    expect(within(card('Laufclub Prater')).getByText('L')).toBeTruthy();
    // Not a numbered step: no back button, no counter, profile line all green.
    expect(screen.queryByRole('button', { name: 'Zurück' })).toBeNull();
    expect(document.querySelector('.flow-header-count').textContent).toBe('');
    expect([...document.querySelectorAll('.step-progress-seg')].map((s) => s.dataset.state))
      .toEqual(['done', 'done', 'done', 'done']);
    expect(screen.queryByText('Achtung: Dein Profil ist nicht vollständig')).toBeNull();
  });

  it.each([
    ['an empty list', () => Promise.resolve({ data: [] })],
    ['a non-list answer', () => Promise.resolve({ data: { error: 'x' } })],
    ['an old server (no such route)', () => fail(404, { error: 'Route not found' })],
    ['a server error', () => fail(500, { error: 'Clubs konnten nicht geladen werden' })],
  ])('skips straight to Home on %s', async (_label, answer) => {
    vi.mocked(clubs.getFeatured).mockImplementationOnce(answer);
    await renderPage();
    await screen.findByText('HOME PAGE');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('starts each button from the caller\'s own state', async () => {
    vi.mocked(clubs.getFeatured).mockResolvedValueOnce({
      data: [
        { ...CLUBS[0], is_member: true },
        { ...CLUBS[1], join_request_status: 'pending' },
        { ...CLUBS[2], join_request_blocked: true, join_request_status: 'rejected' },
      ],
    });
    await renderPage();
    expect(cardButton('JAMIE Groups Official').textContent).toBe('Dabei');
    expect(cardButton('JAMIE Groups Official').disabled).toBe(true);
    expect(cardButton('Laufclub Prater').textContent).toBe('Angefragt');
    expect(cardButton('Laufclub Prater').disabled).toBe(true);
    expect(cardButton('Spiele‑Stammtisch').textContent).toBe('Nicht möglich');
    expect(cardButton('Spiele‑Stammtisch').disabled).toBe(true);
  });

  // CLUBS happens to be alphabetical AND id-ascending, so the test above would
  // also pass with a client-side sort. The admin's order is neither.
  it('keeps the server order even when it is neither alphabetical nor by id', async () => {
    vi.mocked(clubs.getFeatured).mockResolvedValueOnce({ data: [CLUBS[2], CLUBS[0], CLUBS[1]] });
    await renderPage();
    expect([...document.querySelectorAll('.obc-card-title')].map((h) => h.textContent))
      .toEqual(['Spiele‑Stammtisch', 'JAMIE Groups Official', 'Laufclub Prater']);
  });

  it('„Weiter" goes to Home', async () => {
    await renderPage();
    fireEvent.click(screen.getByText('Weiter', { selector: '.onboarding-footer button' }));
    await screen.findByText('HOME PAGE');
  });
});

describe('OnboardingClubs — joining', () => {
  it('a public club → Dabei; a private one → Angefragt', async () => {
    vi.mocked(clubs.join)
      .mockResolvedValueOnce({ data: { message: 'Joined club successfully', status: 'joined' } })
      .mockResolvedValueOnce({ data: { message: 'Join request sent', status: 'pending' } });
    await renderPage();
    fireEvent.click(cardButton('JAMIE Groups Official'));
    await waitFor(() => expect(cardButton('JAMIE Groups Official').textContent).toBe('Dabei'));
    expect(clubs.join).toHaveBeenLastCalledWith(800);
    fireEvent.click(cardButton('Spiele‑Stammtisch'));
    await waitFor(() => expect(cardButton('Spiele‑Stammtisch').textContent).toBe('Angefragt'));
    expect(clubs.join).toHaveBeenLastCalledWith(803);
    // No leave toggle: a joined card stays put.
    fireEvent.click(cardButton('JAMIE Groups Official'));
    expect(clubs.join).toHaveBeenCalledTimes(2);
  });

  it('a double tap sends ONE request', async () => {
    const d = deferred();
    vi.mocked(clubs.join).mockReturnValueOnce(d.promise);
    await renderPage();
    const btn = cardButton('JAMIE Groups Official');
    // Both taps inside one act: React has not re-rendered (nor disabled the
    // button) in between — the per-card in-flight guard has to catch it.
    const disabledBetween = [];
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      disabledBetween.push(btn.disabled);
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(disabledBetween).toEqual([false]);
    expect(clubs.join).toHaveBeenCalledTimes(1);
    fireEvent.click(btn);
    expect(clubs.join).toHaveBeenCalledTimes(1);
    expect(cardButton('JAMIE Groups Official').getAttribute('aria-busy')).toBe('true');
    await act(async () => { d.resolve({ data: { status: 'joined' } }); });
    expect(cardButton('JAMIE Groups Official').textContent).toBe('Dabei');
    expect(clubs.join).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['JOIN_REQUEST_BLOCKED', 403, { error: 'Deine Anfrage wurde schon zweimal abgelehnt.', code: 'JOIN_REQUEST_BLOCKED' }, 'Nicht möglich'],
    // Coded refusals (server since 2026-10) — the code decides, not the text.
    ['ALREADY_MEMBER', 400, { error: 'x', code: 'ALREADY_MEMBER' }, 'Dabei'],
    ['JOIN_REQUEST_PENDING', 400, { error: 'x', code: 'JOIN_REQUEST_PENDING' }, 'Angefragt'],
    ['CLUB_FULL', 400, { error: 'x', code: 'CLUB_FULL' }, 'Voll'],
    // An older server: only the sentence.
    ['Already a member', 400, { error: 'Already a member' }, 'Dabei'],
    ['a pending request', 400, { error: 'Beitrittsanfrage bereits ausstehend' }, 'Angefragt'],
    ['a full club', 400, { error: 'Club is full' }, 'Voll'],
  ])('maps %s onto the button', async (_label, status, data, label) => {
    vi.mocked(clubs.join).mockImplementationOnce(() => fail(status, data));
    await renderPage();
    fireEvent.click(cardButton('Laufclub Prater'));
    await waitFor(() => expect(cardButton('Laufclub Prater').textContent).toBe(label));
    expect(cardButton('Laufclub Prater').disabled).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('anything else is a toast and the button is usable again', async () => {
    vi.mocked(clubs.join).mockImplementationOnce(() => fail(500, { error: 'Beitritt fehlgeschlagen' }));
    await renderPage();
    fireEvent.click(cardButton('Laufclub Prater'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Beitritt fehlgeschlagen'));
    expect(cardButton('Laufclub Prater').textContent).toBe('Beitreten');
    expect(cardButton('Laufclub Prater').disabled).toBe(false);
  });

  it('the join cap (JOIN_CAP_REACHED) is a translated toast, not the raw server text', async () => {
    vi.mocked(clubs.join).mockImplementationOnce(() => fail(403, { error: 'raw server text', code: 'JOIN_CAP_REACHED' }));
    await renderPage();
    fireEvent.click(cardButton('Laufclub Prater'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Du bist diesem Club bereits zweimal beigetreten und kannst ihm nicht erneut beitreten.'));
  });

  it('offline: the translated network message', async () => {
    vi.mocked(clubs.join).mockImplementationOnce(() => Promise.reject(new Error('Network Error')));
    await renderPage();
    fireEvent.click(cardButton('Laufclub Prater'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error.mock.calls[0][0]).not.toBe('Network Error');
  });

  it('the server\'s requiresAvatar opens the Achtung sheet', async () => {
    vi.mocked(clubs.join).mockImplementationOnce(() => fail(403, { error: 'Bitte lade zuerst ein Profilbild hoch, um beizutreten.', requiresAvatar: true }));
    await renderPage();
    fireEvent.click(cardButton('Laufclub Prater'));
    expect(await screen.findByRole('dialog', { name: 'Achtung: Dein Profil ist nicht vollständig' })).toBeTruthy();
    expect(cardButton('Laufclub Prater').textContent).toBe('Beitreten');
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('OnboardingClubs — without a profile picture', () => {
  it('shows the Achtung card; the line has one segment to go', async () => {
    await renderPage(NO_PIC);
    expect(screen.getByText('Achtung: Dein Profil ist nicht vollständig')).toBeTruthy();
    expect(screen.getByText('Füge ein Profilbild hinzu, um Gruppen & Clubs beizutreten.')).toBeTruthy();
    expect([...document.querySelectorAll('.step-progress-seg')].map((s) => s.dataset.state))
      .toEqual(['done', 'done', 'done', 'upcoming']);
  });

  it('a join asks for the picture first and sends nothing; „Überspringen" forgets that club', async () => {
    await renderPage(NO_PIC);
    fireEvent.click(cardButton('JAMIE Groups Official'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(clubs.join).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(clubs.join).not.toHaveBeenCalled();
    expect(cardButton('JAMIE Groups Official').textContent).toBe('Beitreten');
  });

  it('sheet → picker (synchronously) → upload → avatar only → refresh → the remembered join', async () => {
    const { refreshProfile } = await renderPage(NO_PIC);
    fireEvent.click(cardButton('JAMIE Groups Official'));
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Profilbild hinzufügen' }));
    expect(click).toHaveBeenCalledTimes(1);
    const input = click.mock.contexts[0];
    expect(input.type).toBe('file');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(input.isConnected).toBe(true);

    vi.mocked(upload.image).mockResolvedValueOnce({ data: { url: '/media/uploads/new.webp' } });
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'me.png', { type: 'image/png' })] } });
    });
    await waitFor(() => expect(cardButton('JAMIE Groups Official').textContent).toBe('Dabei'));
    expect(upload.image).toHaveBeenCalledWith(expect.any(File), 'avatar');
    // avatar_url ONLY — a photos field would replace the stored photo list.
    expect(auth.updateProfile).toHaveBeenCalledWith({ avatar_url: '/media/uploads/new.webp' });
    expect(refreshProfile).toHaveBeenCalled();
    expect(clubs.join).toHaveBeenCalledTimes(1);
    expect(clubs.join).toHaveBeenCalledWith(800);
    // Picture saved: the warning goes, the line turns all green.
    expect(screen.queryByText('Füge ein Profilbild hinzu, um Gruppen & Clubs beizutreten.')).toBeNull();
    expect(document.querySelectorAll('.step-progress-seg--done')).toHaveLength(4);
  });

  it('the Achtung card\'s own button opens the picker too; no join follows', async () => {
    await renderPage(NO_PIC);
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    fireEvent.click(screen.getByText('Profilbild hinzufügen', { selector: '.obc-warning-btn' }));
    expect(click).toHaveBeenCalledTimes(1);
    vi.mocked(upload.image).mockResolvedValueOnce({ data: { url: '/media/uploads/new.webp' } });
    await act(async () => {
      fireEvent.change(click.mock.contexts[0], { target: { files: [new File(['x'], 'me.png', { type: 'image/png' })] } });
    });
    await waitFor(() => expect(auth.updateProfile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Füge ein Profilbild hinzu, um Gruppen & Clubs beizutreten.')).toBeNull());
    expect(clubs.join).not.toHaveBeenCalled();
  });

  it('an upload that lands after „Weiter" still saves the picture, but sends no join from the gone page', async () => {
    const up = deferred();
    vi.mocked(upload.image).mockReturnValueOnce(up.promise);
    await renderPage(NO_PIC);
    fireEvent.click(cardButton('JAMIE Groups Official'));
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Profilbild hinzufügen' }));
    await act(async () => {
      fireEvent.change(click.mock.contexts[0], { target: { files: [new File(['x'], 'me.png', { type: 'image/png' })] } });
    });
    fireEvent.click(screen.getByText('Weiter', { selector: '.onboarding-footer button' }));
    await screen.findByText('HOME PAGE');
    await act(async () => { up.resolve({ data: { url: '/media/uploads/late.webp' } }); });
    await waitFor(() => expect(auth.updateProfile).toHaveBeenCalledWith({ avatar_url: '/media/uploads/late.webp' }));
    await act(async () => {});
    expect(clubs.join).not.toHaveBeenCalled();
  });

  it('a picture the server refuses (quality gate) is a toast, and the join is dropped', async () => {
    vi.mocked(auth.updateProfile).mockImplementationOnce(() => fail(422, { error: 'Bitte lade ein echtes Foto von dir hoch.', requiresAvatar: true }));
    const { refreshProfile } = await renderPage(NO_PIC);
    fireEvent.click(cardButton('JAMIE Groups Official'));
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Profilbild hinzufügen' }));
    vi.mocked(upload.image).mockResolvedValueOnce({ data: { url: '/media/uploads/flat.webp' } });
    await act(async () => {
      fireEvent.change(click.mock.contexts[0], { target: { files: [new File(['x'], 'flat.png', { type: 'image/png' })] } });
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Bitte lade ein echtes Foto von dir hoch.'));
    expect(clubs.join).not.toHaveBeenCalled();
    expect(refreshProfile).not.toHaveBeenCalled();
    expect(screen.getByText('Füge ein Profilbild hinzu, um Gruppen & Clubs beizutreten.')).toBeTruthy();
  });
});
