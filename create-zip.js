/**
 * Game On Dude! - Create Deployment ZIP for Elastic Beanstalk
 * www.gameonguy.com
 *
 * Usage: node create-zip.js
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const OUTPUT_FILE = 'gameondude-server-deploy.zip';
const PROJECT_ROOT = __dirname;

// Files and folders to include in the ZIP
const ITEMS_TO_INCLUDE = [
  'dist',
  'node_modules',
  'package.json',
  'package-lock.json',
  'Procfile',
  '.ebextensions',
  '.platform',
  'db'
];

async function createZip() {
  console.log('========================================');
  console.log('Game On Dude! - Deployment ZIP Creator');
  console.log('========================================\n');

  const outputPath = path.join(PROJECT_ROOT, OUTPUT_FILE);

  // Remove existing zip if present
  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
    console.log(`Removed existing ${OUTPUT_FILE}`);
  }

  const output = fs.createWriteStream(outputPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
      console.log(`\n========================================`);
      console.log(`ZIP Created Successfully!`);
      console.log(`========================================`);
      console.log(`File: ${OUTPUT_FILE}`);
      console.log(`Size: ${sizeMB} MB`);
      console.log(`\nNext Steps:`);
      console.log(`1. Go to AWS Console -> Elastic Beanstalk`);
      console.log(`2. Create application -> Platform: Node.js 20`);
      console.log(`3. Upload this ZIP file`);
      console.log(`4. Set environment variables:`);
      console.log(`   - DATABASE_URL`);
      console.log(`   - REDIS_URL`);
      console.log(`   - JWT_SECRET`);
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') {
        console.warn('Warning:', err.message);
      }
    });

    archive.pipe(output);

    // Add each item
    for (const item of ITEMS_TO_INCLUDE) {
      const itemPath = path.join(PROJECT_ROOT, item);

      if (!fs.existsSync(itemPath)) {
        console.log(`  Skipping ${item} (not found)`);
        continue;
      }

      const stats = fs.statSync(itemPath);

      if (stats.isDirectory()) {
        console.log(`  Adding ${item}/...`);
        archive.directory(itemPath, item);
      } else {
        console.log(`  Adding ${item}...`);
        archive.file(itemPath, { name: item });
      }
    }

    // Build stamp shown on /health. Run as `LABEL=<version-label> node create-zip.js`
    // so it matches the Elastic Beanstalk version label.
    const buildInfo = {
      version: process.env.LABEL || `build-${new Date().toISOString().slice(0, 16)}Z`,
      builtAt: new Date().toISOString(),
    };
    console.log(`  Adding dist/build-info.json (version ${buildInfo.version})`);
    archive.append(JSON.stringify(buildInfo), { name: 'dist/build-info.json' });

    archive.finalize();
  });
}

createZip().catch(err => {
  console.error('Error creating ZIP:', err);
  process.exit(1);
});
