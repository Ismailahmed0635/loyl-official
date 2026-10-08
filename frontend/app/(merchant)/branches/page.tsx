'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Branch } from '@prisma/client';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { FadeUp } from '@/components/animations/FadeUp';
import { Stagger } from '@/components/animations/Stagger';
import {
  listBranches,
  createBranch,
  updateBranch,
  deleteBranch,
  uploadMenuPhoto,
} from '@/lib/api/merchant';
import { MapPin, Plus, Pencil, Trash2, Navigation, AlertCircle, CheckCircle2, Camera } from 'lucide-react';
import { useQuery, prime } from '@/lib/api/cache';

interface BranchFormValues {
  branchName: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
}

const EMPTY_FORM: BranchFormValues = {
  branchName: '',
  address: '',
  latitude: null,
  longitude: null,
};

function numberOrNull(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function BranchesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Errors that are *not* the list read (photo upload, delete) still need a
  // home, and the read error joins them below so the UI keeps one message slot.
  const [actionError, setActionError] = useState('');
  /** Upload/delete failures write here; `error` below merges it with read errors. */
  const setError = setActionError;

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BranchFormValues>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [geoMessage, setGeoMessage] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // --- Digital Menu camera (LOYLS §5) --------------------------------------
  //
  // The chooser must be opened from inside this click handler: Chrome refuses
  // to raise a file picker for a programmatic click that carries no user
  // gesture, so asking `/menu` to open it after a navigation would silently do
  // nothing. Snap here, upload here, then hand the merchant to the editor.
  const menuCameraRef = useRef<HTMLInputElement>(null);
  const [menuSnapping, setMenuSnapping] = useState(false);

  const handleMenuPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;

    setMenuSnapping(true);
    setError('');
    try {
      const res = await uploadMenuPhoto(file);
      if (res?.success) {
        // Photo stored — the editor picks it up from there.
        router.push('/menu');
        return;
      }
      setError(res?.error?.message || 'Could not upload the menu photo.');
    } catch {
      setError('Network error uploading the menu photo.');
    } finally {
      setMenuSnapping(false);
    }
  };

  // Branches are read-heavy and written rarely, so they cache like everything
  // else; create/update/delete below `invalidate` the key so the next visit
  // (or a background revalidation) picks up the change.
  const { data: branchesData, error: loadError, isLoading, refetch } = useQuery<{
    branches: Branch[];
  }>(
    'branches',
    async () => {
      const res = await listBranches();
      if (!res?.success) throw new Error(res?.error?.message || 'Failed to load branches');
      return { branches: (res.data.branches ?? []) as Branch[] };
    },
    { ttl: 30_000 }
  );

  const branches = branchesData?.branches ?? [];
  const loading = isLoading;
  const load = async () => {
    await refetch();
  };
  const error = actionError || (loadError ? String(loadError) : '');

  // Deep link from the quick menu: /branches?new=1
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowForm(true);
      setEditingId(null);
      setForm(EMPTY_FORM);
    }
  }, [searchParams]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setGeoMessage('');
    setShowForm(true);
  };

  const openEdit = (branch: Branch) => {
    setEditingId(branch.id);
    setForm({
      branchName: branch.branchName,
      address: branch.address ?? '',
      latitude: branch.latitude === null ? null : Number(branch.latitude),
      longitude: branch.longitude === null ? null : Number(branch.longitude),
    });
    setFormError('');
    setGeoMessage('');
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setGeoMessage('');
    // Drop ?new=1 so reopening later starts fresh.
    if (searchParams.get('new')) {
      router.replace('/branches');
    }
  };

  const captureLocation = () => {
    if (!('geolocation' in navigator)) {
      setGeoMessage('Location is not available on this device — enter coordinates manually.');
      return;
    }
    setGeoMessage('Getting your location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
        }));
        setGeoMessage('Location captured ✓');
      },
      () => {
        setGeoMessage('Location access denied — enter coordinates manually.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const branchName = form.branchName.trim();
    if (branchName.length < 2) {
      setFormError('Branch name must be at least 2 characters');
      return;
    }
    if (form.address.trim().length > 200) {
      setFormError('Address must be 200 characters or fewer');
      return;
    }
    if ((form.latitude === null) !== (form.longitude === null)) {
      setFormError('Add both GPS coordinates, or leave both empty');
      return;
    }
    if (form.latitude !== null) {
      if (Number.isNaN(form.latitude) || form.latitude < -90 || form.latitude > 90) {
        setFormError('Latitude must be between -90 and 90');
        return;
      }
      if (form.longitude === null || Number.isNaN(form.longitude) || form.longitude < -180 || form.longitude > 180) {
        setFormError('Longitude must be between -180 and 180');
        return;
      }
    }

    const payload: BranchFormValues = {
      branchName,
      address: form.address.trim(),
      latitude: form.latitude,
      longitude: form.longitude,
    };

    setSaving(true);
    try {
      const res = editingId
        ? await updateBranch(editingId, payload)
        : await createBranch(payload);
      if (res?.success) {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2500);
        closeForm();
        await load();
        return;
      }
      setFormError(res?.error?.message || 'Failed to save branch');
    } catch {
      setFormError('Network error saving branch.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      const res = await deleteBranch(id);
      if (res?.success) {
        // Optimistic: drop the row locally and stamp the cache so navigating
        // away and back doesn't resurrect it before the next server read.
        const next = branches.filter((b) => b.id !== id);
        prime('branches', { branches: next });
        setConfirmDeleteId(null);
      } else {
        setError(res?.error?.message || 'Failed to delete branch');
        setConfirmDeleteId(null);
      }
    } catch {
      setError('Network error deleting branch.');
      setConfirmDeleteId(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-space-lg">
      <FadeUp>
        <PageHeader
          title="Branches"
          meta="Each branch can carry its own QR. GPS coordinates help match nearby scans to the right shop."
          actions={
            !showForm ? (
              <div className="flex shrink-0 items-center gap-2">
                {/* LOYLS §5 — the Digital Menu is entered from the Branch Page
                    through a camera icon that shoots the printed menu. */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => menuCameraRef.current?.click()}
                  isLoading={menuSnapping}
                  aria-label="Snap a photo of your printed menu"
                >
                  <Camera className="w-4 h-4 mr-1" /> Menu
                </Button>
                <Button size="sm" variant="primary" onClick={openCreate}>
                  <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
              </div>
            ) : undefined
          }
        />
      </FadeUp>

      {/* Camera-only: `capture` skips the gallery chooser on a phone. */}
      <input
        ref={menuCameraRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
        capture="environment"
        className="hidden"
        onChange={handleMenuPhoto}
        aria-label="Take a photo of your printed menu"
      />

      {saved && (
        <p
          className="font-body-sm text-body-sm text-brand-green font-medium flex items-center gap-1.5"
          role="status"
        >
          <CheckCircle2 className="w-4 h-4" /> Branch saved.
        </p>
      )}

      {error && (
        <p
          className="font-body-sm text-body-sm text-brand-red font-medium flex items-center gap-1.5"
          role="alert"
        >
          <AlertCircle className="w-4 h-4" /> {error}
        </p>
      )}

      {/* Branch form (create / edit) */}
      {showForm && (
        <FadeUp>
          <Card>
            <form onSubmit={handleSubmit} className="flex flex-col gap-space-md">
              <p className="font-headline-sm text-headline-sm text-on-surface">
                {editingId ? 'Edit Branch' : 'Add a Branch'}
              </p>

              <Input
                label="Branch Name *"
                placeholder="e.g. Banani Outlet"
                value={form.branchName}
                onChange={(e) => setForm((f) => ({ ...f, branchName: e.target.value }))}
                required
              />

              <Input
                label="Address"
                placeholder="Road 11, Banani, Dhaka"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                helperText="Shown to customers on their stamp card"
              />

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Latitude"
                  placeholder="23.7937"
                  inputMode="decimal"
                  value={form.latitude ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, latitude: numberOrNull(e.target.value) }))
                  }
                />
                <Input
                  label="Longitude"
                  placeholder="90.4066"
                  inputMode="decimal"
                  value={form.longitude ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, longitude: numberOrNull(e.target.value) }))
                  }
                />
              </div>

              <Button type="button" variant="outline" size="sm" onClick={captureLocation}>
                <Navigation className="w-4 h-4 mr-1.5" /> Use My Current Location
              </Button>
              {geoMessage && (
                <p className="font-body-sm text-body-sm text-on-surface-variant -mt-2">{geoMessage}</p>
              )}

              {formError && (
                <p className="font-body-md text-body-md text-brand-red font-medium" role="alert">
                  {formError}
                </p>
              )}

              <div className="flex gap-2">
                <Button type="submit" variant="primary" isLoading={saving} className="flex-1">
                  {editingId ? 'Save Branch' : 'Add Branch'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={closeForm}
                  disabled={saving}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        </FadeUp>
      )}

      {/* Branch list */}
      {loading ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">Loading branches…</p>
      ) : branches.length === 0 ? (
        <Card className="flex flex-col items-start gap-2 bg-surface-container-low border-hairline">
          <p className="font-label-lg text-label-lg text-on-surface">No branches yet</p>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Add your first branch — customers scanning nearby will be matched to it automatically.
          </p>
          {!showForm && (
            <Button size="sm" variant="primary" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-1.5" /> Add Branch
            </Button>
          )}
        </Card>
      ) : (
        <Stagger className="flex flex-col gap-space-sm">
          {branches.map((branch) => {
            const lat = branch.latitude === null ? null : Number(branch.latitude);
            const lng = branch.longitude === null ? null : Number(branch.longitude);
            const hasGps = lat !== null && lng !== null && !Number.isNaN(lat) && !Number.isNaN(lng);
            return (
              <Card key={branch.id} className="p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-lg bg-surface-container text-primary grid place-items-center shrink-0">
                      <MapPin size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-label-lg text-label-lg text-on-surface truncate">
                        {branch.branchName}
                      </p>
                      {branch.address && (
                        <p className="font-body-sm text-body-sm text-on-surface-variant truncate">
                          {branch.address}
                        </p>
                      )}
                      <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5 tabular-nums">
                        {hasGps
                          ? `GPS: ${lat!.toFixed(4)}, ${lng!.toFixed(4)}`
                          : 'No GPS coordinates yet'}
                      </p>
                    </div>
                  </div>
                  <Badge tone={hasGps ? 'success' : 'neutral'} uppercase className="shrink-0">
                    {hasGps ? 'GPS ✓' : 'No GPS'}
                  </Badge>
                </div>

                {confirmDeleteId === branch.id ? (
                  <div className="flex flex-col gap-2 rounded-input bg-error-container/50 border border-error-container p-3">
                    <p className="font-body-sm text-body-sm text-on-error-container font-medium">
                      Delete “{branch.branchName}”? This cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                        isLoading={deleting}
                        onClick={() => handleDelete(branch.id)}
                      >
                        <Trash2 className="w-4 h-4 mr-1.5" /> Yes, Delete
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1"
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={deleting}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 border-t border-hairline pt-1.5">
                    <button
                      onClick={() => openEdit(branch)}
                      className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-input font-label-lg text-label-lg text-on-surface-variant hover:bg-surface-container-low"
                    >
                      <Pencil className="w-4 h-4" /> Edit
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(branch.id)}
                      className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-input font-label-lg text-label-lg text-brand-red hover:bg-error-container/40"
                    >
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
        </Stagger>
      )}
    </div>
  );
}

// Branches — Phase 2. Wrapped in Suspense because useSearchParams needs it at build time.
export default function BranchesPage() {
  return (
    <Suspense fallback={<p className="font-body-sm text-body-sm text-on-surface-variant">Loading branches…</p>}>
      <BranchesContent />
    </Suspense>
  );
}
