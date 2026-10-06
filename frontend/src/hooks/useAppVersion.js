import { useEffect, useState } from 'react';
import { isNative } from '../utils/platform';

/**
 * The installed app's version, for display: "1.4.3 (12)" in the iOS app —
 * read from the binary via @capacitor/app, because the app bundles the web
 * build and only the binary knows which store release it is — and "Web"
 * everywhere else: the PWA and the Android app (a TWA of the live site)
 * always run the current web release.
 *
 * The Settings row used to show a hard-coded "1.3" on every client, so
 * testers could not tell support which iPhone build they were on — the first
 * question for "einige sehen die Fotos nicht" (1.4.1 cannot show chat photos).
 * null while the native lookup is pending.
 */
export function useAppVersion() {
  const native = isNative();
  const [version, setVersion] = useState(native ? null : 'Web');
  useEffect(() => {
    if (!native) return undefined;
    let cancelled = false;
    import('@capacitor/app')
      .then(({ App }) => App.getInfo())
      .then((info) => {
        if (cancelled || !info?.version) return;
        setVersion(info.build ? `${info.version} (${info.build})` : info.version);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [native]);
  return version;
}

export default useAppVersion;
