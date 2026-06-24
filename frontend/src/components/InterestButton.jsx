import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { featureInterest } from '../utils/api';
import { useToast } from '../context/ToastContext';

// "Benachrichtige mich"-Button für Coming-Soon-Features (JAMIE Pro / kaufbare
// Boosts). Tippt der User, merken wir uns (User, Feature) im Backend, damit wir
// genau diese Leute zum Start benachrichtigen (und ggf. einen Discount geben)
// können. Nach dem Eintragen wechselt der Button auf einen "erledigt"-Zustand.
export const InterestButton = ({ feature }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [registered, setRegistered] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    featureInterest.get()
      .then(res => {
        if (!cancelled && (res.data?.features || []).includes(feature)) setRegistered(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [feature]);

  const handleClick = async () => {
    if (registered || loading) return;
    setLoading(true);
    try {
      await featureInterest.register(feature);
      setRegistered(true);
      toast.success(t('payments.comingSoon.interestThanks'));
    } catch {
      toast.error(t('payments.comingSoon.interestError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={registered || loading}
      style={{
        padding: '12px 24px', borderRadius: '12px', border: 'none',
        background: registered ? 'rgba(34,197,94,0.16)' : '#FD7666',
        color: registered ? '#4ade80' : '#fff',
        fontWeight: '700', fontSize: '14px',
        cursor: (registered || loading) ? 'default' : 'pointer',
        opacity: loading ? 0.6 : 1,
      }}
    >
      {registered ? t('payments.comingSoon.interestDone') : t('payments.comingSoon.interestCta')}
    </button>
  );
};

export default InterestButton;
