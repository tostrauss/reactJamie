import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatNudgeSheet } from '../components/ChatNudgeSheet';

// Tina's notification concept (03.11.2026): after creating a group and after
// joining one, a sheet sends people straight into the chat. Her texts, real
// German i18n.
describe('ChatNudgeSheet', () => {
  it('after creating: „Deine Gruppe ist bereit! 🎉" with „Erste Nachricht schreiben"', () => {
    const onChat = vi.fn();
    const onClose = vi.fn();
    render(<ChatNudgeSheet variant="created" groupName="Bowling" onChat={onChat} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Deine Gruppe ist bereit! 🎉' })).toBeTruthy();
    expect(screen.getByText('Schreib jetzt eine kurze Begrüßung, damit sich alle willkommen fühlen.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Erste Nachricht schreiben' }));
    expect(onChat).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('after joining: „Du bist bei X dabei!" + „Sag kurz Hallo 👋"; „Später" and Escape close', () => {
    const onChat = vi.fn();
    const onClose = vi.fn();
    render(<ChatNudgeSheet variant="joined" groupName="Spieleabend" onChat={onChat} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Du bist bei Spieleabend dabei!' })).toBeTruthy();
    expect(screen.getByText('Sag kurz Hallo 👋')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hallo sagen' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Später' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onChat).not.toHaveBeenCalled();
  });
});
