import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pins what happens AFTER a chat message is persisted — the live broadcast,
// the chat-list nudge and the push — so moving that block into
// deliverGroupMessage() (B1: polls reuse it) cannot change a single emit.
// Written against the inline code first; must stay green after the move.
process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

const state = { members: [], memberQueryFails: false };

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text, params) => {
      if (text.includes('FROM groups g') && text.includes('LEFT JOIN group_members gm')) {
        return { rows: [{ type: 'group', group_name: 'Yoga am Kanal', owner_id: 1, chat_only_owner: false, member_user_id: params[1] }] };
      }
      if (text.includes('INSERT INTO messages')) {
        const [groupId, userId, content, type, , durationMs, mediaUrl] = params;
        return { rows: [{ id: 501, group_id: groupId, user_id: userId, content, message_type: type, duration_ms: durationMs,
          media_url: mediaUrl, reply_to_id: null, created_at: '2026-10-06T10:00:00Z', user_name: 'Anna', avatar_url: null }] };
      }
      if (text.includes('SELECT user_id, notifications_muted FROM group_members')) {
        if (state.memberQueryFails) throw new Error('pool exhausted');
        return { rows: state.members };
      }
      return { rows: [] };
    }),
    pool: { connect: vi.fn() },
  },
}));
vi.mock('../../src/config/moderation.js', () => ({ checkTextSafety: vi.fn(async () => ({ safe: true })) }));
vi.mock('../../src/utils/safeUrl.js', () => ({ isSafeVoiceUrl: () => true, isSafeChatImageUrl: () => true }));
const sendPushToUsers = vi.fn(async () => []);
vi.mock('../../src/controllers/pushController.js', () => ({
  sendPushToUsers: (...a) => sendPushToUsers(...a),
  PUSH_CONVERSATION: Object.freeze({ urgency: 'high', ttl: 86400 }),
}));
vi.mock('../../src/config/sentry.js', () => ({ initSentry: vi.fn(), Sentry: { captureException: vi.fn() } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));

const { sendMessage } = await import('../../src/controllers/messageController.js');

const emits = [];
const makeIo = () => {
  const chain = (room, except = null) => ({
    except: (ex) => chain(room, ex),
    emit: (ev, payload) => { emits.push({ room, except, ev, payload }); },
  });
  return { to: (room) => chain(room), in: () => ({ fetchSockets: async () => [] }) };
};
const makeRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.headersSent = false;
  return res;
};
let groupSeq = 4200;
const send = async (body) => {
  const groupId = ++groupSeq; // unique per test: the push cooldown is module-level
  const io = makeIo();
  const res = makeRes();
  await sendMessage({ userId: 7, body: { groupId, ...body }, app: { get: (k) => (k === 'io' ? io : undefined) } }, res);
  return { res, groupId };
};

beforeEach(() => {
  emits.length = 0;
  sendPushToUsers.mockClear();
  state.members = [{ user_id: 8, notifications_muted: false }, { user_id: 9, notifications_muted: true }];
  state.memberQueryFails = false;
});

describe('group message delivery (pinned before the deliverGroupMessage extraction)', () => {
  it('text: room broadcast without the sender, nudge to member rooms, push to non-muted members', async () => {
    const { res, groupId } = await send({ content: 'hallo' });
    expect(res.status).toHaveBeenCalledWith(201);
    const live = emits.find((e) => e.ev === 'receive_message');
    expect(live).toMatchObject({ room: String(groupId), except: 'user_7' });
    expect(live.payload).toMatchObject({ id: 501, content: 'hallo', message_type: 'text' });
    const nudge = emits.find((e) => e.ev === 'group_message_notification');
    expect(nudge.room).toEqual(['user_8', 'user_9']);
    expect(nudge.payload).toEqual({ group_id: groupId, group_type: 'group', user_name: 'Anna', message_type: 'text', content: 'hallo' });
    expect(sendPushToUsers).toHaveBeenCalledTimes(1);
    const [recipients, builder, body, url, opts] = sendPushToUsers.mock.calls[0];
    expect(recipients).toEqual([8]);
    expect(body).toBeNull();
    expect(url).toBe(`/chat/${groupId}`);
    expect(opts).toEqual({ urgency: 'high', ttl: 86400 });
    expect(builder('de')).toEqual({ title: 'Yoga am Kanal', body: 'Anna: hallo' });
  });

  it('voice: the nudge carries the stored label (old chat lists), the type travels, push body is the per-locale label', async () => {
    await send({ content: '/media/uploads/a.webm', message_type: 'voice', duration_ms: 3000 });
    const nudge = emits.find((e) => e.ev === 'group_message_notification');
    expect(nudge.payload).toMatchObject({ message_type: 'voice', content: '🎤 Sprachnachricht' });
    const builder = sendPushToUsers.mock.calls[0][1];
    expect(builder('en').body).toBe('Anna: 🎤 Voice message');
  });

  it('image: the nudge carries the photo label, push body is the photo label', async () => {
    await send({ content: '/media/uploads/p.webp', message_type: 'image' });
    const nudge = emits.find((e) => e.ev === 'group_message_notification');
    expect(nudge.payload).toMatchObject({ message_type: 'image', content: '📷 Foto' });
    expect(sendPushToUsers.mock.calls[0][1]('de').body).toBe('Anna: 📷 Foto');
  });

  it('a failing member query after the 201 is swallowed (logged), never a second response', async () => {
    state.memberQueryFails = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res } = await send({ content: 'hallo' });
    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(sendPushToUsers).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
