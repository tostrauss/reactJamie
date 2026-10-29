import { createRoot } from 'react-dom/client';
import i18n, { switchLanguage } from '../src/i18n';
import { ProModal } from '../src/components/ProModal';

const mount = async () => {
  try { await switchLanguage('de'); } catch { /* de is the bundled default */ }
  createRoot(document.getElementById('root')).render(<ProModal onClose={() => {}} />);
};

if (i18n.isInitialized) mount();
else i18n.on('initialized', mount);
