import { JwtAuthAdapter } from '../src/adapters/auth/jwt-auth-adapter';

async function main() {
  const auth = new JwtAuthAdapter({
    secret: 'dummy-secret-at-least-32-chars-long-dummy',
    pbkdf2Iterations: 100000,
  });

  // Default demo: hash the seed password.
  const email = 'admin@arenaquest.com';
  const password = 'password123';
  const hash = await auth.hashPassword(password);
  console.log(`Email:    ${email}`);
  console.log(`Password: ${password}`);
  console.log(`Hash:     ${hash}`);

  // S-03 dummy hash — used by AuthService.login to keep the missing-email
  // branch CPU-equivalent to the wrong-password branch.
  const dummy = await auth.hashPassword('arenaquest-dummy-password');
  console.log('');
  console.log('Dummy hash (paste into auth-service.ts DUMMY_PASSWORD_HASH):');
  console.log(dummy);
}

main().catch(console.error);
