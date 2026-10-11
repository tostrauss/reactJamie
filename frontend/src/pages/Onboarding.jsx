import { useState, useContext, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../context/AuthContext';
import { api } from '../utils/api';
import { serverErrorMessage } from '../utils/apiError';
import { loadGoogleMaps, onGoogleMapsReady } from '../utils/googleMaps';
import { safeStorage } from '../utils/safeStorage';
import { AVATAR_NUDGE_KEY, AVATAR_NUDGE_SNOOZE_MS } from '../utils/avatarNudge';
import { INTEREST_NAMES, MIN_INTERESTS } from '../utils/interests';
import { MOTIVATION_KEYS } from '../utils/motivations';
import { loadOnboardingDraft, saveOnboardingDraft, clearOnboardingDraft } from '../utils/onboardingDraft';
import { loadOnboardingClubs } from '../utils/onboardingClubsChunk';
import { ImageUpload } from '../components/ImageUpload';
import { FlowHeader } from '../components/FlowHeader';
import { StepTitle } from '../components/StepTitle';
import { FaceScanRing } from '../components/FaceScanRing';
import { ProfilePhotoPrompt } from '../components/ProfilePhotoPrompt';
import '../styles/auth.css';
import '../styles/onboarding.css';

// Interest values are stored canonically in German on the user row — translating
// them would break category matching. Display as-is; later phases can add a
// parallel display-name map per locale.
// Shared with the profile editor (utils/interests.js).
const INTEREST_OPTIONS = INTEREST_NAMES;

// The four numbered steps (Tina's checklist 10.10.2026): ① „Was trifft zu?",
// ② „Worauf hast du Lust?", ③ about you, ④ photos LAST. Always four — gender
// and birth date are asked INSIDE step ③ only while the account lacks them
// (Google sign-ups), so the counter never changes under the user's thumb.
// The old gender step and the „Du bist bereit" step are gone: the latter
// promised „Du kannst jetzt Gruppen beitreten" even without the profile
// picture that joining requires.
const STEPS = ['goals', 'interests', 'about', 'photos'];

// Server cap (authController: „Maximal 6 Fotos erlaubt"). The ring holds the
// profile picture, the tiles below the other five.
const MAX_PHOTOS = 6;
const MORE_SLOTS = MAX_PHOTOS - 1;

// value: backend enum (en) — must match GENDER_VALUES in authController.js.
// labelKey: i18n key for the user-facing label.
// The trailing U+FE0E (text variation selector) forces monochrome text
// rendering — without it iOS shows ⚧ as a full-colour emoji (blue square),
// clashing with the coral ♂/♀ glyphs. With it, all three render uniformly and
// pick up the colour of their bubble.
const GENDER_OPTIONS = [
  { value: 'male',    labelKey: 'onboarding.gender.male',    icon: '♂︎' },
  { value: 'female',  labelKey: 'onboarding.gender.female',  icon: '♀︎' },
  { value: 'diverse', labelKey: 'onboarding.gender.diverse', icon: '⚧︎' },
];

// Latest birth date that is still 18+ — the same rule the server enforces
// (checkAdultDob) and the register screen uses.
const adultCutoff = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
};

const CheckIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const PinIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

const CameraIcon = ({ size = 38 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

const PlusIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

// The wizard's answers, prefilled from what the account already has (a
// returning user redoing onboarding from the Home banner). Photos start EMPTY
// on purpose: only uploads made in this wizard are ever sent back — echoing
// the stored avatar would resend a Google picture, which fails the server's
// isSafeImageUrl and 400s the whole save.
const initialForm = (user) => ({
  motivations: Array.isArray(user?.motivations) ? MOTIVATION_KEYS.filter((k) => user.motivations.includes(k)) : [],
  interests: Array.isArray(user?.interests) ? user.interests.filter((i) => typeof i === 'string' && i.trim()) : [],
  location: typeof user?.location === 'string' ? user.location : '',
  bio: typeof user?.bio === 'string' ? user.bio : '',
  gender: '',
  date_of_birth: '',
  photos: [],
  avatar_url: null,
});

const isAdultDob = (dob) => !!dob && dob <= adultCutoff();

// Index of the first step whose answer is still missing — a restored draft
// never lands past it, even if it was saved further on.
const firstIncompleteStep = (fd, ask) => {
  if (!fd.motivations.length) return 0;
  if (fd.interests.length < MIN_INTERESTS) return 1;
  if ((ask.gender && !fd.gender) || (ask.dob && !isAdultDob(fd.date_of_birth))) return 2;
  return 3;
};

// PUT /auth/onboarding body. Optional fields are OMITTED rather than sent
// empty: the server keeps the stored value for an absent gender (COALESCE),
// an empty location/bio, an absent avatar and an empty photo list.
//   gender         picked here when the account had none; otherwise the
//                  stored one is echoed back (if it is a known value). The
//                  current server would keep an absent gender anyway, but
//                  an OLDER one writes `gender = $1` unconditionally — an iOS
//                  bundle built from this code talking to a rolled-back
//                  server would wipe the gender Register just stored. Never
//                  an unknown legacy value: that would 400 the whole save.
//   date_of_birth  only when asked here
//   photos/avatar  only uploads from this wizard (see initialForm); photos
//                  includes the profile picture — the "Onboarding shape" the
//                  profile pages read (utils/photoOrder.js)
const KNOWN_GENDERS = new Set(GENDER_OPTIONS.map((g) => g.value));
const buildOnboardingPayload = (fd, ask, storedGender) => {
  const gender = ask.gender ? fd.gender : (KNOWN_GENDERS.has(storedGender) ? storedGender : '');
  return {
    motivations: fd.motivations,
    interests: fd.interests,
    location: fd.location.trim(),
    bio: fd.bio.trim(),
    ...(gender ? { gender } : {}),
    ...(ask.dob ? { date_of_birth: fd.date_of_birth } : {}),
    ...(fd.photos.length ? { photos: fd.photos } : {}),
    ...(fd.avatar_url ? { avatar_url: fd.avatar_url } : {}),
  };
};

export const Onboarding = () => {
  const navigate = useNavigate();
  const { user, refreshProfile } = useContext(AuthContext);
  const { t } = useTranslation();

  // What step ③ asks, decided ONCE: a field must not vanish mid-wizard when
  // a background profile refresh lands.
  const [ask] = useState(() => ({ gender: !user?.gender, dob: !user?.date_of_birth }));
  // A draft from a WebView reload (camera!) — see utils/onboardingDraft.js.
  const [draft] = useState(() => loadOnboardingDraft(user?.id, STEPS));
  const [formData, setFormData] = useState(() => (draft ? { ...initialForm(user), ...draft.formData } : initialForm(user)));
  const [stepIdx, setStepIdx] = useState(() => (draft
    ? Math.min(STEPS.indexOf(draft.stepId), firstIncompleteStep({ ...initialForm(user), ...draft.formData }, ask))
    : 0));
  const stepId = STEPS[stepIdx];

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [customInterest, setCustomInterest] = useState('');
  const [categorySuggestion, setCategorySuggestion] = useState('');
  const [suggestionSent, setSuggestionSent] = useState(false);
  const [photoPrompt, setPhotoPrompt] = useState(false);
  const [uploading, setUploading] = useState(false);

  const maxDOB = adultCutoff();
  const dobOk = isAdultDob(formData.date_of_birth);

  // The picker: ONE hidden ImageUpload in the photo step, opened from the
  // ring, the tiles and the Achtung sheet. uploadTargetRef says what the next
  // upload is for — 'avatar' (ring, sheet) or 'more' (tiles).
  const uploadTriggerRef = useRef(null);
  const uploadTargetRef = useRef('avatar');
  // Set by the Achtung sheet's CTA: finish onboarding as soon as that upload
  // lands. Any other tap on the step clears it again.
  const finishAfterUploadRef = useRef(false);
  const savingRef = useRef(false);
  const doneRef = useRef(false);
  // While the save runs — and after it succeeded, until this page is gone —
  // nothing on the photo step may start another one (see handleComplete).
  const locked = () => doneRef.current || savingRef.current;

  // Stale-flag safety: Register sets jamie_new_registration so AppIntro shows
  // right after sign-up. Once the wizard is on screen the intro has had its
  // turn — a flag left behind would replay it over the clubs page as soon as
  // handleComplete's refreshProfile changes the user.
  useEffect(() => {
    safeStorage.removeItem('jamie_new_registration');
  }, []);

  // Mirror step + answers for the WebView-reload case. Not after the save:
  // the draft is cleared there for good.
  useEffect(() => {
    if (doneRef.current) return;
    saveOnboardingDraft(user?.id, { stepId, formData });
  }, [user?.id, stepId, formData]);

  // Warm the clubs page's chunk while the user is on the last step. It is a
  // lazy route: without this, navigate('/onboarding/clubs') suspends inside
  // React Router's startTransition and the old screen — this one — stays up
  // until the chunk has arrived (slow network, no service worker yet). Same
  // loader as App.jsx's lazy route, so that one then resolves at once.
  useEffect(() => {
    if (stepId === 'photos') loadOnboardingClubs().catch(() => {});
  }, [stepId]);

  // ── Wohnort: Google Places city suggestions ─────────────────────────────
  // Same loader as group/club creation (utils/googleMaps.js). Replaces the
  // old browser-side Nominatim lookup (Tobi 23.09.2026: "die Google-Maps-
  // Vorschläge fehlen"). Cities only, and no country restriction: native
  // users are worldwide, and Places accepts at most 5 countries anyway.
  // Without a key or if Google fails, the field is a plain text input —
  // the server geocodes the profile city either way.
  const locationRef = useRef(null);
  const autocompleteRef = useRef(null);
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (apiKey) loadGoogleMaps(apiKey);
  }, []);
  useEffect(() => {
    if (stepId !== 'about') return undefined;
    const attach = () => {
      if (!window.google?.maps?.places || autocompleteRef.current || !locationRef.current) return;
      const ac = new window.google.maps.places.Autocomplete(locationRef.current, {
        types: ['(cities)'],
        fields: ['formatted_address', 'name'],
      });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        const val = place?.formatted_address || place?.name || '';
        if (val) setFormData(prev => ({ ...prev, location: val }));
      });
      autocompleteRef.current = ac;
    };
    const timer = setTimeout(() => onGoogleMapsReady(attach), 50);
    return () => {
      clearTimeout(timer);
      // The input unmounts with the step — drop the binding so coming back
      // to this step attaches a fresh one to the new input element.
      if (autocompleteRef.current && window.google?.maps?.event) {
        window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
      autocompleteRef.current = null;
    };
  }, [stepId]);

  const setField = (key, value) => setFormData(prev => ({ ...prev, [key]: value }));

  // Kept in MOTIVATION_KEYS order, like the server stores them.
  const toggleMotivation = (key) => {
    setFormData(prev => {
      const has = prev.motivations.includes(key);
      return { ...prev, motivations: MOTIVATION_KEYS.filter(k => (k === key ? !has : prev.motivations.includes(k))) };
    });
  };

  const toggleInterest = (interest) => {
    setFormData(prev => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter(i => i !== interest)
        : [...prev.interests, interest]
    }));
  };

  // Enter / „Fertig" on the keyboard adds it (the old „+" button is gone —
  // Tobi 23.09.2026). Also called on Weiter, so typed-but-not-confirmed text
  // isn't silently dropped.
  const customValue = customInterest.trim().slice(0, 40);
  const customIsNew = !!customValue && !formData.interests.some(i => i.toLowerCase() === customValue.toLowerCase());
  const addCustomInterest = (e) => {
    e?.preventDefault();
    if (customIsNew) toggleInterest(customValue);
    setCustomInterest('');
  };

  const goNext = () => {
    if (stepId === 'interests') addCustomInterest();
    setError('');
    setStepIdx(i => Math.min(i + 1, STEPS.length - 1));
  };

  const goBack = () => {
    if (locked()) return;
    finishAfterUploadRef.current = false;
    setError('');
    setStepIdx(i => Math.max(i - 1, 0));
  };

  const sendCategorySuggestion = async (e) => {
    e?.preventDefault();
    const text = categorySuggestion.trim();
    if (!text || suggestionSent) return;
    try {
      await api.post('/analytics/suggest-category', { suggestion: text });
      setSuggestionSent(true);
      setCategorySuggestion('');
    } catch {
      // non-blocking — ignore errors
    }
  };

  // ── Photos ──────────────────────────────────────────────────────────────
  // The picture on the ring: one uploaded here, else the one the account
  // already has (Google sign-up) — shown, never sent back.
  const displayAvatar = formData.avatar_url || user?.avatar_url || null;
  const hasAvatar = !!displayAvatar;
  const morePhotos = formData.photos.filter(p => p !== formData.avatar_url).slice(0, MORE_SLOTS);
  const emptyTiles = Math.max(0, MORE_SLOTS - morePhotos.length);

  // Tap on the ring / an empty tile. The picker call comes before anything
  // else that could take time: WebKit opens a file input only while the tap is
  // being processed. One upload at a time — re-aiming uploadTargetRef while a
  // picture is still uploading would file it in the wrong slot.
  const openPicker = (target) => {
    if (uploading || locked()) return;
    uploadTriggerRef.current?.();
    uploadTargetRef.current = target;
    finishAfterUploadRef.current = false;
  };

  const handlePhotoUpload = (url) => {
    const target = uploadTargetRef.current;
    setFormData(prev => {
      if (!url || prev.photos.includes(url)) return prev;
      // The ring — or the very first picture of an account without one —
      // becomes the profile picture, replacing an earlier one from this
      // wizard. Photos keep the avatar INSIDE the list, first.
      if (target === 'avatar' || !(prev.avatar_url || user?.avatar_url)) {
        const rest = prev.photos.filter(p => p !== prev.avatar_url);
        return { ...prev, avatar_url: url, photos: [url, ...rest].slice(0, MAX_PHOTOS) };
      }
      if (prev.photos.length >= MAX_PHOTOS) return prev;
      return { ...prev, photos: [...prev.photos, url] };
    });
  };

  // „Als Profilbild": the tapped photo moves to the ring; the previous one
  // from this wizard goes back among the others.
  const makeMainPhoto = (url) => {
    if (locked()) return;
    finishAfterUploadRef.current = false;
    setFormData(prev => (prev.photos.includes(url)
      ? { ...prev, avatar_url: url, photos: [url, ...prev.photos.filter(p => p !== url)] }
      : prev));
  };

  const removePhoto = (url) => {
    if (locked()) return;
    finishAfterUploadRef.current = false;
    setFormData(prev => ({
      ...prev,
      photos: prev.photos.filter(p => p !== url),
      avatar_url: prev.avatar_url === url ? null : prev.avatar_url,
    }));
  };

  // ── Finish ──────────────────────────────────────────────────────────────
  const handleComplete = async () => {
    if (savingRef.current) return;
    // Fail here rather than letting the server 400 after the user has filled
    // in four steps. The server check (checkAdultDob) is still the one that
    // counts — this is only the earlier, friendlier half.
    if (ask.dob && !isAdultDob(formData.date_of_birth)) {
      setStepIdx(STEPS.indexOf('about'));
      setError(t(formData.date_of_birth ? 'auth.register.validation.ageMin' : 'auth.register.validation.dobRequired'));
      return;
    }
    savingRef.current = true;
    setLoading(true);
    setError('');
    try {
      await api.put('/auth/onboarding', buildOnboardingPayload(formData, ask, user?.gender));
      doneRef.current = true;
      clearOnboardingDraft(user?.id);
      // Before the user changes (refreshProfile): see the mount effect.
      safeStorage.removeItem('jamie_new_registration');
      if (typeof refreshProfile === 'function') await refreshProfile();
      navigate('/onboarding/clubs', { replace: true });
      // The lock is NOT released on success. navigate() can leave this page
      // on screen for a while (the clubs page is a lazy chunk, and the
      // router waits for it inside a transition); with the lock released the
      // footer read „Los geht's!" again, a second tap reopened the Achtung
      // sheet and sent a second PUT — or opened the picker, whose photo was
      // lost when the page then unmounted. The footer keeps „Speichere…"
      // until this page is gone.
    } catch (err) {
      // Failed — the PUT, or something after it: unlock for a retry. The PUT
      // is idempotent, so retrying after a later failure is harmless.
      savingRef.current = false;
      doneRef.current = false;
      setLoading(false);
      // 422 requiresAvatar = the chosen picture failed the server's quality
      // check (solid colour / blank). Drop it, stay on the photo step.
      if (err?.response?.data?.requiresAvatar) {
        setFormData(prev => ({
          ...prev,
          avatar_url: null,
          photos: prev.photos.filter(p => p !== prev.avatar_url),
        }));
      }
      setError(serverErrorMessage(err, t, 'onboarding.error'));
    }
  };

  // The sheet's upload finishes the wizard on its own: the effect runs after
  // the render that holds the new picture, and completeRef points at the
  // handleComplete of exactly that render (declared first, so it runs first).
  const completeRef = useRef(handleComplete);
  useEffect(() => { completeRef.current = handleComplete; });
  useEffect(() => {
    if (!finishAfterUploadRef.current || !formData.avatar_url) return;
    finishAfterUploadRef.current = false;
    completeRef.current();
  }, [formData.avatar_url]);

  // „Los geht's!": without any profile picture first the Achtung sheet.
  const handleFinish = () => {
    if (locked()) return;
    if (!hasAvatar) { setPhotoPrompt(true); return; }
    handleComplete();
  };

  // Achtung sheet → „Profilbild hinzufügen". Order is mandatory: picker
  // first (user activation; the lock check before it is a plain ref read),
  // then the follow-up, then close. The picker's input lives in the photo
  // step, outside the sheet, and stays mounted.
  const handlePromptAdd = () => {
    if (locked()) { setPhotoPrompt(false); return; }
    uploadTriggerRef.current?.();
    uploadTargetRef.current = 'avatar';
    finishAfterUploadRef.current = true;
    setPhotoPrompt(false);
  };

  // Achtung sheet → „Überspringen": finish without a picture and keep App's
  // soft nudge quiet for a week — the user just said „not now", Home must not
  // ask again seconds later (same snooze as the nudge's own „Später").
  const handlePromptSkip = () => {
    if (locked()) { setPhotoPrompt(false); return; }
    finishAfterUploadRef.current = false;
    safeStorage.setItem(AVATAR_NUDGE_KEY, String(Date.now() + AVATAR_NUDGE_SNOOZE_MS));
    setPhotoPrompt(false);
    handleComplete();
  };

  const interestsNeeded = Math.max(0, MIN_INTERESTS - formData.interests.length);
  // Own interests first: appended at the END they landed below the fold
  // (under „Clubbing"), so adding one looked like nothing happened.
  const customInterests = formData.interests.filter(i => !INTEREST_OPTIONS.includes(i));
  const interestChips = [...customInterests, ...INTEREST_OPTIONS];

  // Weiter per step. Interests: a typed-but-unconfirmed interest counts —
  // Weiter adds it.
  const canContinue = {
    goals: formData.motivations.length > 0,
    interests: formData.interests.length + (customIsNew ? 1 : 0) >= MIN_INTERESTS,
    about: (!ask.gender || !!formData.gender) && (!ask.dob || dobOk),
    photos: true,
  }[stepId];

  return (
    <div className="onboarding-container ob-flow">
      <FlowHeader
        onBack={stepIdx > 0 ? goBack : undefined}
        current={stepIdx + 1}
        total={STEPS.length}
        complete={stepId === 'photos' && hasAvatar}
      />

      {/* key → each step mounts fresh and plays the enter animation */}
      <div className="onboarding-content ob-content" key={stepId}>
        {/* ① Was trifft zu? — multi-select checklist, at least one */}
        {stepId === 'goals' && (
          <div className="ob-step">
            <StepTitle id="ob-goals-title" line1={t('onboarding.goals.titleLine1')} line2={t('onboarding.goals.titleLine2')} />
            <p className="ob-sub">{t('onboarding.goals.subtitle')}</p>
            <div className="ob-goals" role="group" aria-labelledby="ob-goals-title">
              {MOTIVATION_KEYS.map((key) => {
                const checked = formData.motivations.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    className={`ob-goal${checked ? ' selected' : ''}`}
                    onClick={() => toggleMotivation(key)}
                  >
                    <span className="ob-goal-label">{t(`onboarding.goals.options.${key}`)}</span>
                    <span className="ob-goal-check"><CheckIcon /></span>
                  </button>
                );
              })}
            </div>
            {formData.motivations.length === 0 && (
              <p className="ob-goals-hint">{t('onboarding.goals.needOne')}</p>
            )}
          </div>
        )}

        {/* ② Worauf hast du Lust? — interests, at least MIN_INTERESTS */}
        {stepId === 'interests' && (
          <div className="ob-step">
            <StepTitle line1={t('onboarding.interests.titleLine1')} line2={t('onboarding.interests.titleLine2')} />
            <p className="ob-sub">{t('onboarding.interests.subtitle')}</p>

            <input
              className="ob-custom-input"
              type="text"
              enterKeyHint="done"
              maxLength={40}
              placeholder={t('onboarding.interests.customPlaceholder')}
              value={customInterest}
              onChange={(e) => setCustomInterest(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomInterest(e)}
            />

            <div className="ob-chips">
              {interestChips.map(interest => {
                const selected = formData.interests.includes(interest);
                return (
                  <button
                    key={interest}
                    type="button"
                    aria-pressed={selected}
                    className={`ob-chip${selected ? ' selected' : ''}`}
                    onClick={() => toggleInterest(interest)}
                  >
                    {selected && <CheckIcon />}
                    {interest}
                  </button>
                );
              })}
            </div>

            <p className={`ob-counter${interestsNeeded === 0 ? ' ob-counter--ok' : ''}`}>
              {t('onboarding.interests.counter', { count: formData.interests.length })}
              {interestsNeeded > 0 && ` ${t('onboarding.interests.needMore', { count: interestsNeeded })}`}
            </p>

            {/* Category suggestion */}
            <div className="ob-suggest">
              <p className="ob-suggest-prompt">{t('onboarding.interests.suggestPrompt')}</p>
              {suggestionSent ? (
                <p className="ob-suggest-thanks">{t('onboarding.interests.suggestThanks')}</p>
              ) : (
                <div className="ob-suggest-row">
                  <input
                    type="text"
                    placeholder={t('onboarding.interests.suggestPlaceholder')}
                    value={categorySuggestion}
                    onChange={(e) => setCategorySuggestion(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendCategorySuggestion(e)}
                  />
                  <button
                    type="button"
                    onClick={sendCategorySuggestion}
                    disabled={!categorySuggestion.trim()}
                    className="ob-suggest-btn"
                  >
                    {t('onboarding.interests.suggestSubmit')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ③ Über dich — gender / birth date only while the account lacks them */}
        {stepId === 'about' && (
          <div className="ob-step">
            <StepTitle line1={t('onboarding.profile.titleLine1')} line2={t('onboarding.profile.titleLine2')} />
            <p className="ob-sub">{t('onboarding.profile.subtitle')}</p>
            <div className="ob-form">
              {ask.gender && (
                <div className="ob-field">
                  <span className="ob-field-label" id="ob-gender-label">{t('onboarding.profile.genderLabel')}</span>
                  <div className="ob-bubbles" role="radiogroup" aria-labelledby="ob-gender-label">
                    {GENDER_OPTIONS.map(({ value, labelKey, icon }) => {
                      const selected = formData.gender === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          className={`ob-bubble${selected ? ' selected' : ''}`}
                          onClick={() => setField('gender', value)}
                        >
                          {/* Same selected look as Register's gender bubbles
                              and the interest chips: the tick takes the
                              glyph's fixed-size slot. */}
                          <span className="ob-bubble-icon" aria-hidden="true">{selected ? <CheckIcon /> : icon}</span>
                          {t(labelKey)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="ob-field">
                <label htmlFor="ob-location">{t('onboarding.profile.locationLabel')}</label>
                <div className="ob-input-wrap">
                  <span className="ob-input-icon"><PinIcon /></span>
                  <input
                    id="ob-location"
                    ref={locationRef}
                    type="text"
                    placeholder={t('onboarding.profile.locationPlaceholder')}
                    value={formData.location}
                    onChange={(e) => setField('location', e.target.value)}
                    autoComplete="off"
                  />
                </div>
              </div>
              {ask.dob && (
                <div className="ob-field">
                  <label htmlFor="ob-dob">{t('onboarding.profile.dobLabel')}</label>
                  <input
                    id="ob-dob"
                    type="date"
                    max={maxDOB}
                    value={formData.date_of_birth}
                    onChange={(e) => setField('date_of_birth', e.target.value)}
                  />
                  {formData.date_of_birth && !dobOk && (
                    <p className="ob-field-error">{t('auth.register.validation.ageMin')}</p>
                  )}
                  <p className="ob-field-hint">{t('onboarding.profile.dobHint')}</p>
                </div>
              )}
              <div className="ob-field">
                <label htmlFor="ob-bio">{t('onboarding.profile.bioLabel')}</label>
                <textarea
                  id="ob-bio"
                  placeholder={t('onboarding.profile.bioPlaceholder')}
                  value={formData.bio}
                  onChange={(e) => setField('bio', e.target.value)}
                  maxLength={500}
                  rows={3}
                />
              </div>
            </div>
          </div>
        )}

        {/* ④ Fotos — always last: profile picture on the Face-Scan ring */}
        {stepId === 'photos' && (
          <div className="ob-step ob-photos-step">
            <StepTitle line1={t('onboarding.photos.titleLine1')} line2={t('onboarding.photos.titleLine2')} />
            <p className="ob-sub">{t('onboarding.photos.subtitle')}</p>

            <div className="ob-avatar-block">
              <button
                type="button"
                className="ob-avatar-btn"
                onClick={() => openPicker('avatar')}
                aria-label={hasAvatar ? t('onboarding.photos.avatarChange') : t('onboarding.photos.avatarCta')}
                aria-busy={uploading}
              >
                {/* ①–③ are done on arrival: 3 of 4 green; the picture completes it. */}
                <FaceScanRing done={STEPS.length - 1} total={STEPS.length} complete={hasAvatar}>
                  {displayAvatar ? (
                    <img className="ob-avatar-img" src={displayAvatar} alt="" decoding="async" />
                  ) : (
                    <span className="ob-avatar-empty"><CameraIcon /></span>
                  )}
                  {uploading && (
                    <span className="ob-avatar-busy"><span className="ob-spinner" /></span>
                  )}
                </FaceScanRing>
              </button>
              {hasAvatar ? (
                <p className="ob-avatar-caption ob-avatar-caption--done" aria-live="polite">
                  <CheckIcon size={15} />
                  {t('onboarding.photos.complete')}
                </p>
              ) : (
                <button type="button" className="ob-avatar-caption" onClick={() => openPicker('avatar')}>
                  {t('onboarding.photos.avatarCta')}
                </button>
              )}
            </div>

            <div className="ob-more">
              <p className="ob-more-title" id="ob-more-title">{t('onboarding.photos.moreTitle')}</p>
              <div className="ob-more-grid" role="group" aria-labelledby="ob-more-title">
                {morePhotos.map((url) => (
                  <div key={url} className="ob-more-tile ob-more-tile--filled">
                    <button
                      type="button"
                      className="ob-more-pick"
                      onClick={() => makeMainPhoto(url)}
                      aria-label={t('onboarding.photos.makeMain')}
                    >
                      <img src={url} alt="" decoding="async" />
                    </button>
                    <button
                      type="button"
                      className="ob-more-remove"
                      onClick={() => removePhoto(url)}
                      aria-label={t('profileEdit.photoOrder.removeAria')}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {Array.from({ length: emptyTiles }, (_, i) => (
                  <button
                    key={`empty-${i}`}
                    type="button"
                    className="ob-more-tile ob-more-tile--empty"
                    onClick={() => openPicker('more')}
                    aria-label={t('onboarding.photos.addPhoto', { current: formData.photos.length, total: MAX_PHOTOS })}
                  >
                    <PlusIcon />
                  </button>
                ))}
              </div>
            </div>

            {/* The one picker of this step (ring, tiles, Achtung sheet). Outside
                the sheet and mounted for the whole step, so its change event
                still arrives after the sheet has closed. */}
            <ImageUpload
              onUpload={handlePhotoUpload}
              triggerRef={uploadTriggerRef}
              purpose="avatar"
              hideLabel
              onUploadingChange={setUploading}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="onboarding-footer">
        {error && <p className="ob-footer-error" role="alert">{error}</p>}
        {stepId === 'photos' ? (
          <button
            type="button"
            className="auth-btn auth-btn-primary"
            onClick={handleFinish}
            disabled={loading || uploading}
          >
            {loading ? t('onboarding.save') : t('onboarding.finish')}
          </button>
        ) : (
          <button
            type="button"
            className="auth-btn auth-btn-primary"
            onClick={goNext}
            disabled={!canContinue}
          >
            {t('onboarding.next')}
          </button>
        )}
      </div>

      <ProfilePhotoPrompt
        isOpen={photoPrompt}
        onAdd={handlePromptAdd}
        onSkip={handlePromptSkip}
        onClose={() => setPhotoPrompt(false)}
      />
    </div>
  );
};
export default Onboarding;
