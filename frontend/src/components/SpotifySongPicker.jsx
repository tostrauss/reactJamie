import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { spotify } from '../utils/api';
import '../styles/profile.css';

const SpotifySongPicker = ({ currentSong, onSelect, onRemove }) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      const { signal } = abortRef.current;

      setLoading(true);
      try {
        const res = await spotify.search(query, { signal });
        if (!signal.aborted) setResults(res.data?.items || []);
      } catch (err) {
        if (err.name !== 'AbortError' && err.name !== 'CanceledError') {
          setResults([]);
        }
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [query]);

  const handleSelect = (song) => {
    onSelect({
      title: song.title,
      artist: song.artist,
      album: song.album,
      cover: song.cover,
      preview_url: song.preview_url
    });
    setIsOpen(false);
    setQuery('');
    setResults([]);
  };

  // Current song display
  if (!isOpen) {
    return (
      <div className="song-picker">
        {currentSong ? (
          <div className="song-picker-current">
            <div className="favorite-song">
              {currentSong.cover && (
                <img src={currentSong.cover} alt={currentSong.title} className="song-cover" loading="lazy" decoding="async" />
              )}
              <div className="song-info">
                <span className="song-title">{currentSong.title}</span>
                <span className="song-artist">{currentSong.artist}</span>
              </div>
            </div>
            {/* Without these the song was permanently locked once set — there
                was no control to reopen the search or clear it. */}
            <div className="song-picker-actions">
              <button
                type="button"
                className="song-picker-btn change"
                onClick={() => setIsOpen(true)}
              >
                {t('spotify.songPicker.change')}
              </button>
              {onRemove && (
                <button
                  type="button"
                  className="song-picker-btn remove"
                  onClick={() => onRemove()}
                >
                  {t('spotify.songPicker.remove')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="song-picker-add"
            onClick={() => setIsOpen(true)}
          >
            <span className="song-picker-add-icon">🎵</span>
            <span>{t('spotify.songPicker.addBtn')}</span>
          </button>
        )}
      </div>
    );
  }

  // Search overlay
  return (
    <div className="song-picker-search">
      <div className="song-picker-search-header">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('spotify.songPicker.searchPlaceholder')}
          className="song-picker-input"
          autoFocus
        />
        <button
          type="button"
          className="song-picker-close"
          onClick={() => {
            setIsOpen(false);
            setQuery('');
            setResults([]);
          }}
        >
          {t('spotify.songPicker.cancel')}
        </button>
      </div>

      <div className="song-picker-results">
        {loading && (
          <div className="song-picker-loading">{t('spotify.songPicker.searching')}</div>
        )}

        {!loading && query.length >= 2 && results.length === 0 && (
          <div className="song-picker-empty">{t('spotify.songPicker.empty')}</div>
        )}

        {results.map((song) => (
          <button
            key={song.id}
            type="button"
            className="song-picker-result"
            onClick={() => handleSelect(song)}
          >
            {song.cover ? (
              <img src={song.cover} alt={song.title} className="song-result-cover" loading="lazy" decoding="async" />
            ) : (
              <div className="song-result-cover placeholder">🎵</div>
            )}
            <div className="song-result-info">
              <span className="song-result-title">{song.title}</span>
              <span className="song-result-artist">{song.artist}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default SpotifySongPicker;
