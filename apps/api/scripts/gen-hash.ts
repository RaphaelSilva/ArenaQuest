import { JwtAuthAdapter } from '../src/adapters/auth/jwt-auth-adapter';

const auth = new JwtAuthAdapter({
  secret: 'dummy-secret-at-least-32-chars-long-dummy',
  pbkdf2Iterations: 100_000,
});

async function main() {
  // When called with --password <value>, print only the hash so the output
  // can be piped / pasted directly into SQL without stripping extra lines.
  const pwFlagIdx = process.argv.indexOf('--password');
  if (pwFlagIdx !== -1) {
    const password = process.argv[pwFlagIdx + 1];
    if (!password) {
      process.stderr.write('Usage: pnpm run gen-hash -- --password <your-password>\n');
      process.exit(1);
    }
    const hash = await auth.hashPassword(password);
    process.stdout.write(hash + '\n');
    return;
  }

  // Default mode: print seed hash + dummy hash for dev/docs use.
  const email = 'admin@arenaquest.com';
  const password = 'password123';
  const hash = await auth.hashPassword(password);
  console.log(`Email:    ${email}`);
  console.log(`Password: ${password}`);
  console.log(`Hash:     ${hash}`);

  const dummy = await auth.hashPassword('arenaquest-dummy-password');
  console.log('');
  console.log('Dummy hash (paste into auth-service.ts DUMMY_PASSWORD_HASH):');
  console.log(dummy);
}

main().catch(console.error);
