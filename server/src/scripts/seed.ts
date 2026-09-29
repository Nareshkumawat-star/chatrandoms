/**
 * Dev-only seed: creates demo users so username search & DMs can be tested.
 * Usage: npm run seed  (from server/)
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User.js';
import { config } from '../config/env.js';

dotenv.config();

const DEMO_USERS = [
  { username: 'nareshk', displayName: 'Naresh Kumawat', email: 'nareshk@demo.local', bio: 'Building things on the internet 🚀' },
  { username: 'rahulsharma', displayName: 'Rahul Sharma', email: 'rahul@demo.local', bio: 'Coffee. Code. Cricket.' },
  { username: 'priya', displayName: 'Priya Patel', email: 'priya@demo.local', bio: 'Designer. Dreamer.' },
  { username: 'devguy', displayName: 'Dev Guy', email: 'dev@demo.local', bio: 'Node & React' },
  { username: 'worldtraveler', displayName: 'World Traveler', email: 'travel@demo.local', bio: '42 countries and counting 🌍' },
];

async function main() {
  await mongoose.connect(config.mongoUri);
  console.log('Connected. Seeding demo users…');

  for (const u of DEMO_USERS) {
    const exists = await User.findOne({ usernameLower: u.username });
    if (exists) {
      console.log(`- ${u.username} already exists, skipping`);
      continue;
    }
    await User.create({
      ...u,
      usernameLower: u.username,
      passwordHash: null, // demo accounts: no login (search-only) — or set a password below
    });
    console.log(`+ created ${u.username}`);
  }

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
