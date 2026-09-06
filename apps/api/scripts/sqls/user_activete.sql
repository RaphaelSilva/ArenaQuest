-- 1) Activate the account.
UPDATE users
   SET status = 'active'
 WHERE email = 'eng.raphaelsn@gmail.com'
   AND status <> 'active';

-- 2) Burn any outstanding activation token for that user.
UPDATE user_activation_tokens
   SET consumed_at = CAST(strftime('%s','now') AS INTEGER) * 1000
 WHERE consumed_at IS NULL
   AND user_id = (SELECT id FROM users WHERE email = 'eng.raphaelsn@gmail.com');

-- 3) Update user role
UPDATE user_roles 
	 SET role_id  = (SELECT id FROM roles WHERE name = 'admin')
 WHERE user_id = (SELECT id FROM users WHERE email = 'eng.raphaelsn@gmail.com');