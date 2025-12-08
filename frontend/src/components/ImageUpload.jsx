import React, { useState } from 'react';
import { api } from '../utils/api';

export const ImageUpload = ({ onUpload, label = "Upload Image" }) => {
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('image', file);

    setUploading(true);
    try {
      const res = await api.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      onUpload(res.data.url);
    } catch (err) {
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ marginBottom: '15px' }}>
      <label style={{ 
        display: 'inline-block', 
        padding: '8px 16px', 
        background: 'rgba(255,255,255,0.1)', 
        borderRadius: '20px',
        cursor: uploading ? 'wait' : 'pointer',
        fontSize: '13px'
      }}>
        {uploading ? 'Uploading...' : `📷 ${label}`}
        <input 
          type="file" 
          accept="image/*" 
          onChange={handleFile} 
          style={{ display: 'none' }} 
          disabled={uploading}
        />
      </label>
    </div>
  );
};