/* Atlantis MC — Supabase public configuration */

window.ATLANTIS_SUPABASE = {
  url: 'https://bmgfzpdehhwvvqmqiiln.supabase.co',
  publishableKey: 'sb_publishable_qKoXKvjEjiLkJbCIgMX-oQ_0vFzrGRC'
};

/* Atlantis MC giriş Edge Function */
window.ATLANTIS_EDGE_URL =
  'https://bmgfzpdehhwvvqmqiiln.supabase.co/functions/v1/login-with-identifier';

/* Atlantis MC şifre sıfırlama Edge Function */
window.ATLANTIS_RECOVERY_URL =
  'https://bmgfzpdehhwvvqmqiiln.supabase.co/functions/v1/request-password-reset';

/*
 * Service role / secret key kesinlikle buraya konmaz.
 *
 * Publishable key tarayıcıda kullanılabilir.
 * Secret key yalnızca Supabase Edge Function tarafında tutulur.
 */
