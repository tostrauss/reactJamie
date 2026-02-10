// Simple demo Spotify controller for presentation purposes.
// In production you would call the real Spotify Web API here.

// ==========================================
// SEARCH TRACKS (Demo)
// ==========================================
export const searchTracks = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: 'query parameter is required' });
    }

    // Demo: return static mock tracks that look like Spotify results
    const demoResults = [
      {
        id: 'demo-1',
        title: 'Blinding Lights',
        artist: 'The Weeknd',
        album: 'After Hours',
        cover:
          'https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb36',
        preview_url: null
      },
      {
        id: 'demo-2',
        title: 'Levitating',
        artist: 'Dua Lipa',
        album: 'Future Nostalgia',
        cover:
          'https://i.scdn.co/image/ab67616d0000b27377f5c6a13f1b8b3de90b1255',
        preview_url: null
      },
      {
        id: 'demo-3',
        title: query,
        artist: 'Jamie Demo Artist',
        album: 'Jamie Demo Album',
        cover:
          'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400',
        preview_url: null
      }
    ];

    res.json({ items: demoResults });
  } catch (error) {
    console.error('Spotify search demo error:', error);
    res.status(500).json({ error: 'Spotify search failed' });
  }
};