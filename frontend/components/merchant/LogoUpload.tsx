'use client';

import React, { useRef, useState } from 'react';
import type { Merchant } from '@prisma/client';
import { Button } from '@/components/ui/Button';
import { displayLogoUrl, uploadLogo, removeLogo, getSettings } from '@/lib/api/merchant';
import { ImagePlus, Trash2 } from 'lucide-react';

interface LogoUploadProps {
  merchant: Merchant | null;
  onChanged: (merchant: Merchant) => void;
}

const ACCEPT = 'image/png,image/jpeg,image/webp';

/**
 * Merchant logo upload (Settings → Business Profile). Gallery file picker —
 * no URL typing. PNG/JPEG/WebP up to 2MB; the server re-validates magic
 * bytes, so a renamed script never lands in storage.
 */
export const LogoUpload: React.FC<LogoUploadProps> = ({ merchant, onChanged }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const current = displayLogoUrl(merchant);

  const pick = (f: File | null) => {
    setError('');
    if (!f) {
      setFile(null);
      setPreview(null);
      return;
    }
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  };

  const upload = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await uploadLogo(file);
      if (res?.success) {
        // The upload response carries only the URL — re-read settings so the
        // shell (and this preview) see the stored merchant row.
        const fresh = await getSettings();
        if (fresh?.success) onChanged((fresh.data as { merchant: Merchant }).merchant);
        pick(null);
        if (inputRef.current) inputRef.current.value = '';
      } else {
        setError(res?.error?.message || 'Could not upload the logo.');
      }
    } catch {
      setError('Network error uploading the logo.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await removeLogo();
      if (res?.success) {
        const fresh = await getSettings();
        if (fresh?.success) onChanged((fresh.data as { merchant: Merchant }).merchant);
      } else {
        setError(res?.error?.message || 'Could not remove the logo.');
      }
    } catch {
      setError('Network error removing the logo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full flex flex-col gap-2">
      <span className="font-label-lg text-label-lg text-on-surface">Shop Logo</span>
      <div className="flex items-center gap-3">
        {preview || current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview ?? current ?? ''}
            alt="Shop logo"
            className="w-16 h-16 rounded-card object-cover border border-hairline bg-surface-container-low"
          />
        ) : (
          <span className="w-16 h-16 rounded-card grid place-items-center border border-dashed border-hairline text-on-surface-variant">
            <ImagePlus className="w-6 h-6" />
          </span>
        )}
        <div className="flex flex-col gap-1.5 min-w-0">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            aria-label="Choose a logo from your gallery"
            className="font-body-sm text-body-sm text-on-surface-variant file:mr-2 file:min-h-[36px] file:px-3 file:rounded-pill file:border file:border-hairline file:bg-surface-container-lowest file:font-label-md file:text-label-md file:text-on-surface"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
          <span className="font-body-sm text-body-sm text-on-surface-variant">
            PNG, JPG or WebP up to 2MB.
          </span>
        </div>
      </div>
      {error && (
        <p className="font-body-sm text-body-sm text-brand-red font-medium" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={!file || busy} isLoading={busy} onClick={upload}>
          <ImagePlus className="w-4 h-4 mr-1" /> Upload Logo
        </Button>
        {current && !preview && (
          <Button size="sm" variant="outline" disabled={busy} onClick={remove}>
            <Trash2 className="w-4 h-4 mr-1" /> Remove
          </Button>
        )}
      </div>
    </div>
  );
};
