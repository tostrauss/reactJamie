import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GoogleMap,
  Marker,
  InfoWindow,
  useLoadScript,
} from '@react-google-maps/api';
import { useNavigate } from 'react-router-dom';
import { map as mapApi } from '../utils/api';
import { CATEGORY_HIERARCHY } from '../utils/categories';

// Must be a stable reference — recreating it triggers a full Maps reload
const LIBRARIES = [];

const WIEN = { lat: 48.2082, lng: 16.3738 };

const DARK_MAP_STYLES = [
  { elementType: 'geometry',            stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.icon',         stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill',    stylers: [{ color: '#7b7b9a' }] },
  { elementType: 'labels.text.stroke',  stylers: [{ color: '#1a1a2e' }] },
  { featureType: 'administrative',          elementType: 'geometry',           stylers: [{ color: '#2d2d4e' }] },
  { featureType: 'administrative.country',  elementType: 'labels.text.fill',  stylers: [{ color: '#9e9ec4' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill',  stylers: [{ color: '#c0c0e0' }] },
  { featureType: 'poi',        elementType: 'labels.text.fill', stylers: [{ color: '#8b8bb0' }] },
  { featureType: 'poi.park',   elementType: 'geometry',         stylers: [{ color: '#162030' }] },
  { featureType: 'poi.park',   elementType: 'labels.text.fill', stylers: [{ color: '#3C7680' }] },
  { featureType: 'road',          elementType: 'geometry.fill',    stylers: [{ color: '#2d2d4e' }] },
  { featureType: 'road',          elementType: 'labels.text.fill', stylers: [{ color: '#6b6b8c' }] },
  { featureType: 'road.arterial', elementType: 'geometry',         stylers: [{ color: '#32325a' }] },
  { featureType: 'road.highway',  elementType: 'geometry',         stylers: [{ color: '#3d3d6b' }] },
  { featureType: 'road.highway',  elementType: 'labels.text.fill', stylers: [{ color: '#8080a8' }] },
  { featureType: 'road.local',    elementType: 'labels.text.fill', stylers: [{ color: '#5a5a7a' }] },
  { featureType: 'transit.line',    elementType: 'geometry', stylers: [{ color: '#2d2d4e' }] },
  { featureType: 'transit.station', elementType: 'geometry', stylers: [{ color: '#2d2d4e' }] },
  { featureType: 'water', elementType: 'geometry',         stylers: [{ color: '#0d1b2a' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#364d6b' }] },
];

const MAP_OPTIONS = {
  styles: DARK_MAP_STYLES,
  disableDefaultUI: true,
  gestureHandling: 'greedy',
  clickableIcons: false,
};

// Build emoji lookup
const CATEGORY_EMOJI = {};
for (const cat of CATEGORY_HIERARCHY) {
  CATEGORY_EMOJI[cat.id] = cat.icon;
  CATEGORY_EMOJI[cat.label.toLowerCase()] = cat.icon;
  for (const sub of cat.subs) {
    CATEGORY_EMOJI[sub.name.toLowerCase()] = sub.icon;
  }
}
function getEmoji(category) {
  if (!category) return '✨';
  return CATEGORY_EMOJI[category.toLowerCase()] ?? '✨';
}

// Custom SVG marker — called only after Maps is loaded (window.google exists)
function makeMarkerIcon(emoji, active = false) {
  const bg     = active ? '#FD7666' : '#291C4B';
  const stroke = active ? '#ff9f95' : '#392B58';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="56" viewBox="0 0 48 56">
    <circle cx="24" cy="22" r="20" fill="${bg}" stroke="${stroke}" stroke-width="2.5"/>
    <text x="24" y="30" text-anchor="middle" font-size="20"
      font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${emoji}</text>
    <polygon points="16,40 32,40 24,54" fill="${bg}"/>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(48, 56),
    anchor:     new window.google.maps.Point(24, 56),
  };
}

const SESSION_KEY = 'jamie_map_category';

export default function MapView({ typeFilter }) {
  const navigate = useNavigate();
  const mapRef = useRef(null);

  const [pins,             setPins]            = useState([]);
  const [loading,          setLoading]         = useState(true);
  const [selectedPin,      setSelectedPin]     = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(() => {
    try { return sessionStorage.getItem(SESSION_KEY) || null; } catch { return null; }
  });

  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '',
    libraries: LIBRARIES,
    language: 'de',
    region: 'AT',
  });

  // ── Fetch pins ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const params = {};
        if (typeFilter && typeFilter !== 'all') params.type = typeFilter;
        if (selectedCategory) {
          const cat = CATEGORY_HIERARCHY.find(c => c.id === selectedCategory);
          if (cat) params.categories = cat.subs.map(s => s.name).join(',');
        }
        const res = await mapApi.getPins(params);
        if (!cancelled) setPins(res.data || []);
      } catch {
        // silently fail — map still shows
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [typeFilter, selectedCategory]);

  // ── Fit bounds when pins change ───────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !window.google || pins.length === 0) return;
    if (pins.length === 1) {
      mapRef.current.panTo({ lat: pins[0].lat, lng: pins[0].lng });
      mapRef.current.setZoom(13);
      return;
    }
    const bounds = new window.google.maps.LatLngBounds();
    pins.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
    mapRef.current.fitBounds(bounds, 60);
  }, [pins]);

  const onMapLoad = useCallback((map) => { mapRef.current = map; }, []);

  const updateCategory = (cat) => {
    setSelectedCategory(cat);
    setSelectedPin(null);
    try {
      if (cat) sessionStorage.setItem(SESSION_KEY, cat);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* private browsing */ }
  };

  const handleLocate = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!mapRef.current) return;
        mapRef.current.panTo({ lat: coords.latitude, lng: coords.longitude });
        mapRef.current.setZoom(14);
      },
      () => {}
    );
  };

  if (loadError) {
    return (
      <div className="map-container">
        <div className="map-load-error">
          <span>🗺️</span>
          <p>Karte konnte nicht geladen werden.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="map-container">

      {/* Category filter strip */}
      <div className="map-category-strip">
        <button
          className={`map-cat-pill${!selectedCategory ? ' active' : ''}`}
          onClick={() => updateCategory(null)}
        >
          Alle
        </button>
        {CATEGORY_HIERARCHY.map(cat => (
          <button
            key={cat.id}
            className={`map-cat-pill${selectedCategory === cat.id ? ' active' : ''}`}
            onClick={() => updateCategory(selectedCategory === cat.id ? null : cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {(!isLoaded || loading) && (
        <div className="map-loading">
          <div className="home-spinner" />
        </div>
      )}

      {isLoaded && (
        <GoogleMap
          mapContainerClassName="map-leaflet"
          center={WIEN}
          zoom={10}
          options={MAP_OPTIONS}
          onLoad={onMapLoad}
          onClick={() => setSelectedPin(null)}
        >
          {pins.map(pin => (
            <Marker
              key={pin.id}
              position={{ lat: pin.lat, lng: pin.lng }}
              icon={makeMarkerIcon(getEmoji(pin.category), selectedPin?.id === pin.id)}
              onClick={() => setSelectedPin(pin)}
              zIndex={selectedPin?.id === pin.id ? 10 : 1}
            />
          ))}

          {selectedPin && (
            <InfoWindow
              position={{ lat: selectedPin.lat, lng: selectedPin.lng }}
              onCloseClick={() => setSelectedPin(null)}
              options={{
                disableAutoPan: false,
                pixelOffset: new window.google.maps.Size(0, -58),
                maxWidth: 240,
              }}
            >
              <div className="map-popup" onClick={() => navigate(`/group/${selectedPin.id}`)}>
                {selectedPin.image_url && (
                  <img src={selectedPin.image_url} alt={selectedPin.name} className="map-popup-img" />
                )}
                <div className="map-popup-body">
                  <div className="map-popup-badges">
                    <span className={`map-popup-type ${selectedPin.type}`}>
                      {selectedPin.type === 'club' ? 'Club' : 'Gruppe'}
                    </span>
                    {selectedPin.category && (
                      <span className="map-popup-cat">{selectedPin.category}</span>
                    )}
                  </div>
                  <div className="map-popup-name">{selectedPin.name}</div>
                  {selectedPin.location && (
                    <div className="map-popup-loc">{selectedPin.location}</div>
                  )}
                  <div className="map-popup-meta">
                    {selectedPin.members_count ?? 0} / {selectedPin.max_members || '∞'} Mitglieder
                  </div>
                </div>
              </div>
            </InfoWindow>
          )}
        </GoogleMap>
      )}

      {/* Locate me */}
      <button className="map-locate-btn" onClick={handleLocate} title="Meinen Standort anzeigen">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" fill="currentColor"/>
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
          <circle cx="12" cy="12" r="8" strokeOpacity="0.35"/>
        </svg>
      </button>

      {/* Pioneer CTA */}
      {isLoaded && !loading && pins.length === 0 && (
        <div className="map-pioneer-cta">
          <div className="map-pioneer-icon">🏆</div>
          <h2 className="map-pioneer-title">Trau dich, sei der Erste!</h2>
          <p className="map-pioneer-text">
            In deiner Region gibt es noch keine Gruppen. Erstelle die erste
            und erhalte einen <strong>kostenlosen 7-Tage-Boost</strong> + Pioneer-Badge!
          </p>
          <button className="map-pioneer-btn" onClick={() => navigate('/create-group')}>
            Erste Gruppe erstellen
          </button>
        </div>
      )}
    </div>
  );
}
