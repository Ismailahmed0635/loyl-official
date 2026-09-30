/**
 * backend/geo.ts — GPS proximity helpers for the customer scan engine
 * (TEST.md §4: scanning from valid branch coordinates vs. spoofed/out-of-range
 * coordinates).
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface BranchGeo {
  branchName: string;
  latitude: unknown; // Prisma Decimal | number | string | null
  longitude: unknown;
}

/** Prisma Decimal | number | string -> finite number, or null. */
export function toCoordNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(String(value));
  return Number.isFinite(n) ? n : null;
}

/** Great-circle (haversine) distance between two coordinates, in meters. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000; // Earth radius (m)
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Branches that have both coordinates stored (the only ones GPS can check). */
export function geoBranches<T extends BranchGeo>(branches: T[]): T[] {
  return branches.filter(
    (b) => toCoordNumber(b.latitude) !== null && toCoordNumber(b.longitude) !== null
  );
}

/** True when at least one branch carries GPS — scanning then requires location. */
export function isGeoRequired<T extends BranchGeo>(branches: T[]): boolean {
  return geoBranches(branches).length > 0;
}

export interface NearestBranch<T extends BranchGeo> {
  branch: T;
  distanceMeters: number;
}

/** The closest GPS-enabled branch to a point, or null when none carry GPS. */
export function findNearestBranch<T extends BranchGeo>(
  branches: T[],
  point: GeoPoint
): NearestBranch<T> | null {
  let best: NearestBranch<T> | null = null;
  for (const branch of geoBranches(branches)) {
    const lat = toCoordNumber(branch.latitude)!;
    const lng = toCoordNumber(branch.longitude)!;
    const d = distanceMeters(point, { latitude: lat, longitude: lng });
    if (!best || d < best.distanceMeters) best = { branch, distanceMeters: d };
  }
  return best;
}
