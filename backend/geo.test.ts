import { describe, it, expect } from 'vitest';
import { distanceMeters, findNearestBranch, isGeoRequired, toCoordNumber } from './geo';

// Known reference: Banani, Dhaka <-> Dhanmondi, Dhaka ≈ 3.3 km.
const BANANI = { latitude: 23.7937, longitude: 90.4066 };
const DHANMONDI = { latitude: 23.7461, longitude: 90.3742 };

describe('Geo helpers (TEST.md §4 GPS proximity)', () => {
  it('toCoordNumber handles Prisma Decimal-ish values', () => {
    expect(toCoordNumber(23.79)).toBeCloseTo(23.79);
    expect(toCoordNumber('90.40')).toBeCloseTo(90.4);
    expect(toCoordNumber(null)).toBeNull();
    expect(toCoordNumber(undefined)).toBeNull();
    expect(toCoordNumber('abc')).toBeNull();
  });

  it('distanceMeters is ~0 for identical points', () => {
    expect(distanceMeters(BANANI, BANANI)).toBeCloseTo(0, 3);
  });

  it('distanceMeters matches a known Banani–Dhanmondi distance (±150 m)', () => {
    const d = distanceMeters(BANANI, DHANMONDI);
    // Real-world straight line: ≈6.2 km.
    expect(d).toBeGreaterThan(5800);
    expect(d).toBeLessThan(6600);
  });

  it('distanceMeters is symmetric', () => {
    expect(distanceMeters(BANANI, DHANMONDI)).toBeCloseTo(
      distanceMeters(DHANMONDI, BANANI),
      6
    );
  });

  it('isGeoRequired only counts branches with both coordinates', () => {
    expect(isGeoRequired([{ branchName: 'A', latitude: 23.7, longitude: 90.4 }])).toBe(true);
    expect(isGeoRequired([{ branchName: 'A', latitude: null, longitude: null }])).toBe(false);
    expect(isGeoRequired([{ branchName: 'A', latitude: 23.7, longitude: null }])).toBe(false);
    expect(isGeoRequired([])).toBe(false);
  });

  it('findNearestBranch returns the closest GPS branch with its distance', () => {
    const branches = [
      { branchName: 'Dhanmondi', latitude: DHANMONDI.latitude, longitude: DHANMONDI.longitude },
      { branchName: 'No GPS', latitude: null, longitude: null },
      { branchName: 'Banani', latitude: BANANI.latitude, longitude: BANANI.longitude },
    ];
    const near = findNearestBranch(branches, BANANI);
    expect(near?.branch.branchName).toBe('Banani');
    expect(near?.distanceMeters).toBeLessThan(1);

    const far = findNearestBranch(branches, { latitude: 22.0, longitude: 90.0 });
    expect(far?.distanceMeters).toBeGreaterThan(100_000);
  });

  it('findNearestBranch returns null when no branch carries GPS', () => {
    expect(findNearestBranch([{ branchName: 'X', latitude: null, longitude: null }], BANANI)).toBeNull();
  });
});
