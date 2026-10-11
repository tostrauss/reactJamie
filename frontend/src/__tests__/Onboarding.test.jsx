import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// Onboarding-Umbau 11.10.2026 (Tina's checklist): ① Was trifft zu? ②
// Interessen ③ Über dich ④ Fotos LAST, the „Achtung" sheet instead of the
// false „Du kannst jetzt Gruppen beitreten", then /onboarding/clubs.
// Real German i18n (vitest.setup).
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
// In-memory storage behind safeStorage: this test runtime's localStorage is
// not dependable (same approach as pushNotifications.test.js).
const store = vi.hoisted(() => new Map());
const storage = vi.hoisted(() => ({
  getItem: vi.fn((k) => (store.has(k) ? store.get(k) : null)),
  setItem: vi.fn((k, v) => { store.set(k, String(v)); }),
  removeItem: vi.fn((k) => { store.delete(k); }),
}));
vi.mock('../utils/safeStorage', () => ({ safeStorage: storage, safeSession: storage, default: storage }));
vi.mock('../utils/api', () => ({
  api: { put: vi.fn(), post: vi.fn(() => Promise.resolve({ data: {} })) },
  upload: { image: vi.fn() },
}));
vi.mock('../utils/images', () => ({
  downscaleImageFile: vi.fn(async (f) => f),
  thumbUrl: (u) => u,
  chatImageUrl: (u) => u,
  coverCardUrl: (u) => u,
}));
vi.mock('../utils/googleMaps', () => ({ loadGoogleMaps: vi.fn(), onGoogleMapsReady: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
// The photo step warms the clubs page's lazy chunk (shared loader).
const clubsChunk = vi.hoisted(() => vi.fn(() => Promise.resolve({ default: () => null })));
vi.mock('../utils/onboardingClubsChunk', () => ({ loadOnboardingClubs: clubsChunk }));
// nav.hold = the router keeps the old screen up after navigate() (a lazy
// route suspending inside React Router's transition): the call is recorded,
// the route does not change.
const nav = vi.hoisted(() => ({ hold: false, calls: [] }));
vi.mock('react-router-dom', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    useNavigate: () => {
      const real = mod.useNavigate();
      return (...args) => { nav.calls.push(args); if (!nav.hold) real(...args); };
    },
  };
});

const { api, upload } = await import('../utils/api');
const { Onboarding } = await import('../pages/Onboarding');
const { loadOnboardingDraft, saveOnboardingDraft, sanitizeDraftForm, draftKey, DRAFT_MAX_AGE_MS } = await import('../utils/onboardingDraft');

// Straight out of Register: email sign-up, so birth date and gender are set.
const NEW_USER = {
  id: 1301, name: 'Tina', email: 'tina@example.com', date_of_birth: '1994-05-12', gender: 'female',
  location: 'Wien, Österreich', bio: '', interests: [], photos: [], avatar_url: null,
  onboarding_completed: false,
};
// Google sign-up: no birth date, no gender, the Google picture as avatar.
const GOOGLE_PIC = 'https://lh3.googleusercontent.com/a/ACg8ocK=s96-c';
const GOOGLE_USER = { ...NEW_USER, id: 1302, date_of_birth: null, gender: null, avatar_url: GOOGLE_PIC, location: '' };

const FALSE_SENTENCE = /Du kannst jetzt Gruppen beitreten/;
const SNOOZE_KEY = 'jamie_avatar_nudge_next';

const renderOnboarding = async (user = NEW_USER, refreshProfile = vi.fn(async () => ({ ...user, onboarding_completed: true }))) => {
  const utils = render(
    <AuthContext.Provider value={{ user, refreshProfile, setUser: vi.fn() }}>
      <MemoryRouter initialEntries={['/onboarding']}>
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/onboarding/clubs" element={<div>CLUBS PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});
  return { ...utils, refreshProfile };
};

// Text queries for the walk-through (getByRole recomputes every accessible
// name on each call — slow with 25 chips); the role semantics are asserted
// where they are the point.
const counter = (text) => screen.getByText(text, { selector: '.flow-header-count' });
const weiter = () => screen.getByText('Weiter', { selector: '.onboarding-footer button' });
const finishBtn = () => screen.getByText("Los geht's! 🚀", { selector: '.onboarding-footer button' });
const goal = (name) => screen.getByText(name, { selector: '.ob-goal-label' }).closest('button');
const chip = (name) => screen.getByText(name, { selector: 'button.ob-chip' });
const fileInput = () => document.querySelector('input[type="file"]');
const pickFile = async (url, name = 'me.png') => {
  vi.mocked(upload.image).mockResolvedValueOnce({ data: { url } });
  await act(async () => {
    fireEvent.change(fileInput(), { target: { files: [new File(['x'], name, { type: 'image/png' })] } });
  });
};

// ① + ② (+ ③ as the user's data needs) → the photo step.
const toPhotos = async ({ gender, dob } = {}) => {
  fireEvent.click(goal('Neue Freundschaften schließen'));
  fireEvent.click(weiter());
  ['Wandern', 'Kochen', 'Tanzen'].forEach((n) => fireEvent.click(chip(n)));
  fireEvent.click(weiter());
  if (gender) fireEvent.click(screen.getByRole('radio', { name: gender }));
  if (dob) fireEvent.change(screen.getByLabelText('Geburtsdatum'), { target: { value: dob } });
  fireEvent.click(weiter());
  expect(counter('4 / 4')).toBeTruthy();
};

const lastPut = () => {
  const calls = vi.mocked(api.put).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const [url, body] = calls[calls.length - 1];
  expect(url).toBe('/auth/onboarding');
  return body;
};

beforeEach(() => {
  store.clear();
  nav.hold = false;
  nav.calls.length = 0;
  vi.mocked(api.put).mockReset();
  vi.mocked(api.put).mockResolvedValue({ data: {} });
  vi.mocked(upload.image).mockReset();
  toast.error.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Onboarding — the four steps', () => {
  it('① „Was trifft zu?" comes first: multi-select, Weiter only with at least one', async () => {
    await renderOnboarding();
    expect(counter('1 / 4')).toBeTruthy();
    expect(screen.getByText('Was trifft')).toBeTruthy();
    // GDPR Art. 13 at the point of collection: what the answer is for, and
    // that nobody else sees it (admins only get the aggregate counts).
    expect(screen.getByText('Mehrfachauswahl möglich · hilft uns, JAMIE besser zu machen – für andere nicht sichtbar')).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    expect(screen.getByRole('checkbox', { name: 'Neue Freundschaften schließen' })).toBe(goal('Neue Freundschaften schließen'));
    expect(weiter().disabled).toBe(true);
    expect(screen.getByText('Wähle mindestens eins')).toBeTruthy();
    // No back button on the first step.
    expect(screen.queryByRole('button', { name: 'Zurück' })).toBeNull();

    fireEvent.click(goal('Neu in der Stadt und möchte Anschluss finden'));
    fireEvent.click(goal('Neue Orte und Veranstaltungen entdecken'));
    expect(goal('Neu in der Stadt und möchte Anschluss finden').getAttribute('aria-checked')).toBe('true');
    expect(goal('Neue Orte und Veranstaltungen entdecken').getAttribute('aria-checked')).toBe('true');
    expect(goal('Neue Freundschaften schließen').getAttribute('aria-checked')).toBe('false');
    expect(weiter().disabled).toBe(false);
    expect(screen.queryByText('Wähle mindestens eins')).toBeNull();

    // Unticking the last one locks Weiter again.
    fireEvent.click(goal('Neu in der Stadt und möchte Anschluss finden'));
    fireEvent.click(goal('Neue Orte und Veranstaltungen entdecken'));
    expect(weiter().disabled).toBe(true);
  });

  it('② interests need three — a typed-but-unconfirmed one counts and is kept', async () => {
    await renderOnboarding();
    fireEvent.click(goal('Neue Freundschaften schließen'));
    fireEvent.click(weiter());
    expect(counter('2 / 4')).toBeTruthy();
    expect(screen.getByText('Worauf hast')).toBeTruthy();
    expect(weiter().disabled).toBe(true);
    fireEvent.click(chip('Wandern'));
    fireEvent.click(chip('Kochen'));
    expect(weiter().disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Eigenes Interesse hinzufügen'), { target: { value: 'Klettern' } });
    expect(weiter().disabled).toBe(false);
    fireEvent.click(weiter());
    expect(counter('3 / 4')).toBeTruthy();
    // Back keeps the answers, including the custom one Weiter added.
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }));
    expect(chip('Klettern').getAttribute('aria-pressed')).toBe('true');
    expect(chip('Wandern').getAttribute('aria-pressed')).toBe('true');
  });

  it('③ an email sign-up is not asked for gender or birth date again', async () => {
    await renderOnboarding();
    fireEvent.click(goal('Neue Freundschaften schließen'));
    fireEvent.click(weiter());
    ['Wandern', 'Kochen', 'Tanzen'].forEach((n) => fireEvent.click(chip(n)));
    fireEvent.click(weiter());
    expect(counter('3 / 4')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByLabelText('Geburtsdatum')).toBeNull();
    expect(screen.getByLabelText('Wohnort').value).toBe('Wien, Österreich');
    expect(weiter().disabled).toBe(false);
  });

  it('③ a Google sign-up picks a gender bubble and gives an 18+ birth date', async () => {
    await renderOnboarding(GOOGLE_USER);
    fireEvent.click(goal('Neue Freundschaften schließen'));
    fireEvent.click(weiter());
    ['Wandern', 'Kochen', 'Tanzen'].forEach((n) => fireEvent.click(chip(n)));
    fireEvent.click(weiter());
    const group = screen.getByRole('radiogroup', { name: 'Geschlecht' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['♂︎Männlich', '♀︎Weiblich', '⚧︎Divers']);
    expect(weiter().disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Divers' }));
    expect(screen.getByRole('radio', { name: 'Divers' }).getAttribute('aria-checked')).toBe('true');
    // Selected look as on Register: the tick replaces the glyph.
    expect(screen.getByRole('radio', { name: 'Divers' }).textContent).toBe('Divers');
    expect(screen.getByRole('radio', { name: 'Divers' }).querySelector('.ob-bubble-icon svg')).toBeTruthy();
    expect(weiter().disabled).toBe(true); // birth date still missing
    const dob = screen.getByLabelText('Geburtsdatum');
    const year = new Date().getFullYear();
    fireEvent.change(dob, { target: { value: `${year - 10}-01-01` } });
    expect(screen.getByText('Du musst mindestens 18 Jahre alt sein, um JAMIE zu nutzen.')).toBeTruthy();
    expect(weiter().disabled).toBe(true);
    fireEvent.change(dob, { target: { value: '1990-02-03' } });
    expect(weiter().disabled).toBe(false);
  });

  it('④ photos is the last step („4 / 4") and nothing promises joining without a picture', async () => {
    await renderOnboarding();
    await toPhotos();
    expect(screen.getByText('Füge Fotos')).toBeTruthy();
    expect(screen.getByText('Mit einem Profilbild kannst du Gruppen & Clubs beitreten.')).toBeTruthy();
    expect(screen.getByText('Weitere Fotos (optional)')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Foto hinzufügen/ })).toHaveLength(5);
    expect(document.body.textContent).not.toMatch(FALSE_SENTENCE);
    expect(screen.queryByText('Du bist bereit!')).toBeNull();
    // 3 of 4 segments green, the photo step active.
    const segs = [...document.querySelectorAll('.step-progress-seg')].map((s) => s.dataset.state);
    expect(segs).toEqual(['done', 'done', 'done', 'active']);
  });
});

describe('Onboarding — „Los geht\'s!" without a profile picture', () => {
  it('opens the Achtung sheet instead of saving', async () => {
    await renderOnboarding();
    await toPhotos();
    fireEvent.click(finishBtn());
    expect(screen.getByRole('dialog', { name: 'Achtung: Dein Profil ist nicht vollständig' })).toBeTruthy();
    expect(api.put).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(FALSE_SENTENCE);
  });

  it('„Profilbild hinzufügen" clicks the file input synchronously, and the input survives the sheet', async () => {
    await renderOnboarding();
    await toPhotos();
    fireEvent.click(finishBtn());
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Profilbild hinzufügen' }));
    // Same tick as the tap — no await in between (WebKit user activation).
    expect(click).toHaveBeenCalledTimes(1);
    const input = click.mock.contexts[0];
    expect(input.type).toBe('file');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(input.isConnected).toBe(true);
    expect(fileInput()).toBe(input);
  });

  it('after that upload the wizard finishes on its own, with the same-origin picture', async () => {
    const { refreshProfile } = await renderOnboarding();
    await toPhotos();
    fireEvent.click(finishBtn());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Profilbild hinzufügen' }));
    await pickFile('/media/uploads/me.webp');
    await screen.findByText('CLUBS PAGE');
    const body = lastPut();
    expect(body.avatar_url).toBe('/media/uploads/me.webp');
    expect(body.photos).toEqual(['/media/uploads/me.webp']);
    expect(upload.image).toHaveBeenCalledWith(expect.any(File), 'avatar');
    expect(refreshProfile).toHaveBeenCalled();
    expect(storage.getItem(SNOOZE_KEY)).toBeNull();
  });

  it('„Überspringen" snoozes the avatar nudge for a week and saves the answers without a picture', async () => {
    const { refreshProfile } = await renderOnboarding();
    await toPhotos();
    fireEvent.click(finishBtn());
    const before = Date.now();
    fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    await screen.findByText('CLUBS PAGE');
    const snooze = Number(storage.getItem(SNOOZE_KEY));
    expect(snooze).toBeGreaterThanOrEqual(before + 7 * 864e5);
    expect(snooze).toBeLessThan(before + 7 * 864e5 + 60_000);
    const body = lastPut();
    expect(body).toEqual({
      motivations: ['new_friends'],
      interests: ['Wandern', 'Kochen', 'Tanzen'],
      location: 'Wien, Österreich',
      bio: '',
      // Not asked here, but echoed: an older server writes gender = $1 and
      // would otherwise wipe the one Register stored.
      gender: 'female',
    });
    expect(refreshProfile).toHaveBeenCalled();
  });

  it('never echoes an unknown legacy gender (it would 400 the save) — and does not ask for it either', async () => {
    await renderOnboarding({ ...NEW_USER, gender: 'other' });
    await toPhotos();
    fireEvent.click(finishBtn());
    fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    await screen.findByText('CLUBS PAGE');
    expect(lastPut()).not.toHaveProperty('gender');
  });

  it('a backdrop tap only closes the sheet', async () => {
    await renderOnboarding();
    await toPhotos();
    fireEvent.click(finishBtn());
    fireEvent.click(document.querySelector('.modal-overlay'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.put).not.toHaveBeenCalled();
    expect(storage.getItem(SNOOZE_KEY)).toBeNull();
    expect(counter('4 / 4')).toBeTruthy();
  });
});

describe('Onboarding — after a successful save, until the page is gone', () => {
  const footerBtn = () => document.querySelector('.onboarding-footer button');

  it('stays locked: no second PUT, no Achtung sheet again, no picker', async () => {
    nav.hold = true;
    const { refreshProfile } = await renderOnboarding();
    await toPhotos();
    fireEvent.click(finishBtn());
    fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    await waitFor(() => expect(nav.calls).toEqual([['/onboarding/clubs', { replace: true }]]));
    expect(refreshProfile).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledTimes(1);

    // Still on screen: the footer keeps „Speichere..." and stays disabled…
    expect(footerBtn().textContent).toBe('Speichere...');
    expect(footerBtn().disabled).toBe(true);
    // …and nothing on the step starts anything, even if a tap gets through.
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    fireEvent.click(footerBtn());
    fireEvent.click(document.querySelector('.ob-avatar-btn'));
    fireEvent.click(screen.getAllByRole('button', { name: /^Foto hinzufügen/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }));
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(click).not.toHaveBeenCalled();
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(counter('4 / 4')).toBeTruthy();
  });

  it('a failed save unlocks again for a retry', async () => {
    vi.mocked(api.put).mockRejectedValueOnce({ response: { status: 500, data: { error: 'Onboarding fehlgeschlagen' } } });
    await renderOnboarding();
    await toPhotos();
    fireEvent.click(finishBtn());
    fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    await screen.findByRole('alert');
    expect(finishBtn().disabled).toBe(false);
    fireEvent.click(finishBtn());
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    await screen.findByText('CLUBS PAGE');
    expect(api.put).toHaveBeenCalledTimes(2);
  });

  it('the photo step warms the clubs page chunk, earlier steps do not', async () => {
    clubsChunk.mockClear();
    await renderOnboarding();
    fireEvent.click(goal('Neue Freundschaften schließen'));
    fireEvent.click(weiter());
    await act(async () => {});
    expect(clubsChunk).not.toHaveBeenCalled();
    ['Wandern', 'Kochen', 'Tanzen'].forEach((n) => fireEvent.click(chip(n)));
    fireEvent.click(weiter());
    fireEvent.click(weiter());
    await waitFor(() => expect(clubsChunk).toHaveBeenCalledTimes(1));
  });
});

describe('Onboarding — photos', () => {
  it('a picture from the ring completes the ring; extra photos fill the tiles; the PUT keeps the Onboarding shape', async () => {
    await renderOnboarding();
    await toPhotos();
    expect(document.querySelectorAll('.fsr-tick--on')).toHaveLength(42);
    fireEvent.click(document.querySelector('.ob-avatar-btn'));
    await pickFile('/media/uploads/a.webp');
    await screen.findByText('Profil vollständig');
    expect(document.querySelectorAll('.fsr-tick--on')).toHaveLength(56);
    expect(document.querySelector('.fsr-badge')).not.toBeNull();
    expect(document.querySelectorAll('.step-progress-seg--done')).toHaveLength(4);
    expect(document.querySelector('.ob-avatar-img').getAttribute('src')).toBe('/media/uploads/a.webp');

    // Two more through the tiles.
    fireEvent.click(screen.getAllByRole('button', { name: /^Foto hinzufügen/ })[0]);
    await pickFile('/media/uploads/b.webp');
    fireEvent.click(screen.getAllByRole('button', { name: /^Foto hinzufügen/ })[0]);
    await pickFile('/media/uploads/c.webp');
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Als Profilbild' })).toHaveLength(2));
    expect(screen.getAllByRole('button', { name: /^Foto hinzufügen/ })).toHaveLength(3);

    // „Als Profilbild" on c: c to the ring, a back among the others.
    fireEvent.click(screen.getAllByRole('button', { name: 'Als Profilbild' })[1]);
    expect(document.querySelector('.ob-avatar-img').getAttribute('src')).toBe('/media/uploads/c.webp');
    // Remove b.
    const tiles = [...document.querySelectorAll('.ob-more-tile--filled img')].map((i) => i.getAttribute('src'));
    expect(tiles).toEqual(['/media/uploads/a.webp', '/media/uploads/b.webp']);
    fireEvent.click(screen.getAllByRole('button', { name: 'Foto entfernen' })[1]);

    fireEvent.click(finishBtn());
    expect(screen.queryByRole('dialog')).toBeNull();
    await screen.findByText('CLUBS PAGE');
    const body = lastPut();
    expect(body.avatar_url).toBe('/media/uploads/c.webp');
    expect(body.photos).toEqual(['/media/uploads/c.webp', '/media/uploads/a.webp']);
  });

  it('the first photo of an account without a picture becomes the profile picture, even from a tile', async () => {
    await renderOnboarding();
    await toPhotos();
    fireEvent.click(screen.getAllByRole('button', { name: /^Foto hinzufügen/ })[2]);
    await pickFile('/media/uploads/first.webp');
    await screen.findByText('Profil vollständig');
    expect(document.querySelector('.ob-avatar-img').getAttribute('src')).toBe('/media/uploads/first.webp');
    expect(document.querySelectorAll('.ob-more-tile--filled')).toHaveLength(0);
  });

  it('a 422 from the quality gate keeps the user on the photo step with the message, picture dropped', async () => {
    await renderOnboarding();
    await toPhotos();
    fireEvent.click(document.querySelector('.ob-avatar-btn'));
    await pickFile('/media/uploads/flat.webp');
    await screen.findByText('Profil vollständig');
    vi.mocked(api.put).mockRejectedValueOnce({
      response: { status: 422, data: { error: 'Bitte lade ein echtes Foto von dir hoch.', requiresAvatar: true } },
    });
    fireEvent.click(finishBtn());
    expect((await screen.findByRole('alert')).textContent).toBe('Bitte lade ein echtes Foto von dir hoch.');
    expect(counter('4 / 4')).toBeTruthy();
    expect(screen.queryByText('CLUBS PAGE')).toBeNull();
    expect(screen.queryByText('Profil vollständig')).toBeNull();
    expect(document.querySelector('.ob-avatar-img')).toBeNull();
  });
});

describe('Onboarding — Google sign-up', () => {
  it('shows the Google picture but never sends it; gender and birth date asked here are sent', async () => {
    await renderOnboarding(GOOGLE_USER);
    await toPhotos({ gender: 'Weiblich', dob: '1990-02-03' });
    // The account already has a picture: complete ring, no sheet.
    expect(document.querySelector('.ob-avatar-img').getAttribute('src')).toBe(GOOGLE_PIC);
    expect(screen.getByText('Profil vollständig')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Profilbild ändern' })).toBeTruthy();
    fireEvent.click(finishBtn());
    expect(screen.queryByRole('dialog')).toBeNull();
    await screen.findByText('CLUBS PAGE');
    const body = lastPut();
    expect(body.gender).toBe('female');
    expect(body.date_of_birth).toBe('1990-02-03');
    expect(body).not.toHaveProperty('avatar_url');
    expect(body).not.toHaveProperty('photos');
    expect(JSON.stringify(body)).not.toContain('googleusercontent');
  });

  it('a tile photo stays an extra photo next to the Google picture', async () => {
    await renderOnboarding(GOOGLE_USER);
    await toPhotos({ gender: 'Männlich', dob: '1990-02-03' });
    fireEvent.click(screen.getAllByRole('button', { name: /^Foto hinzufügen/ })[0]);
    await pickFile('/media/uploads/extra.webp');
    await waitFor(() => expect(document.querySelectorAll('.ob-more-tile--filled')).toHaveLength(1));
    expect(document.querySelector('.ob-avatar-img').getAttribute('src')).toBe(GOOGLE_PIC);
    fireEvent.click(finishBtn());
    await screen.findByText('CLUBS PAGE');
    const body = lastPut();
    expect(body.photos).toEqual(['/media/uploads/extra.webp']);
    expect(body).not.toHaveProperty('avatar_url');
  });
});

describe('Onboarding — prefill, flags and the draft', () => {
  it('clears a leftover jamie_new_registration flag on mount', async () => {
    storage.setItem('jamie_new_registration', '1');
    await renderOnboarding();
    expect(storage.getItem('jamie_new_registration')).toBeNull();
  });

  it('prefills answers the account already has', async () => {
    await renderOnboarding({ ...NEW_USER, motivations: ['more_active', 'bogus'], interests: ['Yoga', 'Lesen', 'Bouldern'] });
    expect(goal('Mein soziales Leben aktiver gestalten und mehr unternehmen').getAttribute('aria-checked')).toBe('true');
    expect(weiter().disabled).toBe(false);
    fireEvent.click(weiter());
    expect(chip('Bouldern').getAttribute('aria-pressed')).toBe('true');
    expect(weiter().disabled).toBe(false);
  });

  it('restores a draft after a reload — on its step, with its answers', async () => {
    storage.setItem(draftKey(NEW_USER.id), JSON.stringify({
      v: 1, savedAt: Date.now() - 60_000, stepId: 'about',
      formData: { motivations: ['new_in_town'], interests: ['Wandern', 'Kochen', 'Tanzen'], location: 'Graz', bio: 'Hallo!' },
    }));
    await renderOnboarding();
    expect(counter('3 / 4')).toBeTruthy();
    expect(screen.getByLabelText('Wohnort').value).toBe('Graz');
    expect(screen.getByLabelText('Kurzbeschreibung (optional)').value).toBe('Hallo!');
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }));
    expect(goal('Neu in der Stadt und möchte Anschluss finden').getAttribute('aria-checked')).toBe('true');
  });

  it('restores uploaded photos, and never lands past an unanswered step', async () => {
    storage.setItem(draftKey(NEW_USER.id), JSON.stringify({
      v: 1, savedAt: Date.now(), stepId: 'photos',
      formData: { motivations: ['new_in_town'], interests: ['Wandern'], photos: ['/media/uploads/a.webp'], avatar_url: '/media/uploads/a.webp' },
    }));
    await renderOnboarding();
    expect(counter('2 / 4')).toBeTruthy(); // only one interest in the draft
  });

  it('ignores an expired draft and another account\'s draft', async () => {
    storage.setItem(draftKey(NEW_USER.id), JSON.stringify({
      v: 1, savedAt: Date.now() - DRAFT_MAX_AGE_MS - 1000, stepId: 'about',
      formData: { motivations: ['new_in_town'], interests: ['Wandern', 'Kochen', 'Tanzen'] },
    }));
    storage.setItem(draftKey(999), JSON.stringify({
      v: 1, savedAt: Date.now(), stepId: 'about',
      formData: { motivations: ['new_in_town'], interests: ['Wandern', 'Kochen', 'Tanzen'] },
    }));
    await renderOnboarding();
    expect(counter('1 / 4')).toBeTruthy();
    expect(goal('Neu in der Stadt und möchte Anschluss finden').getAttribute('aria-checked')).toBe('false');
  });

  it('saves the draft as the user goes and deletes it after the save', async () => {
    await renderOnboarding();
    fireEvent.click(goal('Neue Freundschaften schließen'));
    fireEvent.click(weiter());
    const saved = JSON.parse(storage.getItem(draftKey(NEW_USER.id)));
    expect(saved.stepId).toBe('interests');
    expect(saved.formData.motivations).toEqual(['new_friends']);
    ['Wandern', 'Kochen', 'Tanzen'].forEach((n) => fireEvent.click(chip(n)));
    fireEvent.click(weiter());
    fireEvent.click(weiter());
    fireEvent.click(finishBtn());
    fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    await screen.findByText('CLUBS PAGE');
    expect(storage.getItem(draftKey(NEW_USER.id))).toBeNull();
  });

  it('a failed save keeps the draft and shows the server message in the footer', async () => {
    vi.mocked(api.put).mockRejectedValueOnce({ response: { status: 500, data: { error: 'Onboarding fehlgeschlagen' } } });
    await renderOnboarding();
    await toPhotos();
    fireEvent.click(finishBtn());
    fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Onboarding fehlgeschlagen');
    expect(storage.getItem(draftKey(NEW_USER.id))).not.toBeNull();
    expect(screen.queryByText('CLUBS PAGE')).toBeNull();
  });
});

describe('onboardingDraft (utils)', () => {
  const STEPS = ['goals', 'interests', 'about', 'photos'];

  it('round-trips a draft and drops unknown fields, keys and an avatar that was not uploaded', () => {
    saveOnboardingDraft(7, {
      stepId: 'photos',
      formData: {
        motivations: ['more_active', 'nope', 'new_in_town'], interests: ['A', '', 3], gender: 'robot',
        photos: ['/media/uploads/a.webp'], avatar_url: 'https://evil.example/x.png', password: 'x',
      },
    });
    const d = loadOnboardingDraft(7, STEPS);
    expect(d.stepId).toBe('photos');
    expect(d.formData).toEqual({
      motivations: ['new_in_town', 'more_active'], interests: ['A'], location: '', bio: '', gender: '',
      date_of_birth: '', photos: ['/media/uploads/a.webp'], avatar_url: null,
    });
  });

  it('rejects garbage, unknown steps, future timestamps and missing users — and never throws', () => {
    storage.setItem(draftKey(7), '{not json');
    expect(loadOnboardingDraft(7, STEPS)).toBeNull();
    saveOnboardingDraft(7, { stepId: 'done', formData: {} });
    expect(loadOnboardingDraft(7, STEPS)).toBeNull();
    expect(storage.getItem(draftKey(7))).toBeNull(); // invalid drafts are removed
    saveOnboardingDraft(7, { stepId: 'goals', formData: {} }, Date.now() + 60 * 60 * 1000);
    expect(loadOnboardingDraft(7, STEPS)).toBeNull();
    expect(loadOnboardingDraft(undefined, STEPS)).toBeNull();
    expect(sanitizeDraftForm(null).photos).toEqual([]);
  });

  it('survives a storage that throws (quota, denied)', () => {
    storage.setItem.mockImplementationOnce(() => { throw new Error('QuotaExceededError'); });
    expect(() => saveOnboardingDraft(7, { stepId: 'goals', formData: {} })).not.toThrow();
    storage.getItem.mockImplementationOnce(() => { throw new Error('SecurityError'); });
    expect(loadOnboardingDraft(7, STEPS)).toBeNull();
  });
});
