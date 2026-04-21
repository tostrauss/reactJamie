import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import { map as mapApi } from '../utils/api';
import { CATEGORY_HIERARCHY } from '../utils/categories';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Build a flat lookup: sub-category name → emoji
const CATEGORY_EMOJI = {};
for (const cat of CATEGORY_HIERARCHY) {
  for (const sub of cat.subs) {
    CATEGORY_EMOJI[sub.name.toLowerCase()] = sub.icon;
  }
  CATEGORY_EMOJI[cat.label.toLowerCase()] = cat.icon;
  CATEGORY_EMOJI[cat.id] = cat.icon;
}

function getEmojiForCategory(category) {
  if (!category) return '✨';
  return CATEGORY_EMOJI[category.toLowerCase()] ?? '✨';
}

function makeEmojiIcon(emoji) {
  return new L.DivIcon({
    html: `<div style="
      width:44px;height:44px;border-radius:50%;
      background:#291C4B;
      display:flex;align-items:center;justify-content:center;
      font-size:20px;line-height:1;
      font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif;
      box-shadow:0 2px 12px rgba(0,0,0,0.45);
      border:2px solid #392B58;
    ">${emoji ?? '✨'}</div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -26],
    className: '',
  });
}

function LocateControl() {
  const map = useMap();
  useEffect(() => {
    map.locate({ setView: true, maxZoom: 13 });
  }, [map]);
  return null;
}

// After pins load, zoom to fit all of them (max zoom 13 so we don't over-zoom 2 nearby pins).
// If only 1 pin, just fly to it. If no pins, keep the Austria default.
function FitBoundsControl({ pins }) {
  const map = useMap();
  useEffect(() => {
    if (pins.length === 0) return;
    if (pins.length === 1) {
      map.flyTo([pins[0].lat, pins[0].lng], 13, { animate: true, duration: 1 });
      return;
    }
    const bounds = L.latLngBounds(pins.map(p => [p.lat, p.lng]));
    map.flyToBounds(bounds.pad(0.35), { maxZoom: 13, animate: true, duration: 1 });
  }, [pins, map]);
  return null;
}

export default function MapView({ typeFilter }) {
  const navigate = useNavigate();
  const [pins, setPins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);

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
        // silently fail — map shows empty
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [typeFilter, selectedCategory]);

  const center = [48.2082, 16.3738]; // Wien

  return (
    <div className="map-container">
      {/* Category filter strip */}
      <div className="map-category-strip">
        <button
          className={`map-cat-pill${!selectedCategory ? ' active' : ''}`}
          onClick={() => setSelectedCategory(null)}
        >
          Alle
        </button>
        {CATEGORY_HIERARCHY.map(cat => (
          <button
            key={cat.id}
            className={`map-cat-pill${selectedCategory === cat.id ? ' active' : ''}`}
            onClick={() => setSelectedCategory(prev => prev === cat.id ? null : cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="map-loading">
          <div className="home-spinner" />
        </div>
      )}

      <MapContainer
        center={center}
        zoom={10}
        className="map-leaflet"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {locating && <LocateControl />}
        <FitBoundsControl pins={pins} />

        {pins.map(pin => (
          <Marker
            key={pin.id}
            position={[pin.lat, pin.lng]}
            icon={makeEmojiIcon(getEmojiForCategory(pin.category))}
          >
            <Popup className="map-popup-wrapper">
              <div className="map-popup" onClick={() => navigate(`/group/${pin.id}`)}>
                {pin.image_url && (
                  <img src={pin.image_url} alt={pin.name} className="map-popup-img" />
                )}
                <div className="map-popup-body">
                  <div className="map-popup-badges">
                    <span className={`map-popup-type ${pin.type}`}>
                      {pin.type === 'club' ? 'Club' : 'Gruppe'}
                    </span>
                    {pin.category && (
                      <span className="map-popup-cat">{pin.category}</span>
                    )}
                  </div>
                  <div className="map-popup-name">{pin.name}</div>
                  {pin.location && (
                    <div className="map-popup-loc">{pin.location}</div>
                  )}
                  <div className="map-popup-meta">
                    {pin.members_count ?? 0} / {pin.max_members || '∞'} Mitglieder
                  </div>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      <button
        className={`map-locate-btn${selectedCategory ? ' has-filter' : ''}`}
        onClick={() => setLocating(v => !v)}
        title="Meinen Standort anzeigen"
      >
        {selectedCategory
          ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
          : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
              <circle cx="12" cy="12" r="8" strokeOpacity="0.3"/>
            </svg>
        }
      </button>

      {!loading && pins.length === 0 && (
        <div className="map-pioneer-cta">
          <div className="map-pioneer-icon"></div>
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
