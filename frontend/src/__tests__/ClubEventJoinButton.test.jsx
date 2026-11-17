import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// The join button of an event in a club's event list (audit
// ziel-d-privat-events, contract V-14): it used to say „Beitreten“ on every
// event, also on one that only takes requests — and the second tap ran into a
// 400. Real German i18n; groups.join is mocked.
const api = vi.hoisted(() => ({ groups: { join: vi.fn() } }));
vi.mock('../utils/api', () => api);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));

const { default: ClubEventJoinButton } = await import('../components/ClubEventJoinButton');

const USER = { id: 5, name: 'Mia' };
const event = (over = {}) => ({ id: 31, name: 'Clubabend', is_member: false, members_count: 4, ...over });
const refusal = (status, data) => ({ response: { status, data } });

// The event lives in the parent's list — exactly how ClubDetail merges the
// patch, and with the same wrapper: .cd-event-actions stops every click
// inside it from opening the event (ClubDetail.jsx).
const cardClick = vi.fn();
const onChange = vi.fn();
const onNeedAvatar = vi.fn();
const onNeedLogin = vi.fn();
function Card({ initial, user = USER }) {
  const [ev, setEv] = useState(initial);
  return (
    <div className="cd-event-card" onClick={cardClick}>
      <div className="cd-event-actions" onClick={(e) => e.stopPropagation()}>
        {ev.is_member
          ? <span data-testid="member">dabei · {ev.members_count}</span>
          : (
            <ClubEventJoinButton
              ev={ev}
              user={user}
              onChange={(patch) => { onChange(patch); setEv((prev) => ({ ...prev, ...patch })); }}
              onNeedAvatar={onNeedAvatar}
              onNeedLogin={onNeedLogin}
            />
          )}
      </div>
    </div>
  );
}
const renderCard = (over, user) => render(<Card initial={event(over)} user={user} />);
const button = () => screen.getByRole('button');
const tap = async () => { await act(async () => { fireEvent.click(button()); }); };

beforeEach(() => {
  vi.clearAllMocks();
  api.groups.join.mockResolvedValue({ data: { message: 'ok' } });
});

describe('ClubEventJoinButton — what the button says', () => {
  it('an open event: „Beitreten“', () => {
    renderCard({ joins_by_request: false, join_request_status: null, join_request_blocked: false });
    expect(button().textContent).toBe('Beitreten');
    expect(button().disabled).toBe(false);
    expect(button().className).toBe('cd-event-join-btn');
  });

  it('an event that takes requests (private event, public club): „Beitritt anfragen“', () => {
    renderCard({ joins_by_request: true, join_request_status: null, join_request_blocked: false });
    expect(button().textContent).toBe('Beitritt anfragen');
    expect(button().disabled).toBe(false);
  });

  it('the list already says pending: „Anfrage ausstehend…“, disabled at once', async () => {
    renderCard({ joins_by_request: true, join_request_status: 'pending', join_request_blocked: false });
    expect(button().textContent).toBe('Anfrage ausstehend…');
    expect(button().disabled).toBe(true);
    await tap();
    expect(api.groups.join).not.toHaveBeenCalled();
  });

  it('two rejections: „Anfrage abgelehnt“, disabled', () => {
    renderCard({ joins_by_request: true, join_request_status: 'rejected', join_request_blocked: true });
    expect(button().textContent).toBe('Anfrage abgelehnt');
    expect(button().disabled).toBe(true);
  });

  it('a private club\'s event (joins_by_request false, even with an old request row): „Beitreten“', () => {
    renderCard({ is_private: true, joins_by_request: false, join_request_status: 'pending', join_request_blocked: false });
    expect(button().textContent).toBe('Beitreten');
    expect(button().disabled).toBe(false);
  });

  it('an older server sends none of the fields: „Beitreten“ exactly as before', () => {
    renderCard({});
    expect(button().textContent).toBe('Beitreten');
    expect(button().disabled).toBe(false);
  });

  // Sichtprüfung 17.11.2026: on one line „Anfrage ausstehend…“ pushed the
  // event's name down to „W…“ at 390 px (the card also holds the calendar
  // button). The label may wrap, in every state.
  it('a long label may wrap onto two lines instead of squeezing the event name out', () => {
    for (const over of [
      {},
      { joins_by_request: true },
      { joins_by_request: true, join_request_status: 'pending' },
      { joins_by_request: true, join_request_blocked: true },
    ]) {
      const { unmount } = renderCard(over);
      expect(button().style.whiteSpace).toBe('normal');
      expect(button().style.maxWidth).toBe('104px');
      unmount();
    }
  });
});

describe('ClubEventJoinButton — the tap', () => {
  it('a request goes out once: the button turns into „Anfrage ausstehend…“ and a second tap sends nothing', async () => {
    api.groups.join.mockResolvedValue({ data: { status: 'pending' } });
    const asked = vi.fn();
    window.addEventListener('jamie:push-prompt-after-join', asked);
    renderCard({ joins_by_request: true, join_request_status: null, join_request_blocked: false });
    await tap();
    window.removeEventListener('jamie:push-prompt-after-join', asked);
    expect(api.groups.join).toHaveBeenCalledTimes(1);
    expect(api.groups.join).toHaveBeenCalledWith(31);
    expect(onChange).toHaveBeenCalledWith({ joins_by_request: true, join_request_status: 'pending' });
    expect(toast.success).toHaveBeenCalledWith('Beitrittsanfrage gesendet');
    expect(asked).toHaveBeenCalledTimes(1);           // the contextual push ask, as before
    expect(button().textContent).toBe('Anfrage ausstehend…');
    expect(button().disabled).toBe(true);
    await tap();
    expect(api.groups.join).toHaveBeenCalledTimes(1);
    // The card around it never opened the event.
    expect(cardClick).not.toHaveBeenCalled();
  });

  it('an older server (no fields) answers pending: the button learns it from the answer', async () => {
    api.groups.join.mockResolvedValue({ data: { status: 'pending' } });
    renderCard({});
    expect(button().textContent).toBe('Beitreten');
    await tap();
    expect(button().textContent).toBe('Anfrage ausstehend…');
    expect(button().disabled).toBe(true);
  });

  it('a direct join: the parent gets is_member and the new head count', async () => {
    renderCard({ joins_by_request: false });
    await tap();
    expect(onChange).toHaveBeenCalledWith({ is_member: true, members_count: 5 });
    expect(toast.success).toHaveBeenCalledWith('Du bist dabei!');
    expect(screen.getByTestId('member').textContent).toBe('dabei · 5');
  });

  it('while the join runs the button is disabled and shows „…“', async () => {
    let finish;
    api.groups.join.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderCard({ joins_by_request: true });
    await tap();
    expect(button().textContent).toBe('…');
    expect(button().disabled).toBe(true);
    fireEvent.click(button());
    expect(api.groups.join).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ data: { status: 'pending' } }); });
    expect(button().textContent).toBe('Anfrage ausstehend…');
  });

  it('400 JOIN_REQUEST_PENDING (the request was already open): pending state, an info in the app\'s language, no error toast', async () => {
    api.groups.join.mockRejectedValue(refusal(400, { error: 'Beitrittsanfrage bereits ausstehend', code: 'JOIN_REQUEST_PENDING' }));
    renderCard({ joins_by_request: true, join_request_status: null });
    await tap();
    expect(onChange).toHaveBeenCalledWith({ joins_by_request: true, join_request_status: 'pending' });
    expect(toast.info).toHaveBeenCalledWith('Deine Beitrittsanfrage wartet noch auf eine Antwort.');
    expect(toast.error).not.toHaveBeenCalled();
    expect(button().textContent).toBe('Anfrage ausstehend…');
    expect(button().disabled).toBe(true);
  });

  it('…also from a server that sends the 400 without a code (the German sentence is all there is)', async () => {
    api.groups.join.mockRejectedValue(refusal(400, { error: 'Beitrittsanfrage bereits ausstehend' }));
    renderCard({});
    await tap();
    expect(onChange).toHaveBeenCalledWith({ joins_by_request: true, join_request_status: 'pending' });
    expect(toast.error).not.toHaveBeenCalled();
    expect(button().textContent).toBe('Anfrage ausstehend…');
  });

  it('403 JOIN_REQUEST_BLOCKED: „Anfrage abgelehnt“, disabled, no toast', async () => {
    api.groups.join.mockRejectedValue(refusal(403, {
      error: 'Du hast bereits zweimal angefragt und wurdest abgelehnt. Eine weitere Anfrage ist nicht möglich.',
      code: 'JOIN_REQUEST_BLOCKED',
    }));
    renderCard({ joins_by_request: true, join_request_status: 'rejected' });
    await tap();
    expect(onChange).toHaveBeenCalledWith({ join_request_blocked: true });
    expect(button().textContent).toBe('Anfrage abgelehnt');
    expect(button().disabled).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('no profile photo yet: the avatar gate, nothing else', async () => {
    api.groups.join.mockRejectedValue(refusal(403, { error: 'Bitte lade zuerst ein Profilbild hoch, um beizutreten.', requiresAvatar: true }));
    renderCard({ joins_by_request: true });
    await tap();
    expect(onNeedAvatar).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(button().textContent).toBe('Beitritt anfragen');
    expect(button().disabled).toBe(false);
  });

  it('any other refusal: one error toast (a code is translated, else the server\'s sentence), the button stays usable', async () => {
    api.groups.join.mockRejectedValue(refusal(400, { error: 'Die Gruppe ist bereits voll' }));
    renderCard({});
    await tap();
    expect(toast.error).toHaveBeenCalledWith('Die Gruppe ist bereits voll');
    expect(onChange).not.toHaveBeenCalled();
    expect(button().textContent).toBe('Beitreten');
    expect(button().disabled).toBe(false);
  });

  it('no answer at all (offline): the app\'s own network sentence', async () => {
    api.groups.join.mockRejectedValue(new Error('Network Error'));
    renderCard({});
    await tap();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0][0]).not.toBe('Network Error');
    expect(button().disabled).toBe(false);
  });

  it('not logged in: onNeedLogin, no request', async () => {
    renderCard({ joins_by_request: true }, null);
    await tap();
    expect(onNeedLogin).toHaveBeenCalledTimes(1);
    expect(api.groups.join).not.toHaveBeenCalled();
    expect(cardClick).not.toHaveBeenCalled();
  });

  // V-14: the wrapper stops clicks already — the button does it too, so it
  // is safe wherever it is placed.
  it('the tap never reaches what the button sits in, even without the list\'s wrapper', async () => {
    const outer = vi.fn();
    render(
      <div onClick={outer}>
        <ClubEventJoinButton ev={event({ joins_by_request: true })} user={USER} onChange={onChange} />
      </div>,
    );
    await tap();
    expect(api.groups.join).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});
