import React from 'react';

/**
 * Renders a user's display name with their age as a small superscript:
 *
 *   Lena²⁸
 *
 * Used everywhere a user name is shown EXCEPT inside chats (group chat,
 * direct-message bubbles, chat list rows) — that's a deliberate exclusion.
 *
 * Falls back gracefully:
 * - no `name` → renders the provided `fallback` (default `?`)
 * - no `age`  → renders only the name, no superscript
 *
 * Accept `className` so consumers can keep their existing name styling
 * (color, font-weight, ellipsis) on the wrapping span.
 */
export function UserName({ name, age, fallback = '?', className = '', style }) {
  const display = name || fallback;
  return (
    <span className={className} style={style}>
      {display}
      {Number.isFinite(Number(age)) && Number(age) > 0 && (
        <sup className="user-age-sup" aria-label={`Alter ${age}`}>{age}</sup>
      )}
    </span>
  );
}

export default UserName;
