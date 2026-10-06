import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PollComposerSheet } from '../components/PollComposerSheet';

// "Neue Umfrage" sheet (B1) — real German i18n, today injected.
const TODAY = '2026-10-06';
const setup = (props = {}) => {
  const onSubmit = props.onSubmit || vi.fn(async () => {});
  const onClose = vi.fn();
  render(<PollComposerSheet today={TODAY} locale="de-DE" onSubmit={onSubmit} onClose={onClose} {...props} />);
  return { onSubmit, onClose };
};
const submitBtn = () => screen.getByRole('button', { name: 'Umfrage senden' });

afterEach(() => vi.restoreAllMocks());

describe('PollComposerSheet', () => {
  it('opens on "Termin finden" with the default question and tomorrow + the day after', () => {
    setup();
    expect(screen.getByLabelText('Frage').value).toBe('Wann passt es euch?');
    expect(screen.getByLabelText('Datum für Termin 1').value).toBe('2026-10-07');
    expect(screen.getByLabelText('Datum für Termin 2').value).toBe('2026-10-08');
    expect(submitBtn().disabled).toBe(false);
  });

  it('"+ Termin hinzufügen" continues after the last date', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Termin hinzufügen/ }));
    expect(screen.getByLabelText('Datum für Termin 3').value).toBe('2026-10-09');
  });

  it('sends the date payload (multi forced, null without time)', async () => {
    const { onSubmit } = setup();
    fireEvent.change(screen.getByLabelText('Uhrzeit für Termin 2 (optional)'), { target: { value: '18:00' } });
    await act(async () => { fireEvent.click(submitBtn()); });
    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'date', question: 'Wann passt es euch?', multi: true,
      options: [{ date: '2026-10-07', time: null }, { date: '2026-10-08', time: '18:00' }],
    });
  });

  it('choice mode: disabled until two distinct labels; a duplicate shows its hint', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Abstimmung/ }));
    expect(screen.getByLabelText('Frage').value).toBe(''); // the date default is cleared
    fireEvent.change(screen.getByLabelText('Frage'), { target: { value: 'Was machen wir?' } });
    expect(submitBtn().disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Option 1'), { target: { value: 'Kino' } });
    fireEvent.change(screen.getByPlaceholderText('Option 2'), { target: { value: ' kino' } });
    expect(screen.getByText('Diese Option gibt es schon.')).toBeTruthy();
    expect(submitBtn().disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Option 2'), { target: { value: 'Bowling' } });
    expect(submitBtn().disabled).toBe(false);
  });

  it('sends the choice payload with the multi toggle', async () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Abstimmung/ }));
    fireEvent.change(screen.getByLabelText('Frage'), { target: { value: 'Was machen wir?' } });
    fireEvent.change(screen.getByPlaceholderText('Option 1'), { target: { value: 'Kino' } });
    fireEvent.change(screen.getByPlaceholderText('Option 2'), { target: { value: 'Bowling' } });
    fireEvent.click(screen.getByLabelText('Mehrere Antworten erlauben'));
    await act(async () => { fireEvent.click(submitBtn()); });
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'choice', question: 'Was machen wir?', multi: true,
      options: [{ label: 'Kino' }, { label: 'Bowling' }] });
  });

  // Generous timeout: ten rows of real pickers under jsdom take seconds in a
  // full parallel run (it hit the 5 s default there).
  it('the add button disappears at 10 rows; remove only shows above 2', { timeout: 20_000 }, () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Option entfernen' })).toBeNull();
    for (let i = 0; i < 8; i++) fireEvent.click(screen.getByRole('button', { name: /Termin hinzufügen/ }));
    expect(screen.queryByRole('button', { name: /Termin hinzufügen/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Option entfernen' })).toHaveLength(10);
  });

  it('inputs carry the mirrored limits', () => {
    setup();
    expect(screen.getByLabelText('Frage').getAttribute('maxLength')).toBe('140');
    fireEvent.click(screen.getByRole('button', { name: /Abstimmung/ }));
    expect(screen.getByPlaceholderText('Option 1').getAttribute('maxLength')).toBe('60');
  });

  it('a server rejection shows the translated reason and keeps the draft', async () => {
    const onSubmit = vi.fn(async () => { throw { response: { data: { code: 'POLL_INVALID' } } }; });
    setup({ onSubmit });
    await act(async () => { fireEvent.click(submitBtn()); });
    expect(screen.getByText('Bitte prüfe Frage und Optionen.')).toBeTruthy();
    expect(screen.getByLabelText('Frage').value).toBe('Wann passt es euch?');
    expect(submitBtn().disabled).toBe(false);
  });

  it('says why "Umfrage senden" is off when the question is empty', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Abstimmung/ }));
    fireEvent.change(screen.getByPlaceholderText('Option 1'), { target: { value: 'Kino' } });
    fireEvent.change(screen.getByPlaceholderText('Option 2'), { target: { value: 'Bowling' } });
    expect(submitBtn().disabled).toBe(true);
    expect(screen.getByText('Bitte gib eine Frage ein.')).toBeTruthy();
    expect(screen.getByLabelText('Frage').getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(screen.getByLabelText('Frage'), { target: { value: 'Was machen wir?' } });
    expect(screen.queryByText('Bitte gib eine Frage ein.')).toBeNull();
    expect(submitBtn().disabled).toBe(false);
  });

  it('a server without the poll routes (rollback) shows our message, not "Route not found"', async () => {
    const onSubmit = vi.fn(async () => { throw { response: { status: 404, data: { error: 'Route not found' } } }; });
    setup({ onSubmit });
    await act(async () => { fireEvent.click(submitBtn()); });
    expect(screen.getByText('Umfrage konnte nicht gesendet werden.')).toBeTruthy();
    expect(screen.queryByText('Route not found')).toBeNull();
  });

  it('a double tap submits once', async () => {
    let resolve;
    const onSubmit = vi.fn(() => new Promise((r) => { resolve = r; }));
    setup({ onSubmit });
    await act(async () => { fireEvent.click(submitBtn()); fireEvent.click(submitBtn()); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(); });
  });

  it('✕ closes a pristine draft at once, asks before discarding a changed one', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Frage'), { target: { value: 'Neu?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
