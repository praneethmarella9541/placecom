-- Add a second admin (run in Supabase SQL Editor)
-- Prerequisite: venkatapraneeth4@gmail.com must exist under Authentication → Users
-- (sign in with Google once in your app, or invite/create the user first).

UPDATE public.profiles
SET
  role = 'admin',
  mailbox_owner_id = NULL,
  updated_at = NOW()
WHERE id = (
  SELECT id
  FROM auth.users
  WHERE lower(email) = lower('venkatapraneeth4@gmail.com')
  LIMIT 1
);

-- Optional: confirm
SELECT u.email, p.role, p.mailbox_owner_id
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE lower(u.email) = lower('venkatapraneeth4@gmail.com');
