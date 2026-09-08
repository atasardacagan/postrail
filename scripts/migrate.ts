import 'dotenv/config';
import { PgDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL eksik. .env.example dosyasından .env oluşturun.');
const db = new PgDatabase(url);
try { await migrate(db); process.stdout.write('Database migrations complete.\n'); }
finally { await db.close(); }
