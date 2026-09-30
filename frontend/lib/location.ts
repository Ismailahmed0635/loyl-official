/**
 * frontend/lib/location.ts — browser geolocation helper shared by the stamp
 * check-in and the scratch reveal (Phase 3.5): both flows must ask for the
 * customer's position when the shop has GPS branches.
 */
export function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocation unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 30_000,
    });
  });
}
