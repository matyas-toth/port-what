import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');
const filesWithRepositoryLinks = [
  'package.json',
  'CHANGELOG.md',
  '.github/ISSUE_TEMPLATE/config.yml',
];
const problems = [];

for (const file of filesWithRepositoryLinks) {
  if (fs.readFileSync(file, 'utf8').includes('YOUR_GITHUB_USERNAME')) {
    problems.push(`${file} still contains YOUR_GITHUB_USERNAME`);
  }
}

if (packageJson.private === true) problems.push('package.json is marked private');
if (packageJson.name !== 'port-what') problems.push('package.json has an unexpected package name');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  problems.push('package.json does not contain a valid release version');
}

if (problems.length > 0) {
  process.stderr.write(`Release is not ready:\n- ${problems.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Release metadata looks ready for ${packageJson.name}@${packageJson.version}.\n`);
}
