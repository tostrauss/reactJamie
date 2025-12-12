// Note: Node.js v18+ supports 'fetch' natively. 
// If you are on an older version, you may need to install 'axios' or 'node-fetch'.

let spotifyToken = null;
let tokenExpiration = 0;

const getSpotifyToken = async () => {
  // Return cached token if valid
  if (spotifyToken && Date.now() < tokenExpiration) {
    return spotifyToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Spotify credentials not configured');
  }

  // Request new token using Client Credentials Flow
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
    },
    body: 'grant_type=client_credentials'
  });

  const data = await response.json();
  
  if (data.error) {
    throw new Error(`Spotify Auth Error: ${data.error_description || data.error}`);
  }

  spotifyToken = data.access_token;
  // Set expiration (usually 1 hour, minus a small buffer)
  tokenExpiration = Date.now() + (data.expires_in * 1000) - 60000;
  
  return spotifyToken;
};

export const searchTracks = async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.json([]);

    const token = await getSpotifyToken();
    
    const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await response.json();
    
    if (!data.tracks) return res.json([]);

    // Format the response for the frontend
    const tracks = data.tracks.items.map(track => ({
      id: track.id,
      title: track.name,
      artist: track.artists[0].name,
      cover_url: track.album.images[0]?.url, // High res
      preview_url: track.preview_url,
      spotify_url: track.external_urls.spotify
    }));

    res.json(tracks);
  } catch (error) {
    console.error('Spotify Search Error:', error);
    res.status(500).json({ error: 'Failed to search spotify' });
  }
};