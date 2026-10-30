import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

export const env = {
  get supabaseUrl() { return required("SUPABASE_URL"); },
  get supabaseServiceKey() { return required("SUPABASE_SERVICE_ROLE_KEY"); },
  get churchLat() { return Number(required("CHURCH_LAT")); },
  get churchLng() { return Number(required("CHURCH_LNG")); },
  get churchRadius() { return Number(process.env.CHURCH_RADIUS_METERS ?? 150); },
  /** Test mode: GEOFENCE_DISABLED=true allows check-in away from the church. Never leave it on in production. */
  get geofenceDisabled() { return process.env.GEOFENCE_DISABLED === "true"; },
  /** Signs tokens and cookies, encrypts the leaders' authenticator secret and derives code hashes. */
  get checkinSecret() {
    const s = required("CHECKIN_SECRET");
    if (s.length < 32) throw new Error("CHECKIN_SECRET must be at least 32 characters long");
    return s;
  },
};

export const PHOTO_BUCKET = "fotos";
