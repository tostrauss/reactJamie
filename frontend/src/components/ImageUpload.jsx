import { useState, useRef, useEffect } from 'react';
import { upload } from '../utils/api';
import { useToast } from '../context/ToastContext';

// triggerRef (optional): parent passes a ref and can then open the file
// picker from its own UI (e.g. the onboarding photo tiles) via
// triggerRef.current?.() — keeps validation/upload logic in one place.
export const ImageUpload = ({ onUpload, label = "Bild hochladen", triggerRef }) => {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);
  const toast = useToast();

  useEffect(() => {
    if (!triggerRef) return;
    triggerRef.current = () => { if (!uploading) inputRef.current?.click(); };
    return () => { triggerRef.current = null; };
  }, [triggerRef, uploading]);

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  // 10 MB to match the other uploaders + the 15 MB backend limit. At 5 MB this
  // rejected normal 6–10 MB iPhone camera photos client-side for no reason.
  const MAX_SIZE_MB = 10;

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Nur JPEG, PNG, WebP oder GIF erlaubt');
      e.target.value = '';
      return;
    }

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`Bild darf maximal ${MAX_SIZE_MB} MB groß sein`);
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      const res = await upload.image(file);
      onUpload(res.data.url);
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div style={{ marginBottom: '15px' }}>
      <label style={{ 
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 20px', 
        background: 'rgba(255,255,255,0.1)', 
        borderRadius: '24px',
        cursor: uploading ? 'wait' : 'pointer',
        fontSize: '14px',
        fontWeight: '500',
        transition: 'all 0.2s'
      }}>
        {uploading ? (
          <>
            <span className="upload-spinner" />
            Lädt hoch...
          </>
        ) : (
          <>
            <span>📷</span>
            {label}
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={handleFile}
          style={{ display: 'none' }}
          disabled={uploading}
        />
      </label>
      
      <style>{`
        .upload-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};