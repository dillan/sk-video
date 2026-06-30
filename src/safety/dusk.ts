/**
 * Is it dark out? Pure solar-geometry helper for the auto low-light camera preset. Given a time and
 * the boat's position it computes the sun's altitude above the horizon and decides whether we're past
 * dusk. This is the low-precision USNO/NOAA approximation (good to about a degree) — plenty for a
 * day/night decision, and it needs no ephemeris data or network. Longitude is degrees east (Signal K
 * convention: negative west), matching the boat's `navigation.position`.
 */

const DEG = Math.PI / 180;
const J2000_UNIX_DAYS = 10957.5; // days from the Unix epoch to the J2000.0 epoch (2000-01-01 12:00 UTC)
const MS_PER_DAY = 86_400_000;

/** Default: the sun at or below the true horizon (0 degrees) counts as "after dusk". */
const DEFAULT_DUSK_ALTITUDE_DEG = 0;

/** The sun's altitude above the horizon, in degrees, for a UTC instant at (latDeg, lonDeg east). */
export function solarAltitudeDeg(date: Date, latDeg: number, lonDeg: number): number {
  // Days since the J2000.0 epoch.
  const n = date.getTime() / MS_PER_DAY - J2000_UNIX_DAYS;

  // Sun's mean longitude and mean anomaly (degrees), then ecliptic longitude (degrees).
  const meanLon = 280.46 + 0.9856474 * n;
  const meanAnom = (357.528 + 0.9856003 * n) * DEG;
  const eclipticLon = (meanLon + 1.915 * Math.sin(meanAnom) + 0.02 * Math.sin(2 * meanAnom)) * DEG;

  // Obliquity of the ecliptic (radians).
  const obliquity = (23.439 - 0.0000004 * n) * DEG;

  // Equatorial coordinates of the sun.
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLon),
    Math.cos(eclipticLon),
  );

  // Greenwich mean sidereal time → local sidereal time → hour angle (radians).
  const gmstDeg = 280.46061837 + 360.98564736629 * n;
  const localSidereal = (gmstDeg + lonDeg) * DEG;
  const hourAngle = localSidereal - rightAscension;

  const lat = latDeg * DEG;
  const altitude = Math.asin(
    Math.sin(lat) * Math.sin(declination) +
      Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle),
  );
  return altitude / DEG;
}

/**
 * Whether it is past dusk at the given time and position. `thresholdDeg` is the sun altitude at or
 * below which it counts as dark (default 0 = sunset; pass -6 for civil dusk). Honest about its job:
 * a day/night switch, not a precise twilight clock.
 */
export function isAfterDusk(
  date: Date,
  latDeg: number,
  lonDeg: number,
  thresholdDeg: number = DEFAULT_DUSK_ALTITUDE_DEG,
): boolean {
  return solarAltitudeDeg(date, latDeg, lonDeg) <= thresholdDeg;
}
