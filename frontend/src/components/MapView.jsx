import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import { map as mapApi } from '../utils/api';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// All markers are pure CSS DivIcons — no external CDN images needed.
// This works in Capacitor WebView, TWA, and browsers alike.

const clubIcon = new L.DivIcon({
  html: `<div style="
    width:28px;height:28px;border-radius:50% 50% 50% 0;
    background:linear-gradient(135deg,#8b5cf6,#6d28d9);
    transform:rotate(-45deg);
    border:2px solid rgba(255,255,255,0.7);
    box-shadow:0 2px 8px rgba(109,40,217,0.5);
  "></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -30],
  className: '',
});

const coralIcon = new L.DivIcon({
  html: `<div style="
    width:28px;height:28px;border-radius:50% 50% 50% 0;
    background:linear-gradient(135deg,#FD7666,#e05a4b);
    transform:rotate(-45deg);
    border:2px solid rgba(255,255,255,0.7);
    box-shadow:0 2px 8px rgba(253,118,102,0.5);
  "></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -30],
  className: '',
});

function LocateControl() {
  const map = useMap();
  useEffect(() => {
    map.locate({ setView: true, maxZoom: 13 });
  }, [map]);
  return null;
}

export default function MapView({ typeFilter }) {
  const navigate = useNavigate();
  const [pins, setPins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const params = {};
        if (typeFilter && typeFilter !== 'all') params.type = typeFilter;
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
  }, [typeFilter]);

  const center = [48.2082, 16.3738]; // Wien

  return (
    <div className="map-container">
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

        {pins.map(pin => (
          <Marker
            key={pin.id}
            position={[pin.lat, pin.lng]}
            icon={pin.type === 'club' ? clubIcon : coralIcon}
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
                    <div className="map-popup-loc">📍 {pin.location}</div>
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
        className="map-locate-btn"
        onClick={() => setLocating(v => !v)}
        title="Meinen Standort anzeigen"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
          <circle cx="12" cy="12" r="8" strokeOpacity="0.3"/>
        </svg>
      </button>

      {!loading && pins.length === 0 && (
        <div className="map-empty">
          <div className="map-empty-icon">🗺️</div>
          <p>Noch keine Gruppen mit Standort in dieser Region</p>
        </div>
      )}
    </div>
  );
}
