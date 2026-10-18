import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// Admin → "News an alle" (Lea, 18.10.2026). Because one send reaches every
// account, the section shows the audience first and sends only after an
// explicit second step; the server's double-send refusal is worded. Real
// German i18n (vitest.setup.js).
vi.mock('../utils/api', () => ({
  admin: { getNewsAudience: vi.fn(), getNews: vi.fn(), sendNews: vi.fn() },
}));

const { admin } = await import('../utils/api');
const { AdminNewsSection } = await import('../components/AdminNewsSection');

const httpError = (status, data) => Object.assign(new Error(String(status)), { response: { status, data } });

const renderSection = async ({ audience = { total: 1234, pushOptIn: 312 }, recent = [] } = {}) => {
  vi.mocked(admin.getNewsAudience).mockResolvedValue({ data: audience });
  vi.mocked(admin.getNews).mockResolvedValue({ data: { news: recent } });
  const utils = render(<AdminNewsSection />);
  await act(async () => {});
  return utils;
};
const field = (label) => screen.getByLabelText(label);
const fill = ({ title = 'Neue Deals in Wien', message = 'Drei neue Kooperationen — schau rein!', link = '' } = {}) => {
  fireEvent.change(field('Titel'), { target: { value: title } });
  fireEvent.change(field('Nachricht'), { target: { value: message } });
  if (link) fireEvent.change(field('Link in der App (optional)'), { target: { value: link } });
};
const reviewBtn = () => screen.getByRole('button', { name: 'Vorschau & senden' });

beforeEach(() => {
  vi.mocked(admin.getNewsAudience).mockReset();
  vi.mocked(admin.getNews).mockReset();
  vi.mocked(admin.sendNews).mockReset();
});

describe('AdminNewsSection', () => {
  it('shows how many people a send reaches before anything else', async () => {
    await renderSection();
    expect(screen.getByText('News an alle')).toBeTruthy();
    expect(screen.getByText('Erreicht 1.234 Nutzer · davon 312 mit Push-Einwilligung')).toBeTruthy();
  });

  it('cannot be reviewed without title and message, nor with an external link', async () => {
    await renderSection();
    expect(reviewBtn().disabled).toBe(true);
    fill();
    expect(reviewBtn().disabled).toBe(false);
    fireEvent.change(field('Link in der App (optional)'), { target: { value: 'https://example.com' } });
    expect(reviewBtn().disabled).toBe(true);
    expect(screen.getByText('Der Link muss ein App-Pfad sein und mit „/“ beginnen – keine Web-Adresse.')).toBeTruthy();
    fireEvent.change(field('Link in der App (optional)'), { target: { value: '/deal/12' } });
    expect(reviewBtn().disabled).toBe(false);
  });

  it('limits title and message to 80 / 500 characters', async () => {
    await renderSection();
    expect(field('Titel').getAttribute('maxLength')).toBe('80');
    expect(field('Nachricht').getAttribute('maxLength')).toBe('500');
  });

  it('two steps: review shows the audience + a preview, cancel sends nothing', async () => {
    await renderSection();
    fill({ link: '/deal/12' });
    fireEvent.click(field('Auch als Push an Nutzer mit Einwilligung'));
    await act(async () => { fireEvent.click(reviewBtn()); });

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Wirklich an alle senden?');
    expect(dialog.textContent).toContain('Geht an 1.234 Nutzer – die News erscheint bei allen in der Glocke.');
    expect(dialog.textContent).toContain('Zusätzlich als Push an 312 Nutzer mit Einwilligung.');
    expect(dialog.textContent).toContain('Neue Deals in Wien');
    expect(dialog.textContent).toContain('→ /deal/12');
    // The harmless choice has the focus: Enter right away must not send.
    expect(document.activeElement.textContent).toBe('Abbrechen');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' })); });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(admin.sendNews).not.toHaveBeenCalled();
    expect(field('Titel').value).toBe('Neue Deals in Wien');   // nothing lost
  });

  it('sends the trimmed form, reports the counts, clears the form and reloads the list', async () => {
    await renderSection();
    vi.mocked(admin.sendNews).mockResolvedValue({ data: { id: 77, recipients: 1234, pushRecipients: 280, push: true } });
    vi.mocked(admin.getNews).mockResolvedValue({ data: { news: [
      { id: 77, title: 'Neue Deals in Wien', status: 'sent', recipients: 1234, push_recipients: 280, created_at: '2026-10-18T10:00:00Z', created_by_name: 'Tobi' },
    ] } });
    fill({ title: '  Neue Deals in Wien  ', link: '/deal/12' });
    fireEvent.click(field('Auch als Push an Nutzer mit Einwilligung'));
    await act(async () => { fireEvent.click(reviewBtn()); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Jetzt senden' })); });

    expect(admin.sendNews).toHaveBeenCalledWith({
      title: 'Neue Deals in Wien', message: 'Drei neue Kooperationen — schau rein!', link: '/deal/12', push: true,
    });
    expect(screen.getByText(/Gesendet an 1\.234 Nutzer\./).textContent)
      .toBe('Gesendet an 1.234 Nutzer. Push an 280 Nutzer mit Einwilligung.');
    expect(field('Titel').value).toBe('');
    expect(field('Nachricht').value).toBe('');
    expect(field('Auch als Push an Nutzer mit Einwilligung').checked).toBe(false);
    await waitFor(() => expect(screen.getByText(/an 1\.234 Nutzer · Push: 280 · von Tobi/)).toBeTruthy());
  });

  it('without push: says "nur in der Glocke" and sends push: false, no link', async () => {
    await renderSection();
    vi.mocked(admin.sendNews).mockResolvedValue({ data: { id: 78, recipients: 10, pushRecipients: 0, push: false } });
    fill();
    await act(async () => { fireEvent.click(reviewBtn()); });
    expect(screen.getByRole('alertdialog').textContent).toContain('Ohne Push – nur in der Glocke.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Jetzt senden' })); });
    expect(admin.sendNews.mock.calls[0][0]).toEqual({
      title: 'Neue Deals in Wien', message: 'Drei neue Kooperationen — schau rein!', link: undefined, push: false,
    });
    expect(screen.getByText('Gesendet an 10 Nutzer.')).toBeTruthy();
  });

  it('the server’s double-send refusal is worded, and the form keeps its text', async () => {
    await renderSection();
    vi.mocked(admin.sendNews).mockRejectedValue(httpError(409, { code: 'NEWS_DUPLICATE', minutes: 10 }));
    fill();
    await act(async () => { fireEvent.click(reviewBtn()); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Jetzt senden' })); });
    expect(screen.getByRole('alert').textContent)
      .toBe('Diese News wurde gerade erst gesendet. Derselbe Titel geht erst nach 10 Minuten wieder.');
    expect(field('Titel').value).toBe('Neue Deals in Wien');
  });

  it('no answer at all warns against a blind retry', async () => {
    await renderSection();
    vi.mocked(admin.sendNews).mockRejectedValue(Object.assign(new Error('timeout of 60000ms exceeded'), { code: 'ECONNABORTED' }));
    fill();
    await act(async () => { fireEvent.click(reviewBtn()); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Jetzt senden' })); });
    expect(screen.getByRole('alert').textContent).toContain('Keine Antwort vom Server.');
    expect(admin.getNews).toHaveBeenCalledTimes(2);   // the list is re-read to show what went out
  });

  it('lists the last sends with their state', async () => {
    await renderSection({ recent: [
      { id: 2, title: 'Halbe Sache', status: 'failed', recipients: 1000, push_recipients: 0, created_at: '2026-10-18T09:00:00Z' },
      { id: 1, title: 'Sommerfest', status: 'sent', recipients: 900, push_recipients: 120, created_at: '2026-10-01T09:00:00Z' },
    ] });
    expect(screen.getByText('Zuletzt gesendet')).toBeTruthy();
    expect(screen.getByText('Halbe Sache').parentElement.textContent).toContain('abgebrochen');
    expect(screen.getByText('Sommerfest').parentElement.textContent).not.toContain('abgebrochen');
  });

  it('a server without the news routes (404) → no section at all', async () => {
    vi.mocked(admin.getNewsAudience).mockRejectedValue(httpError(404, { error: 'Route not found' }));
    vi.mocked(admin.getNews).mockRejectedValue(httpError(404, { error: 'Route not found' }));
    const { container } = render(<AdminNewsSection />);
    await act(async () => {});
    expect(container.innerHTML).toBe('');
  });
});
