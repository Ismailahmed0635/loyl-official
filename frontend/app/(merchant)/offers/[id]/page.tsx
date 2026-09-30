'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, QrCode, Trash2, Power, CheckCircle2, AlertCircle } from 'lucide-react';
import type { Offer } from '@prisma/client';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { OfferForm, OfferFormValues } from '@/components/merchant/OfferForm';
import { getOffer, updateOffer, deleteOffer, OfferWithItems } from '@/lib/api/merchant';
import { FadeUp } from '@/components/animations/FadeUp';

// Offer Edit — Phase 2
export default function OfferEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [offer, setOffer] = useState<OfferWithItems | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      try {
        const res = await getOffer(id);
        if (!alive) return;
        if (res?.success) setOffer(res.data.offer as OfferWithItems);
        else setNotFound(true);
      } catch {
        if (alive) setNotFound(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const handleSave = async (values: OfferFormValues) => {
    if (!id) return;
    setSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      const res = await updateOffer(id, values);
      if (res?.success) {
        setOffer(res.data.offer as OfferWithItems);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2500);
        return;
      }
      setSaveError(res?.error?.message || 'Failed to save changes');
    } catch {
      setSaveError('Network error saving changes.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    if (!id || !offer) return;
    setSaveError('');
    try {
      const res = await updateOffer(id, { isActive: !offer.isActive });
      if (res?.success) setOffer(res.data.offer as OfferWithItems);
      else setSaveError(res?.error?.message || 'Failed to toggle offer');
    } catch {
      setSaveError('Network error toggling offer.');
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      const res = await deleteOffer(id);
      if (res?.success) {
        router.push('/dashboard');
        return;
      }
      setSaveError(res?.error?.message || 'Failed to delete offer');
      setConfirmDelete(false);
    } catch {
      setSaveError('Network error deleting offer.');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-brand-textMuted">Loading offer…</p>;
  }

  if (notFound || !offer) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <div className="flex items-center gap-2 text-brand-red">
          <AlertCircle className="w-5 h-5" />
          <p className="text-sm font-medium">Offer not found — it may have been deleted.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => router.push('/dashboard')}>
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Dashboard
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FadeUp>
        <button
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center gap-1.5 font-label-lg text-label-lg text-on-surface-variant min-h-[44px] hover:text-on-surface"
        >
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </button>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-headline-md text-headline-md text-on-surface">Edit Offer</h1>
            <p className="font-body-md text-body-md text-on-surface-variant mt-1.5">
              Update the rules, pause the offer, or print a fresh QR poster.
            </p>
          </div>
          <span
            className={`px-2.5 py-0.5 rounded-pill font-label-sm text-label-sm uppercase shrink-0 ${
              offer.isActive
                ? 'bg-primary-fixed text-on-primary-fixed'
                : 'bg-surface-container-high text-on-surface-variant'
            }`}
          >
            {offer.isActive ? 'Active' : 'Paused'}
          </span>
        </div>
      </FadeUp>

      <Button variant="outline" className="w-full" onClick={() => router.push(`/offers/${offer.id}/qr`)}>
        <QrCode className="w-4 h-4 mr-2" /> View QR Poster
      </Button>

      <OfferForm
        typeLocked
        initialValues={{
          offerType: offer.offerType,
          title: offer.title,
          rewardType: offer.rewardType,
          requiredStamps: offer.requiredStamps ?? undefined,
          scratchMode: offer.scratchMode ?? undefined,
          items: offer.scratchItems.map((it) => it.label),
          scratchCooldownHours: offer.scratchCooldownHours,
          diceCount: offer.diceCount,
          durationDays: offer.durationDays,
          posterTemplateUrl: offer.posterTemplateUrl ?? '',
        }}
        submitLabel="Save Changes"
        submitting={saving}
        error={saveError}
        successMessage={saved ? 'Changes saved' : ''}
        onSubmit={handleSave}
      />

      <Card className="flex flex-col gap-3">
        <p className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
          Offer controls
        </p>

        <Button
          variant="outline"
          className="w-full"
          onClick={toggleActive}
          disabled={saving || deleting}
        >
          <Power className="w-4 h-4 mr-2" />
          {offer.isActive ? 'Pause Offer' : 'Activate Offer'}
        </Button>

        {confirmDelete ? (
          <div className="flex flex-col gap-2 rounded-input bg-red-50 border border-red-200 p-3">
            <p className="text-xs text-brand-red font-medium">
              Delete “{offer.title}”? Its QR poster will stop working. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="flex-1"
                isLoading={deleting}
                onClick={handleDelete}
              >
                <Trash2 className="w-4 h-4 mr-1.5" /> Yes, Delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => setConfirmDelete(true)}
            disabled={saving}
          >
            <Trash2 className="w-4 h-4 mr-2" /> Delete Offer
          </Button>
        )}

        {saved && (
          <p className="text-xs text-brand-green font-medium flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> All changes are live.
          </p>
        )}
      </Card>
    </div>
  );
}
