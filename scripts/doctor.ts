import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { diagnoseEnvironment, formatDoctorReport, type DoctorOptions } from '../src/core/doctor.js';

const args = new Set(process.argv.slice(2));
if ([...args].some(argument => !['--offline', '--json'].includes(argument))) {
  process.stderr.write('Kullanım: npm run doctor -- [--offline] [--json]\n');
  process.exitCode = 2;
} else {
  let envFile: DoctorOptions['envFile'] = 'missing';
  let local: Record<string, string> = {};
  try { local = parse(await readFile('.env', 'utf8')); envFile = 'present'; }
  catch (error) {
    envFile = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT' ? 'missing' : 'unreadable';
  }
  const report = diagnoseEnvironment({ ...local, ...process.env }, { mode: args.has('--offline') ? 'offline' : 'live', envFile, nodeVersion: process.version });
  process.stdout.write(args.has('--json') ? `${JSON.stringify(report, null, 2)}\n` : formatDoctorReport(report));
  process.exitCode = report.ready ? 0 : 1;
}
