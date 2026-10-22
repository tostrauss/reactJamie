import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

// Admin → "Clubs umklassifizieren" (Tina, 22.10.2026). The section that has to
// work before the Clubs segment of Entdecken shows anything at all.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      if (opts && 'defaultValue' in opts) return opts.defaultValue;
      if (!opts) return key;
      return `${key}(${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',')})`;
    },
    i18n: { language: 'de', resolvedLanguage: 'de' },
  }),
}));
vi.mock('../utils/api', () => ({
  admin: { getClubsForAdmin: vi.fn(), classifyClub: vi.fn() },
}));

const { admin } = await import('../utils/api');
const { AdminClassifySection } = await import('../components/AdminClassifySection');

const row = (id, name, extra = {}) => ({
  id, name, image_url: null, location: 'Wien', members_count: 42,
  approval_status: 'approved', is_active: true, club_type: 'community',
  category_label: null, category: 'Laufen', ...extra,
});

const httpError = (status) => Object.assign(new Error(String(status)), { response: { status, data: {} } });

const typeButtons = (container) =>
  [...container.querySelectorAll('button')].filter((b) => /admin\.classify\.(community|official)/.test(b.textContent));

async function renderLoaded(rows) {
  vi.mocked(admin.getClubsForAdmin).mockResolvedValue({ data: rows });
  const utils = render(<AdminClassifySection />);
  if (rows.length) await utils.findByText(rows[0].name);
  else await utils.findByText('admin.classify.empty');
  return utils;
}

beforeEach(() => {
  vi.mocked(admin.getClubsForAdmin).mockReset();
  vi.mocked(admin.classifyClub).mockReset();
});

describe('AdminClassifySection', () => {
  it('lists clubs and marks the current type as active', async () => {
    const { container } = await renderLoaded([row(1, 'Laufclub Prater')]);
    const [community, official] = typeButtons(container);
    // The club IS a community → that button is the pressed, disabled one.
    expect(community.getAttribute('aria-pressed')).toBe('true');
    expect(community.disabled).toBe(true);
    expect(official.getAttribute('aria-pressed')).toBe('false');
    expect(official.disabled).toBe(false);
  });

  it('upgrading to Club sends club_type and renders what the server stored', async () => {
    const { container } = await renderLoaded([row(1, 'Laufclub Prater')]);
    vi.mocked(admin.classifyClub).mockResolvedValue({
      data: { club: { id: 1, name: 'Laufclub Prater', club_type: 'official', category_label: null } },
    });
    fireEvent.click(typeButtons(container)[1]);
    await waitFor(() => expect(admin.classifyClub).toHaveBeenCalledWith(1, { club_type: 'official' }));
    await waitFor(() => {
      const [community, official] = typeButtons(container);
      expect(official.getAttribute('aria-pressed')).toBe('true');
      expect(community.disabled).toBe(false);
    });
  });

  // NULL (or a server without the column) must read as community, never as a
  // third state — same contract as the server's IS DISTINCT FROM 'official'.
  it('treats a missing club_type as community', async () => {
    const { container } = await renderLoaded([row(1, 'Alt-Club', { club_type: null })]);
    expect(typeButtons(container)[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('saves the free-text category line only once it changed', async () => {
    const { container, getByText } = await renderLoaded([row(1, 'Laufclub Prater')]);
    const save = getByText('admin.classify.save').closest('button');
    expect(save.disabled).toBe(true);                       // nothing edited yet

    const input = container.querySelector('input[id*="-cat-"]');
    fireEvent.change(input, { target: { value: ' Sport · Laufclub ' } });
    expect(save.disabled).toBe(false);

    vi.mocked(admin.classifyClub).mockResolvedValue({
      data: { club: { id: 1, club_type: 'community', category_label: 'Sport · Laufclub' } },
    });
    fireEvent.click(save);
    // Trimmed on the way out — the server trims too, this keeps the UI honest.
    await waitFor(() => expect(admin.classifyClub)
      .toHaveBeenCalledWith(1, { category_label: 'Sport · Laufclub' }));
    await waitFor(() => expect(getByText('admin.classify.saved')).toBeTruthy());
  });

  it('searches the server, debounced', async () => {
    const { container } = await renderLoaded([row(1, 'Laufclub Prater')]);
    vi.mocked(admin.getClubsForAdmin).mockResolvedValue({ data: [row(2, 'Café Concerto')] });
    fireEvent.change(container.querySelector('input[type="search"]'), { target: { value: 'concerto' } });
    await waitFor(() => expect(admin.getClubsForAdmin).toHaveBeenCalledWith('concerto'), { timeout: 2000 });
  });

  it('shows why a club is not reachable yet', async () => {
    const { getByText } = await renderLoaded([
      row(1, 'Wartender Club', { approval_status: 'pending' }),
    ]);
    expect(getByText('pending')).toBeTruthy();
  });

  it('surfaces a failed save without dropping the row', async () => {
    const { container, getByText } = await renderLoaded([row(1, 'Laufclub Prater')]);
    vi.mocked(admin.classifyClub).mockRejectedValue(httpError(500));
    fireEvent.click(typeButtons(container)[1]);
    await waitFor(() => expect(getByText('admin.classify.saveError')).toBeTruthy());
    expect(getByText('Laufclub Prater')).toBeTruthy();
  });

  // An un-migrated database answers 503, an older server 404: in both cases the
  // feature does not exist there, so neither does the section.
  it.each([404, 503])('renders nothing on %i', async (status) => {
    vi.mocked(admin.getClubsForAdmin).mockRejectedValue(httpError(status));
    const { container } = render(<AdminClassifySection />);
    await waitFor(() => expect(container.querySelector('section')).toBeNull());
  });
});
