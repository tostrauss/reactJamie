import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';

vi.mock('../utils/api', () => ({ messages: { votePoll: vi.fn() } }));
const { messages } = await import('../utils/api');
const { usePollVotes } = await import('../hooks/usePollVotes');

// Optimistic voting (B1): instant tick, one request per poll, latest intent
// wins, merge by version, rollback on error.
const poll = (over = {}) => ({
  kind: 'choice', question: 'q', multi: true, closed: false, version: 1, voter_count: 0,
  options: [{ pos: 0, label: 'A', votes: 0 }, { pos: 1, label: 'B', votes: 0 }],
  my_votes: [], ...over,
});
const deferred = () => { let resolve, reject; const p = new Promise((r, j) => { resolve = r; reject = j; }); return { p, resolve, reject }; };

const setup = (onError = vi.fn()) => renderHook(() => {
  const [list, setMessageList] = useState([{ id: 5, message_type: 'poll', poll: poll() }]);
  const api = usePollVotes({ setMessageList, onError });
  return { list, api };
});

beforeEach(() => vi.mocked(messages.votePoll).mockReset());

describe('usePollVotes', () => {
  it('ticks at once, then adopts the server summary', async () => {
    const d = deferred();
    vi.mocked(messages.votePoll).mockReturnValueOnce(d.p);
    const { result } = setup();
    act(() => { result.current.api.vote(result.current.list[0], [1]); });
    expect(result.current.list[0].poll.my_votes).toEqual([1]);
    expect(result.current.list[0].poll.options[1].votes).toBe(1);
    await act(async () => { d.resolve({ data: { poll: poll({ version: 2, voter_count: 3, my_votes: [1],
      options: [{ pos: 0, label: 'A', votes: 1 }, { pos: 1, label: 'B', votes: 3 }] }) } }); });
    expect(result.current.list[0].poll).toMatchObject({ version: 2, voter_count: 3 });
  });

  it('two fast taps: the second request waits for the first and carries the LATEST choices', async () => {
    const d1 = deferred();
    const d2 = deferred();
    vi.mocked(messages.votePoll).mockReturnValueOnce(d1.p).mockReturnValueOnce(d2.p);
    const { result } = setup();
    act(() => { result.current.api.vote(result.current.list[0], [0]); });
    act(() => { result.current.api.vote(result.current.list[0], [0, 1]); });
    expect(messages.votePoll).toHaveBeenCalledTimes(1);
    await act(async () => { d1.resolve({ data: { poll: poll({ version: 2, my_votes: [0] }) } }); });
    expect(messages.votePoll).toHaveBeenCalledTimes(2);
    expect(messages.votePoll.mock.calls[1]).toEqual([5, [0, 1]]);
    await act(async () => { d2.resolve({ data: { poll: poll({ version: 3, my_votes: [0, 1] }) } }); });
    expect(result.current.list[0].poll).toMatchObject({ version: 3, my_votes: [0, 1] });
  });

  it('an error rolls back to the last confirmed state and reports it', async () => {
    vi.mocked(messages.votePoll).mockRejectedValueOnce(new Error('offline'));
    const onError = vi.fn();
    const { result } = setup(onError);
    await act(async () => { result.current.api.vote(result.current.list[0], [1]); });
    expect(result.current.list[0].poll.my_votes).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a 409 applies the poll the server sent (closed meanwhile)', async () => {
    vi.mocked(messages.votePoll).mockRejectedValueOnce({ response: { data: { code: 'POLL_CLOSED', poll: poll({ version: 4, closed: true }) } } });
    const { result } = setup();
    await act(async () => { result.current.api.vote(result.current.list[0], [1]); });
    expect(result.current.list[0].poll).toMatchObject({ version: 4, closed: true });
  });

  it('a socket update during a flight is stashed and applied only if newer', async () => {
    const d = deferred();
    vi.mocked(messages.votePoll).mockReturnValueOnce(d.p);
    const { result } = setup();
    act(() => { result.current.api.vote(result.current.list[0], [1]); });
    // The room payload never carries anyone's selection.
    const { my_votes: _mine, ...room } = poll({ version: 6, voter_count: 7 });
    act(() => { result.current.api.receive(5, room); });
    expect(result.current.list[0].poll.voter_count).toBe(1); // still the optimistic state
    await act(async () => { d.resolve({ data: { poll: poll({ version: 5, my_votes: [1], voter_count: 6 }) } }); });
    expect(result.current.list[0].poll).toMatchObject({ version: 6, voter_count: 7, my_votes: [1] });
  });

  it('an OLDER socket update stashed during a flight is dropped — the response wins', async () => {
    const d = deferred();
    vi.mocked(messages.votePoll).mockReturnValueOnce(d.p);
    const { result } = setup();
    act(() => { result.current.api.vote(result.current.list[0], [1]); });
    const { my_votes: _mine, ...older } = poll({ version: 4, voter_count: 9 });
    act(() => { result.current.api.receive(5, older); });
    const response = poll({ version: 5, voter_count: 2, my_votes: [1],
      options: [{ pos: 0, label: 'A', votes: 1 }, { pos: 1, label: 'B', votes: 1 }] });
    await act(async () => { d.resolve({ data: { poll: response } }); });
    expect(result.current.list[0].poll).toEqual(response);
  });

  it('is referentially stable across renders', () => {
    const { result, rerender } = setup();
    const first = result.current.api;
    rerender();
    expect(result.current.api).toBe(first);
  });
});
