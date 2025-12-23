INSERT INTO public.org_members (org_id, user_id, role)
SELECT 
  '11111111-1111-1111-1111-111111111111',
  id,
  'FO_TRADER'
FROM auth.users 
WHERE email = 'vinay2.k@intellectdesign.com'
ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role;



