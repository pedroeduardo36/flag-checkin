// Privacy rules shown to families (the /privacidade page, the registration form and the confirmation page).
// The periods must match public.expurgar_dados() (supabase/migrations/20261030000000_privacidade.sql)
// and docs/privacy/data-inventory.md.

export const RETENTION = {
  confirmDays: 7, // new registration the guardian hasn't confirmed
  checkinPhotoDays: 30, // creative check-in photo
  visitorDays: 180, // visitor: name, phone and optional photo
  inactiveMonths: 12, // registration with no attendance in this period
  auditDays: 90, // technical log of check-in attempts
  leaderAuditYears: 2, // leader action log and deactivated leader accounts
} as const;

/** Deadline to answer family requests (LGPD, Brazil's data protection law, art. 19, II). */
export const REQUEST_DAYS = 15;

/** Who answers the requests. Update once the church appoints a data protection officer. */
export const PRIVACY_OWNER = "Liderança da Juventude O2 (Ministério Flag)";
