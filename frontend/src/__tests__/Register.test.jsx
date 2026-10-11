import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// Register, 4 pages since the onboarding rework (Tina's checklist 10.10.2026):
// Name + E-Mail → Code → Geburtsdatum + Geschlecht (bubbles) → Passwort.
// Real German i18n (vitest.setup).
vi.mock('../utils/api', () => ({
  auth: { sendEmailCode: vi.fn(), verifyEmailCode: vi.fn(), updateProfile: vi.fn() },
}));
// The test runtime's localStorage is not dependable (see pushNotifications
// test) — back both storages with Maps (hoisted: the mock factory runs first).
const { local, session } = vi.hoisted(() => ({ local: new Map(), session: new Map() }));
vi.mock('../utils/safeStorage', () => {
  const backed = (m) => ({
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  });
  return { safeStorage: backed(local), safeSession: backed(session), default: backed(local) };
});

const { auth } = await import('../utils/api');
const { Register } = await import('../pages/Register');

const FLAG = 'jamie_new_registration';
const EMAIL = 'tina@example.com';
const NEW_USER = { id: 1, name: 'Tina', onboarding_completed: false };

const renderRegister = (ctx = {}) => {
  const register = ctx.register ?? vi.fn(async () => NEW_USER);
  render(
    <AuthContext.Provider value={{ register, loading: false, ...ctx }}>
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="/onboarding" element={<div>ONBOARDING-PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return { register };
};

const titleLines = () => [...document.querySelectorAll('.ob-title-line')].map((el) => el.textContent);
const segments = () => [...document.querySelectorAll('.step-progress-seg')].map((el) => el.dataset.state);
const pageText = () => document.body.textContent;
const form = () => document.querySelector('form');
const click = async (el) => { await act(async () => { fireEvent.click(el); }); };
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const button = (name) => screen.getByRole('button', { name });

const fillIdentity = () => { type('Dein Name', 'Tina'); type('E-Mail-Adresse', EMAIL); };
const toCodePage = async () => {
  auth.sendEmailCode.mockResolvedValue({ data: { message: 'sent' } });
  fillIdentity();
  await click(button('Code senden'));
};
const toAboutPage = async () => {
  // Dev OTP bypass: the server hands the code back and the code page is skipped.
  auth.sendEmailCode.mockResolvedValue({ data: { devCode: '654321' } });
  auth.verifyEmailCode.mockResolvedValue({ data: {} });
  fillIdentity();
  await click(button('Code senden'));
};
const toPasswordPage = async () => {
  await toAboutPage();
  type('Geburtsdatum', '1994-05-12');
  await click(screen.getByRole('radio', { name: 'Weiblich' }));
  await click(button('Weiter'));
};
const fillPassword = () => {
  type('Passwort', 'Abcdef1!');
  type('Passwort bestätigen', 'Abcdef1!');
  fireEvent.click(screen.getByRole('checkbox'));
};

beforeEach(() => {
  local.clear();
  session.clear();
  vi.mocked(auth.sendEmailCode).mockReset();
  vi.mocked(auth.verifyEmailCode).mockReset();
  vi.mocked(auth.updateProfile).mockReset();
});

describe('Register — four pages', () => {
  it('walks Name + E-Mail → Code → Geburtsdatum + Geschlecht → Passwort, with no Wohnort anywhere', async () => {
    renderRegister();

    expect(titleLines()).toEqual(['Wer', 'bist du?']);
    expect(screen.getByRole('progressbar', { name: 'Schritt 1 von 4' })).toBeTruthy();
    expect(screen.getByText('1 / 4')).toBeTruthy();
    expect(segments()).toEqual(['active', 'upcoming', 'upcoming', 'upcoming']);
    expect(screen.queryByRole('button', { name: 'Zurück' })).toBeNull();   // nothing before page 1
    expect(screen.getByLabelText('Dein Name')).toBeTruthy();
    expect(screen.getByLabelText('E-Mail-Adresse')).toBeTruthy();
    expect(pageText()).not.toMatch(/Wohnort|Wo bist du|Stadt oder Region/);

    await toCodePage();
    expect(auth.sendEmailCode).toHaveBeenCalledWith(EMAIL, 'Tina');
    expect(titleLines()).toEqual(['Check deine', 'E-Mails']);
    expect(screen.getByRole('progressbar', { name: 'Schritt 2 von 4' })).toBeTruthy();
    expect(segments()).toEqual(['done', 'active', 'upcoming', 'upcoming']);   // done = green
    expect(pageText()).not.toMatch(/Wohnort|Wo bist du|Stadt oder Region/);

    auth.verifyEmailCode.mockResolvedValue({ data: {} });
    type('Bestätigungscode', '123456');
    await click(button('Bestätigen'));
    expect(auth.verifyEmailCode).toHaveBeenCalledWith(EMAIL, '123456');
    expect(titleLines()).toEqual(['Ein bisschen', 'über dich']);
    expect(segments()).toEqual(['done', 'done', 'active', 'upcoming']);
    expect(screen.getByLabelText('Geburtsdatum')).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Geschlecht' })).toBeTruthy();
    expect(pageText()).not.toMatch(/Wohnort|Wo bist du|Stadt oder Region/);

    type('Geburtsdatum', '1994-05-12');
    await click(screen.getByRole('radio', { name: 'Männlich' }));
    await click(button('Weiter'));
    expect(titleLines()).toEqual(['Fast', 'geschafft!']);
    expect(screen.getByText('4 / 4')).toBeTruthy();
    expect(segments()).toEqual(['done', 'done', 'done', 'active']);
    expect(button('Konto erstellen')).toBeTruthy();
    expect(pageText()).not.toMatch(/Wohnort|Wo bist du|Stadt oder Region/);
  });

  it('the code hint is one sentence with the address inside — spaces kept', async () => {
    renderRegister();
    await toCodePage();
    expect(document.querySelector('.reg-hint').textContent)
      .toBe('Wir haben einen 6-stelligen Code an tina@example.com gesendet.');
    expect(screen.getByText(EMAIL).tagName).toBe('STRONG');
  });

  it('Code senden needs a name AND an e-mail', () => {
    renderRegister();
    expect(button('Code senden')).toBeDisabled();
    type('Dein Name', 'Tina');
    expect(button('Code senden')).toBeDisabled();
    type('E-Mail-Adresse', EMAIL);
    expect(button('Code senden')).toBeEnabled();
    type('Dein Name', '   ');
    expect(button('Code senden')).toBeDisabled();
  });

  it('the dev OTP bypass skips the code page', async () => {
    renderRegister();
    await toAboutPage();
    expect(auth.verifyEmailCode).toHaveBeenCalledWith(EMAIL, '654321');
    expect(titleLines()).toEqual(['Ein bisschen', 'über dich']);
    expect(screen.getByText('3 / 4')).toBeTruthy();
  });

  it('Weiter on the about page needs an 18+ birth date AND a gender bubble', async () => {
    renderRegister();
    await toAboutPage();
    expect(button('Weiter')).toBeDisabled();

    type('Geburtsdatum', '1994-05-12');
    expect(button('Weiter')).toBeDisabled();             // gender still missing

    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false']);
    // Glyph first — each keeps its text variation selector (no colour ⚧ on
    // iOS) — then the label.
    expect(radios.map((r) => r.textContent.slice(0, 2))).toEqual(['♂︎', '♀︎', '⚧︎']);
    expect(radios.map((r) => r.textContent.slice(2))).toEqual(['Männlich', 'Weiblich', 'Divers']);

    await click(screen.getByRole('radio', { name: 'Divers' }));
    expect(screen.getByRole('radio', { name: 'Divers' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Divers' }).classList.contains('selected')).toBe(true);
    expect(button('Weiter')).toBeEnabled();

    const seventeen = new Date();
    seventeen.setFullYear(seventeen.getFullYear() - 17);
    type('Geburtsdatum', seventeen.toISOString().slice(0, 10));
    expect(screen.getByText('Du musst mindestens 18 Jahre alt sein.')).toBeTruthy();
    expect(button('Weiter')).toBeDisabled();
  });

  it('Enter on an early page never registers', async () => {
    const { register } = renderRegister();
    fillIdentity();
    fireEvent.submit(form());
    expect(titleLines()).toEqual(['Wer', 'bist du?']);

    await toCodePage();
    type('Bestätigungscode', '123456');
    fireEvent.submit(form());
    expect(titleLines()).toEqual(['Check deine', 'E-Mails']);
    expect(auth.verifyEmailCode).not.toHaveBeenCalled();

    auth.verifyEmailCode.mockResolvedValue({ data: {} });
    await click(button('Bestätigen'));
    type('Geburtsdatum', '1994-05-12');
    await click(screen.getByRole('radio', { name: 'Weiblich' }));
    fireEvent.submit(form());
    expect(titleLines()).toEqual(['Ein bisschen', 'über dich']);

    expect(register).not.toHaveBeenCalled();
    expect(local.has(FLAG)).toBe(false);
  });

  it('back: code and about pages return to Name + E-Mail (the code is spent), Passwort to the about page', async () => {
    renderRegister();
    await toCodePage();
    await click(button('Zurück'));
    expect(titleLines()).toEqual(['Wer', 'bist du?']);
    expect(screen.getByLabelText('E-Mail-Adresse')).toHaveValue(EMAIL);   // nothing typed is lost

    await toPasswordPage();
    expect(titleLines()).toEqual(['Fast', 'geschafft!']);
    await click(button('Zurück'));
    expect(titleLines()).toEqual(['Ein bisschen', 'über dich']);
    expect(screen.getByLabelText('Geburtsdatum')).toHaveValue('1994-05-12');
    expect(screen.getByRole('radio', { name: 'Weiblich' })).toHaveAttribute('aria-checked', 'true');

    await click(button('Zurück'));
    expect(titleLines()).toEqual(['Wer', 'bist du?']);
    expect(screen.getByLabelText('Dein Name')).toHaveValue('Tina');
  });
});

describe('Register — creating the account', () => {
  it('raises the intro flag BEFORE register() resolves, passes the gender, then goes to onboarding', async () => {
    let flagDuringRegister = 'unset';
    const register = vi.fn(async () => {
      flagDuringRegister = local.get(FLAG) ?? null;
      return NEW_USER;
    });
    renderRegister({ register });
    await toPasswordPage();
    fillPassword();
    await click(button('Konto erstellen'));

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(EMAIL, 'Abcdef1!', 'Tina', undefined, '1994-05-12', 'female');
    expect(flagDuringRegister).toBe('1');
    expect(screen.getByText('ONBOARDING-PAGE')).toBeTruthy();
    // No Wohnort save (or anything else) awaited between register() and the navigate.
    expect(auth.updateProfile).not.toHaveBeenCalled();
  });

  it('the invite code is sent upper-cased when given', async () => {
    const { register } = renderRegister();
    await toPasswordPage();
    fillPassword();
    type('Einladungscode (optional)', 'jamie-x7k2');
    await click(button('Konto erstellen'));
    expect(register).toHaveBeenCalledWith(EMAIL, 'Abcdef1!', 'Tina', 'JAMIE-X7K2', '1994-05-12', 'female');
  });

  it('a failed register clears the flag again and shows why', async () => {
    const register = vi.fn(async () => {
      const err = new Error('409');
      err.response = { status: 409, data: { error: 'Diese E-Mail ist bereits registriert.' } };
      throw err;
    });
    renderRegister({ register });
    await toPasswordPage();
    fillPassword();
    await click(button('Konto erstellen'));

    expect(register).toHaveBeenCalledTimes(1);
    expect(local.has(FLAG)).toBe(false);
    expect(screen.getByText('Diese E-Mail ist bereits registriert.')).toBeTruthy();
    expect(screen.queryByText('ONBOARDING-PAGE')).toBeNull();
    expect(titleLines()).toEqual(['Fast', 'geschafft!']);
  });

  it('mismatching passwords never reach register()', async () => {
    const { register } = renderRegister();
    await toPasswordPage();
    type('Passwort', 'Abcdef1!');
    type('Passwort bestätigen', 'Abcdef1?');
    fireEvent.click(screen.getByRole('checkbox'));
    await click(button('Konto erstellen'));
    expect(register).not.toHaveBeenCalled();
    expect(screen.getByText('Passwörter stimmen nicht überein')).toBeTruthy();
    expect(local.has(FLAG)).toBe(false);
  });
});

describe('Register — kept from the old screen', () => {
  it('the guest notice shows once and the login link stays', () => {
    session.set('jamie_guest_blocked', '1');
    renderRegister();
    expect(screen.getByText(/Erstelle ein kostenloses Konto/)).toBeTruthy();
    expect(session.has('jamie_guest_blocked')).toBe(false);
    expect(screen.getByRole('link', { name: 'Jetzt einloggen' }).getAttribute('href')).toBe('/login');
  });
});
