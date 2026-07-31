import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  GoogleMap,
  Marker,
  InfoWindow,
  OverlayViewF,
  OverlayView,
  useLoadScript,
} from '@react-google-maps/api';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { map as mapApi } from '../utils/api';
import { CATEGORY_HIERARCHY } from '../utils/categories';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

// Must be a stable reference — recreating it triggers a full Maps reload
const LIBRARIES = [];

const WIEN = { lat: 48.2082, lng: 16.3738 };

// Densest-cluster detection: for each pin, count how many pins fall within
// HOTSPOT_RADIUS_DEG (a rough metro-area box). The pin with the most neighbours
// anchors the hotspot; we return that pin plus its neighbours so the map can
// open centred on "where the most events are" instead of fitting every pin
// (which zoomed out across the empty space between separate cities). O(n²) but
// n ≤ 500 (the pins LIMIT), computed once per pin refresh.
const HOTSPOT_RADIUS_DEG = 0.12; // ~13 km lat / ~9 km lng at 48°N
function densestCluster(pts) {
  let anchor = pts[0];
  let bestCount = -1;
  for (const a of pts) {
    let count = 0;
    for (const b of pts) {
      if (Math.abs(a.lat - b.lat) <= HOTSPOT_RADIUS_DEG &&
          Math.abs(a.lng - b.lng) <= HOTSPOT_RADIUS_DEG) count++;
    }
    if (count > bestCount) { bestCount = count; anchor = a; }
  }
  return pts.filter(b =>
    Math.abs(anchor.lat - b.lat) <= HOTSPOT_RADIUS_DEG &&
    Math.abs(anchor.lng - b.lng) <= HOTSPOT_RADIUS_DEG);
}

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
  const { user } = useContext(AuthContext);
  const { t, i18n } = useTranslation();
  const mapLanguage = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en'
    : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('it') ? 'it' : 'de';
  const mapRef = useRef(null);
  const toast = useToast();

  const [pins,             setPins]            = useState([]);
  const [loading,          setLoading]         = useState(true);
  const [mapReady,         setMapReady]        = useState(false);
  const [selectedPin,      setSelectedPin]     = useState(null);
  const [selectedDate,     setSelectedDate]    = useState(null); // null | 'heute' | 'morgen'
  const [selectedCategory, setSelectedCategory] = useState(() => {
    try { return sessionStorage.getItem(SESSION_KEY) || null; } catch { return null; }
  });
  // Whether to show the "locate me" button. It's a location feature, so it's
  // hidden for users who've declined geolocation (or whose browser exposes no
  // geolocation at all). Undecided users still see it — tapping the button is
  // what triggers the OS consent prompt in the first place (especially on
  // native iOS, where nothing else ever asks for location).
  const [showLocate, setShowLocate] = useState(() => {
    if (typeof navigator !== 'undefined' && !navigator.geolocation) return false;
    try { return localStorage.getItem('jamie_location_denied') !== '1'; } catch { return true; }
  });

  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '',
    libraries: LIBRARIES,
    language: mapLanguage,
    region: 'AT',
  });

  // One icon object per (emoji, active) pair — avoids re-encoding SVG data-URLs on every render.
  // Cache is local to this component instance and cleared when the map unmounts.
  const iconCache = useRef({});
  const getCachedIcon = useCallback((emoji, active) => {
    const key = `${emoji}:${active}`;
    if (!iconCache.current[key]) {
      iconCache.current[key] = makeMarkerIcon(emoji, active);
    }
    return iconCache.current[key];
  }, []);

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
          if (cat) {
            // Include the main label AND subs, but drop the generic "Sonstiges"
            // sub (every category has one) unless this IS the Sonstiges category
            // — otherwise selecting Sport also matched all "Sonstiges" groups.
            // Matches Home's matchesKategorie logic so the two surfaces agree.
            const subNames = cat.subs
              .filter(s => s.name !== 'Sonstiges' || cat.id === 'sonstiges')
              .map(s => s.name);
            params.categories = [cat.label, ...subNames].join(',');
          }
        }
        if (selectedDate) params.dateFilter = selectedDate;
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
  }, [typeFilter, selectedCategory, selectedDate]);

  // ── Join-request bubbles on the owner's own pins ──────────────
  // "Alexander will deiner Gruppe beitreten" — a small celebratory chip over
  // groups the CALLER owns that have pending requests. Private groups have no
  // public pin, so for those the bubble itself marks the spot.
  const [requestBubbles, setRequestBubbles] = useState([]);
  useEffect(() => {
    if (!user || user.isGuest) return;
    let cancelled = false;
    const load = () => {
      mapApi.getRequestBubbles()
        .then(res => { if (!cancelled) setRequestBubbles(res.data || []); })
        .catch(() => {}); // decorative — never block the map
    };
    load();
    // Keep it live: a join request that arrives WHILE the map is already open
    // must surface the bubble without a tab switch — the fetch used to run only
    // on mount, so an owner watching the map never saw it (Tobi 2026-07-31).
    const interval = setInterval(load, 25000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fit bounds when pins change ───────────────────────────────
  // Outlier guard: ignore pins outside the DACH/Europe-wide bounding box when
  // computing the viewport. Without it, a single bad-data pin (e.g. a typo'd
  // location that Nominatim resolves to Papua New Guinea) zooms the map out
  // to global scale and hides every real pin clustered around Wien.
  const isPlausibleEuropePin = (p) =>
    p.lat > 35 && p.lat < 60 && p.lng > -10 && p.lng < 30;

  useEffect(() => {
    if (!mapRef.current || !window.google || pins.length === 0) return;
    const usable = pins.filter(isPlausibleEuropePin);
    if (usable.length === 0) {
      mapRef.current.panTo(WIEN);
      mapRef.current.setZoom(11);
      return;
    }
    // Open centred on the densest cluster — where the most events are — rather
    // than fitting ALL pins (which zoomed the map out to show the empty regions
    // between separate cities). A lone pin (or a lone hotspot) → centre on it.
    const cluster = usable.length === 1 ? usable : densestCluster(usable);
    if (cluster.length === 1) {
      mapRef.current.panTo({ lat: cluster[0].lat, lng: cluster[0].lng });
      mapRef.current.setZoom(13);
      return;
    }
    const bounds = new window.google.maps.LatLngBounds();
    cluster.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
    mapRef.current.fitBounds(bounds, 60);
    // A tight hotspot can push fitBounds to street level; cap the zoom once the
    // map settles so the surrounding area stays visible.
    window.google.maps.event.addListenerOnce(mapRef.current, 'idle', () => {
      if (mapRef.current && mapRef.current.getZoom() > 15) mapRef.current.setZoom(15);
    });
    // mapReady in deps: pins often resolve before the map finishes loading, in
    // which case mapRef.current was null and the fit never ran. Re-run on load.
  }, [pins, mapReady]);

  // Proactively hide the locate button for users who've already denied
  // geolocation. The Permissions API isn't reliably available for 'geolocation'
  // on iOS Safari / WKWebView, so this is best-effort: where it works we react
  // to grant/deny immediately; where it doesn't, handleLocate's own success /
  // deny outcomes (below) keep the flag current.
  useEffect(() => {
    if (!navigator.permissions?.query) return;
    let status;
    navigator.permissions.query({ name: 'geolocation' }).then((s) => {
      status = s;
      const sync = () => {
        const denied = s.state === 'denied';
        setShowLocate(!denied && !!navigator.geolocation);
        try { localStorage.setItem('jamie_location_denied', denied ? '1' : '0'); } catch { /* private mode */ }
      };
      sync();
      s.onchange = sync;
    }).catch(() => { /* geolocation not a queryable permission in this browser */ });
    return () => { if (status) status.onchange = null; };
  }, []);

  const onMapLoad = useCallback((map) => { mapRef.current = map; setMapReady(true); }, []);

  const updateCategory = (cat) => {
    setSelectedCategory(cat);
    setSelectedPin(null);
    try {
      if (cat) sessionStorage.setItem(SESSION_KEY, cat);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* private browsing */ }
  };

  const handleLocate = () => {
    if (!navigator.geolocation) {
      toast.error(t('map.locateError'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        try { localStorage.setItem('jamie_location_denied', '0'); } catch { /* private mode */ }
        if (!mapRef.current) return;
        mapRef.current.panTo({ lat: coords.latitude, lng: coords.longitude });
        mapRef.current.setZoom(14);
      },
      (err) => {
        // code 1 = PERMISSION_DENIED → the user declined location; hide the
        // button so it doesn't sit there doing nothing on the next render.
        // Timeout / position-unavailable (codes 3 / 2) are transient — keep the
        // button and just report the error.
        if (err && err.code === 1) {
          setShowLocate(false);
          try { localStorage.setItem('jamie_location_denied', '1'); } catch { /* private mode */ }
        }
        toast.error(t('map.locateError'));
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  };

  if (loadError) {
    return (
      <div className="map-container">
        <div className="map-load-error">
          <span>🗺️</span>
          <p>{t('map.loadError')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="map-container">

      {/* Filter strips */}
      <div className="map-filters">
        {/* Date filter */}
        <div className="map-category-strip">
          <button
            className={`map-cat-pill${!selectedDate ? ' active' : ''}`}
            onClick={() => { setSelectedDate(null); setSelectedPin(null); }}
          >
            {t('map.dateAll')}
          </button>
          {['heute', 'morgen'].map(d => (
            <button
              key={d}
              className={`map-cat-pill${selectedDate === d ? ' active' : ''}`}
              onClick={() => { setSelectedDate(selectedDate === d ? null : d); setSelectedPin(null); }}
            >
              {d === 'heute' ? t('map.today') : t('map.tomorrow')}
            </button>
          ))}
          <div className="map-filter-divider" />
          <button
            className={`map-cat-pill${!selectedCategory ? ' active' : ''}`}
            onClick={() => updateCategory(null)}
          >
            {t('map.categoryAll')}
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
          {pins.map(pin => {
            const active = selectedPin?.id === pin.id;
            return (
              <Marker
                key={pin.id}
                position={{ lat: pin.lat, lng: pin.lng }}
                icon={getCachedIcon(getEmoji(pin.category), active)}
                onClick={() => setSelectedPin(pin)}
                zIndex={active ? 10 : 1}
              />
            );
          })}

          {/* Owner join-request bubbles — tap → requests page. Rendered in the
              OVERLAY_MOUSE_TARGET pane so they stay clickable. NOTE: the constant
              is OVERLAY_MOUSE_TARGET — `OverlayView.MOUSE_TARGET` is undefined and
              silently mounts the overlay into NO pane, so the bubble never showed
              (root cause found 2026-07-31; backend data was correct all along). */}
          {requestBubbles.map(b => {
            // Nomadtable-style avatar bubble: the requester's profile picture +
            // "Neue Anfrage" (Tina/Tobi 2026-07-31). Multiple pending → count.
            const label = b.pending_count > 1
              ? t('map.requestBubbleMany', { count: b.pending_count > 10 ? '10+' : b.pending_count })
              : t('map.requestBubbleNew');
            return (
              <OverlayViewF
                key={`req-${b.group_id}`}
                position={{ lat: b.lat, lng: b.lng }}
                mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
              >
                <button
                  type="button"
                  className="map-request-bubble"
                  onClick={(e) => { e.stopPropagation(); navigate(`/group/${b.group_id}/requests`); }}
                >
                  <span className="map-request-avatar" aria-hidden="true">
                    {b.latest_avatar
                      ? <img src={b.latest_avatar} alt="" loading="lazy" decoding="async" />
                      : <span className="map-request-avatar-ph">{(b.latest_name || '?')[0].toUpperCase()}</span>}
                  </span>
                  {/* Group name in the bubble so it's unambiguous WHICH group the
                      request is for — private groups have no pin, so the bubble
                      often floats over an unrelated public pin (Tobi 2026-07-31). */}
                  <span className="map-request-bubble-text">
                    <span className="map-request-bubble-group">{b.group_name}</span>
                    <span className="map-request-bubble-label">{label}</span>
                  </span>
                </button>
              </OverlayViewF>
            );
          })}

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
              <div className="map-popup" onClick={() => navigate(selectedPin.type === 'club' ? `/club/${selectedPin.id}` : `/group/${selectedPin.id}`)}>
                {selectedPin.image_url && (
                  <img src={selectedPin.image_url} alt={selectedPin.name} className="map-popup-img" loading="lazy" decoding="async" />
                )}
                <div className="map-popup-body">
                  <div className="map-popup-badges">
                    <span className={`map-popup-type ${selectedPin.type}`}>
                      {selectedPin.type === 'club' ? t('map.popupClub')
                        : selectedPin.type === 'event' ? t('map.popupEvent')
                        : t('map.popupGroup')}
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
                    {selectedPin.max_members
                      ? t('map.popupMembersFmt', { current: selectedPin.members_count ?? 0, max: selectedPin.max_members })
                      : t('map.popupMembersUnlimited', { current: selectedPin.members_count ?? 0 })}
                  </div>
                </div>
              </div>
            </InfoWindow>
          )}
        </GoogleMap>
      )}

      {/* Locate me — hidden once the user has declined geolocation */}
      {showLocate && (
        <button className="map-locate-btn" onClick={handleLocate} title={t('map.locateTitle')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" fill="currentColor"/>
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
            <circle cx="12" cy="12" r="8" strokeOpacity="0.35"/>
          </svg>
        </button>
      )}

      {/* Pioneer CTA */}
      {isLoaded && !loading && pins.length === 0 && (
        <div className="map-pioneer-cta">
          <h2 className="map-pioneer-title">{t('map.pioneer.title')}</h2>
          <p className="map-pioneer-text">
            {t('map.pioneer.textPrefix')} <strong>{t('map.pioneer.textHighlight')}</strong> {t('map.pioneer.textSuffix')}
          </p>
          <button className="map-pioneer-btn" onClick={() => navigate('/create-group')}>
            {t('map.pioneer.btn')}
          </button>
        </div>
      )}
    </div>
  );
}
