import mongoose from 'mongoose';
import { User } from '../models/User.js';

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:51712/pulse-chat');
  const emails = [
    'nareshkmt112006@gmail.com',
    'nareshkmt112006@gmail.com ',
    'Nareshkmt112006@gmail.com',
    'naresh',
    'Naresh',
  ];

  for (const raw of emails) {
    const ident = raw.toLowerCase().trim();
    const u = await User.findOne({
      $or: [{ usernameLower: ident }, { email: ident }],
    });
    console.log(`Query "${raw}" (ident="${ident}") ->`, u ? `Found: ${u.username} (${u.email})` : 'NOT FOUND');
  }

  process.exit(0);
}

main().catch(console.error);
