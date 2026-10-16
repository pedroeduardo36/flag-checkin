import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name}`);
  return v;
}

export const env = {
  get supabaseUrl() { return required("SUPABASE_URL"); },
  get supabaseServiceKey() { return required("SUPABASE_SERVICE_ROLE_KEY"); },
  get churchLat() { return Number(required("CHURCH_LAT")); },
  get churchLng() { return Number(required("CHURCH_LNG")); },
  get churchRadius() { return Number(process.env.CHURCH_RADIUS_METERS ?? 150); },
  /** Modo teste: GEOFENCE_DISABLED=true libera o check-in fora da igreja. Nunca deixe ligado em produção. */
  get geofenceDisabled() { return process.env.GEOFENCE_DISABLED === "true"; },
  get registrationPassword() { return required("REGISTRATION_PASSWORD"); },
  get checkinSecret() {
    const s = required("CHECKIN_SECRET");
    if (s.length < 32) throw new Error("CHECKIN_SECRET precisa ter pelo menos 32 caracteres");
    return s;
  },
};

export const PHOTO_BUCKET = "fotos";
