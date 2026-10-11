import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfilePhotoPrompt } from '../components/ProfilePhotoPrompt';

// The „Achtung" sheet from Tina's checklist (10.10.2026): shown by „Los
// geht's!" and by a club join while there is no profile picture. Real German
// i18n (vitest.setup), so the copy asserted here is what users read.
const handlers = () => ({ onAdd: vi.fn(), onSkip: vi.fn(), onClose: vi.fn() });

describe('ProfilePhotoPrompt', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<ProfilePhotoPrompt isOpen={false} {...handlers()} />);
    expect(container.innerHTML).toBe('');
  });

  it("shows Tina's copy as a dialog with [Profilbild hinzufügen] [Überspringen]", () => {
    render(<ProfilePhotoPrompt isOpen {...handlers()} />);
    const dialog = screen.getByRole('dialog', { name: 'Achtung: Dein Profil ist nicht vollständig' });
    expect(dialog.textContent).toContain('Füge ein Profilbild hinzu, um Gruppen & Clubs beizutreten.');
    expect(screen.getByRole('button', { name: 'Profilbild hinzufügen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Überspringen' })).toBeTruthy();
    // Same sheet as AvatarGateModal (Home, ClubDetail).
    expect(dialog.classList.contains('avatar-gate-sheet')).toBe(true);
  });

  it('the CTA calls onAdd and „Überspringen" calls onSkip — nothing else', () => {
    const h = handlers();
    render(<ProfilePhotoPrompt isOpen {...h} />);
    fireEvent.click(screen.getByRole('button', { name: 'Profilbild hinzufügen' }));
    expect(h.onAdd).toHaveBeenCalledTimes(1);
    expect(h.onSkip).not.toHaveBeenCalled();
    expect(h.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    expect(h.onSkip).toHaveBeenCalledTimes(1);
    expect(h.onClose).not.toHaveBeenCalled();
  });

  it('a tap on the backdrop only closes; a tap inside the sheet does not', () => {
    const h = handlers();
    render(<ProfilePhotoPrompt isOpen {...h} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(h.onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.modal-overlay'));
    expect(h.onClose).toHaveBeenCalledTimes(1);
    expect(h.onAdd).not.toHaveBeenCalled();
    expect(h.onSkip).not.toHaveBeenCalled();
  });

  it('Escape closes it; focus moves into the dialog on open', () => {
    const h = handlers();
    const { rerender } = render(<ProfilePhotoPrompt isOpen={false} {...h} />);
    rerender(<ProfilePhotoPrompt isOpen {...h} />);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it('stops listening for Escape once closed', () => {
    const h = handlers();
    const { rerender } = render(<ProfilePhotoPrompt isOpen {...h} />);
    rerender(<ProfilePhotoPrompt isOpen={false} {...h} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(h.onClose).not.toHaveBeenCalled();
  });
});
