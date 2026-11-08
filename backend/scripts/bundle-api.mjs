// Bundles the API Lambda (src/handlers/api.ts `handler`) into dist/api.zip for Terraform.
// The zip holds one file, index.mjs (Lambda handler "index.handler"); fixed timestamps keep the
// archive (and so the Lambda's source_code_hash) identical for identical source.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { build } from 'esbuild';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(backendDir, 'dist');

const result = await build({
  entryPoints: [path.join(backendDir, 'src/handlers/api.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  mainFields: ['module', 'main'],
  // Same as the CDK bundling: CJS dependencies call require() inside the ESM bundle.
  banner: { js: "import { createRequire } from 'module';const require = createRequire(import.meta.url);" },
  // The Lambda Node.js 22 runtime ships AWS SDK v3 (CDK NodejsFunction default).
  external: ['@aws-sdk/*'],
  write: false,
  logLevel: 'warning',
});
const code = Buffer.from(result.outputFiles[0].contents);

/** A single-entry, deflated zip archive (local header + data + central directory + end record). */
function zipOne(name, data) {
  const nameBuf = Buffer.from(name);
  const deflated = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const dosTime = 0;
  const dosDate = (1 << 5) | 1; // 1980-01-01

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(deflated.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30); // extra
  central.writeUInt16LE(0, 32); // comment
  central.writeUInt16LE(0, 34); // disk
  central.writeUInt16LE(0, 36); // internal attrs
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: -rw-r--r--
  central.writeUInt32LE(0, 42); // local header offset

  const localSize = local.length + nameBuf.length + deflated.length;
  const centralSize = central.length + nameBuf.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localSize, 16);

  return Buffer.concat([local, nameBuf, deflated, central, nameBuf, end]);
}

mkdirSync(distDir, { recursive: true });
const zipPath = path.join(distDir, 'api.zip');
writeFileSync(zipPath, zipOne('index.mjs', code));
console.log(`wrote ${path.relative(process.cwd(), zipPath)} (${code.length} bytes of code)`);
