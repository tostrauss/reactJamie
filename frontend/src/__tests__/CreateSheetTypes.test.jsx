import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The "+" sheet and the club wizard after the Community/Club split (Tina,
// 22.10.2026). What is pinned here: Tina's wording is binding, the two club
// entries carry their type in the URL, and the wizard sends that type on to
// the server — the field the server reads to decide whether the thing needs
// approval at all.
const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => (opts && 'count' in opts ? `${key}(${opts.count})` : key),
    i18n: { language: 'de', resolvedLanguage: 'de' },
  }),
}));

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../utils/api', () => ({
  clubs: { create: vi.fn() },
  upload: { image: vi.fn() },
  map: { geocode: vi.fn() },
}));
vi.mock('../utils/googleMaps', () => ({
  loadGoogleMaps: vi.fn(), onGoogleMapsReady: vi.fn(), createPlacesAutocomplete: vi.fn(),
}));
vi.mock('../components/ImageCropModal', () => ({ ImageCropModal: () => null }));

const { clubs, map: mapApi } = await import('../utils/api');
const { CreateClub } = await import('../pages/CreateClub');

beforeEach(() => {
  navigate.mockReset();
  toast.success.mockReset();
  vi.mocked(clubs.create).mockReset();
  vi.mocked(mapApi.geocode).mockReset();
});

const renderWizard = (search) => render(
  <MemoryRouter initialEntries={[`/create-club${search}`]}>
    <CreateClub />
  </MemoryRouter>,
);

describe('CreateClub — which kind am I creating?', () => {
  it('?type=official titles and submits as a club', () => {
    const { getByText } = renderWizard('?type=official');
    expect(getByText('createClub.official.title')).toBeTruthy();
  });

  it('?type=community titles as a community', () => {
    const { getByText } = renderWizard('?type=community');
    expect(getByText('createClub.community.title')).toBeTruthy();
  });

  // A deep link or an old home-screen shortcut has no param. The safe default
  // is a community — that is what this form created before the split.
  it('a missing type falls back to community', () => {
    const { getByText } = renderWizard('');
    expect(getByText('createClub.community.title')).toBeTruthy();
  });

  it('an unknown type is not treated as official', () => {
    const { getByText } = renderWizard('?type=verein');
    expect(getByText('createClub.community.title')).toBeTruthy();
  });

  // Only an official club waits for us, so only it explains the wait.
  // Unmounted between the two: both renders attach to the same document.body,
  // so the second one's queries would otherwise still find the first's hint.
  it('shows the review hint for an official club', () => {
    const { queryByText, unmount } = renderWizard('?type=official');
    expect(queryByText('createClub.official.reviewHint')).toBeTruthy();
    unmount();
  });

  it('shows no review hint for a community', () => {
    const { queryByText, unmount } = renderWizard('?type=community');
    expect(queryByText('createClub.official.reviewHint')).toBeNull();
    unmount();
  });
});

describe('CreateClub — what reaches the server', () => {
  // Drives the wizard all the way to step 3, because the submit button only
  // exists there — an earlier version of this test looked for it on step 1,
  // found nothing and asserted nothing at all.
  const walkToStep3 = async (search) => {
    const utils = renderWizard(search);
    const { container, getByText } = utils;

    // Step 1: a name plus at least one sub-category.
    fireEvent.change(container.querySelector('input[name="title"]'), { target: { value: 'Laufclub Prater' } });
    fireEvent.click(container.querySelector('.main-category-chip'));
    await waitFor(() => expect(container.querySelector('.category-chip')).toBeTruthy());
    fireEvent.click(container.querySelector('.category-chip'));
    fireEvent.click(getByText('createClub.next').closest('button'));

    // Step 2: a location. Places never shows a dropdown in jsdom, so the page
    // falls back to the server verifier — which is mocked to accept.
    await waitFor(() => expect(container.querySelector('input[name="location"]')).toBeTruthy());
    fireEvent.change(container.querySelector('input[name="location"]'), { target: { value: 'Wien' } });
    vi.mocked(mapApi.geocode).mockResolvedValue({ data: { ok: true } });
    fireEvent.click(getByText('createClub.next').closest('button'));

    // Step 3: the preview, and the only screen with a submit button.
    const submit = await waitFor(() => {
      const b = [...container.querySelectorAll('button')]
        .find((x) => /createClub\.(community|official)\.submit/.test(x.textContent));
      if (!b) throw new Error('submit button not reached');
      return b;
    });
    return { ...utils, submit };
  };

  it('sends club_type=community and routes to the new club when it went live', async () => {
    vi.mocked(clubs.create).mockResolvedValue({ data: { id: 42, approval_status: 'approved' } });
    const { submit } = await walkToStep3('?type=community');
    fireEvent.click(submit);

    await waitFor(() => expect(clubs.create).toHaveBeenCalled());
    expect(vi.mocked(clubs.create).mock.calls[0][0].club_type).toBe('community');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/club/42', { replace: true }));
    expect(toast.success).toHaveBeenCalledWith('createClub.community.liveToast');
  });

  // The route is decided by what the SERVER answered, not by what we asked
  // for: a pending club's detail page is invisible to everyone else.
  it('routes home with the pending toast when the server says pending', async () => {
    vi.mocked(clubs.create).mockResolvedValue({ data: { id: 43, approval_status: 'pending' } });
    const { submit } = await walkToStep3('?type=official');
    fireEvent.click(submit);

    await waitFor(() => expect(clubs.create).toHaveBeenCalled());
    expect(vi.mocked(clubs.create).mock.calls[0][0].club_type).toBe('official');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/home', { replace: true }));
    expect(toast.success).toHaveBeenCalledWith('createClub.pendingToast');
  });

  // An admin's community is approved too, and the live toast is the community
  // one — the type we SENT must not decide the wording on its own.
  it('an approved official club goes to its page without the community toast', async () => {
    vi.mocked(clubs.create).mockResolvedValue({ data: { id: 44, approval_status: 'approved' } });
    const { submit } = await walkToStep3('?type=official');
    fireEvent.click(submit);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/club/44', { replace: true }));
    expect(toast.success).not.toHaveBeenCalledWith('createClub.community.liveToast');
  });
});
