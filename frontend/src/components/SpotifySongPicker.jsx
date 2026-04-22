import { useState, useEffect, useRef } from 'react';
import { spotify } from '../utils/api';
import '../styles/profile.css';

const SpotifySongPicker = ({ currentSong, onSelect, onRemove }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await spotify.search(query);
        setResults(res.data?.items || []);
      } catch (err) {
        console.error('Search error:', err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
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
                <img src={currentSong.cover} alt={currentSong.title} className="song-cover" />
              )}
              <div className="song-info">
                <span className="song-title">{currentSong.title}</span>
                <span className="song-artist">{currentSong.artist}</span>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="song-picker-add"
            onClick={() => setIsOpen(true)}
          >
            <span className="song-picker-add-icon">🎵</span>
            <span>Lieblingssong hinzufügen</span>
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
          placeholder="Song oder Künstler suchen..."
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
          Abbrechen
        </button>
      </div>

      <div className="song-picker-results">
        {loading && (
          <div className="song-picker-loading">Suche...</div>
        )}

        {!loading && query.length >= 2 && results.length === 0 && (
          <div className="song-picker-empty">Keine Ergebnisse</div>
        )}

        {results.map((song) => (
          <button
            key={song.id}
            type="button"
            className="song-picker-result"
            onClick={() => handleSelect(song)}
          >
            {song.cover ? (
              <img src={song.cover} alt={song.title} className="song-result-cover" />
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
