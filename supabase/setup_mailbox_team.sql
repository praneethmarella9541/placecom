-- =============================================================================
-- One-time setup: admin mailbox + staff access
-- Run in: Supabase Dashboard → SQL Editor → paste → Run
--
-- BEFORE YOU RUN:
-- 1) Migration 0015_mailbox_profiles.sql must already be applied.
-- 2) Both users must exist under Authentication → Users:
--    - chetangalla248@gmail.com (Google sign-in at least once)
--    - g24072@astra.xlri.ac.in (invite / add user if not present yet)
-- 3) After this SQL: sign in as the ADMIN with Google once in the app so
--    the mailbox refresh token can be stored (and set GOOGLE_OAUTH_CLIENT_SECRET in .env).
-- =============================================================================

-- Admin: owns the Gmail connection
UPDATE public.profiles
SET
  role = 'admin',
  mailbox_owner_id = NULL,
  updated_at = NOW()
WHERE id = (
  SELECT id
  FROM auth.users
  WHERE lower(email) = lower('chetangalla248@gmail.com')
  LIMIT 1
);

-- Staff: reads/sends via admin mailbox (replace email if you add more staff later)
UPDATE public.profiles
SET
  role = 'staff',
  mailbox_owner_id = (
    SELECT id
    FROM auth.users
    WHERE lower(email) = lower('chetangalla248@gmail.com')
    LIMIT 1
  ),
  updated_at = NOW()
WHERE id = (
  SELECT id
  FROM auth.users
  WHERE lower(email) = lower('g24072@astra.xlri.ac.in')
  LIMIT 1
);

-- Optional: verify rows (read-only; safe to run)
SELECT u.email AS auth_email, p.role, p.mailbox_owner_id,
       (SELECT email FROM auth.users WHERE id = p.mailbox_owner_id) AS linked_admin_email
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE lower(u.email) IN (
  lower('chetangalla248@gmail.com'),
  lower('g24072@astra.xlri.ac.in')
)
ORDER BY p.role DESC, u.email;
