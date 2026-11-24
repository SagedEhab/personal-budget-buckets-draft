// Creates the first administrator account. Admins cannot self-register (the register
// endpoint always creates role "user"), so this one-off script is the only way in.
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/seed-admin.js
// Run it with USERS_TABLE + AWS_PROFILE=floci (+ AWS_ENDPOINT_URL) to seed the Floci table.
// The password comes from the environment of the person running it, never from the repository.
const app = require('../app');

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !/^(?=.*[A-Za-z])(?=.*\d).{10,128}$/.test(password)) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD (10+ characters, letters and digits).');
    process.exit(1);
  }
  const user = await app.locals.createUser({ name: 'Administrator', email, password, role: 'admin' });
  if (!user) {
    console.error('An account with this e-mail already exists.');
    process.exit(1);
  }
  console.log(`Admin created with id ${user.id}`);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
