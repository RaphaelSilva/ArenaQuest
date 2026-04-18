import { JwtAuthAdapter } from '../src/adapters/auth/jwt-auth-adapter';

async function main() {
  const auth = new JwtAuthAdapter({
    secret: 'dummy-secret-at-least-32-chars-long-dummy',
    pbkdf2Iterations: 100000
  });

  const email = 'admin@arenaquest.com';
  const password = 'password123';
  const hash = await auth.hashPassword(password);

  console.log(`Email: ${email}`);
  console.log(`Password: ${password}`);
  console.log(`Hash: ${hash}`);
}

main().catch(console.error);
