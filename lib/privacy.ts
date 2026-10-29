// Regras de privacidade mostradas às famílias (página /privacidade, formulário e confirmação).
// Os prazos precisam bater com public.expurgar_dados() (supabase/migrations/20261030000000_privacidade.sql)
// e com docs/privacidade/inventario-de-dados.md.

export const RETENTION = {
  confirmDays: 7, // cadastro novo sem confirmação do responsável
  checkinPhotoDays: 30, // foto criativa do check-in
  visitorDays: 180, // visitante: nome, telefone e foto opcional
  inactiveMonths: 12, // cadastro sem nenhuma presença nesse período
  auditDays: 90, // registro técnico das tentativas de check-in
  leaderAuditYears: 2, // registro das ações dos líderes e contas de líder desativadas
} as const;

/** Prazo de resposta aos pedidos das famílias (LGPD art. 19, II). */
export const REQUEST_DAYS = 15;

/** Quem responde pelos pedidos. Ajustar quando a igreja definir o encarregado. */
export const PRIVACY_OWNER = "Liderança da Juventude O2 (Ministério Flag)";
