const supabase = require('../supabase');

const GRACE_PERIOD_MS = 60 * 24 * 60 * 60 * 1000; // 60 days after trial ends

// Unified access check: staff OR active trial OR paid (user_access).
// Service-role clients bypass RLS, so these checks are applied manually.
async function getUserAccess(userId) {
  const [profileRes, accessRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, role, trial_ends_at, created_at, subscription_active')
      .eq('id', userId)
      .single(),
    supabase
      .from('user_access')
      .select('expires_at')
      .eq('user_id', userId)
      .eq('is_active', true),
  ]);

  if (profileRes.error) throw profileRes.error;
  if (accessRes.error) throw accessRes.error;

  const profile = profileRes.data;
  const now = Date.now();

  const hasPaid = (accessRes.data || []).some(
    a => !a.expires_at || new Date(a.expires_at).getTime() > now
  );

  const role = profile && profile.role;
  const isStaff = role === 'admin' || role === 'teacher';
  const trialActive = !!(
    profile && profile.trial_ends_at && new Date(profile.trial_ends_at).getTime() > now
  );

  return {
    profile,
    isStaff,
    hasPaid,
    trialActive,
    hasAccess: isStaff || hasPaid || trialActive,
  };
}

module.exports = { getUserAccess, GRACE_PERIOD_MS };
