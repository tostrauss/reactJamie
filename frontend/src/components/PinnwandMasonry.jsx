import { Fragment, useEffect, useState } from 'react';

// Pinterest-style staggered Pinnwand in READING order (Wunsch 10.10.2026,
// Fotos umreihen). Photo i goes into column i % cols, so the order a user sets
// in ProfileEdit reads left → right, then down — like the editor's grid.
//
// The CSS `column-count` it replaces filled each column top → bottom: photo 2
// sat UNDER photo 1, not beside it, so "one place forward" in the editor
// landed somewhere else on the profile. Columns are dealt round-robin, not
// shortest-first: that would need every image's height before layout, and
// would reorder again whenever one loads.
const WIDE = '(min-width: 480px)';
const columnsNow = () =>
  (typeof window !== 'undefined' && window.matchMedia?.(WIDE).matches ? 3 : 2);

export function PinnwandMasonry({ photos, onOpen, itemAriaLabel, addTile = null }) {
  const [cols, setCols] = useState(columnsNow);
  useEffect(() => {
    const mq = typeof window !== 'undefined' ? window.matchMedia?.(WIDE) : null;
    if (!mq?.addEventListener) return undefined;
    const onChange = () => setCols(mq.matches ? 3 : 2);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const columns = Array.from({ length: cols }, () => []);
  photos.forEach((url, i) => {
    columns[i % cols].push(
      <button
        key={`${i}-${url}`}
        type="button"
        className="pinnwand-masonry-item"
        onClick={() => onOpen(i)}
        aria-label={itemAriaLabel}
      >
        <img src={url} alt="" loading="lazy" />
      </button>
    );
  });
  // The add tile (own profile) takes the next reading slot.
  if (addTile) columns[photos.length % cols].push(<Fragment key="add">{addTile}</Fragment>);

  return (
    <div className="pinnwand-masonry pinnwand-masonry--rows">
      {columns.map((col, c) => <div key={c} className="pinnwand-col">{col}</div>)}
    </div>
  );
}

export default PinnwandMasonry;
