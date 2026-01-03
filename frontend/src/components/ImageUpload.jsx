import React, { useState } from 'react';
import { upload } from '../utils/api';

export const ImageUpload = ({ onUpload, label = "Upload Image" }) => {
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      const res = await upload.image(file);
      onUpload(res.data.url);
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Upload fehlgeschlagen');
    } finally {
      setUploading(false);
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
          type="file" 
          accept="image/jpeg,image/png,image/webp" 
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