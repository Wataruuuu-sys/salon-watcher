// Static checks on the resolved docker-compose config (`npm run check:compose`).
// Guards the dev stack's invariants, notably that no LocalStack service exists and ports stay on loopback.
import { execFileSync } from 'node:child_process';

/** Resolved compose config as JSON; tries the `docker compose` plugin first, then standalone `docker-compose`. */
function composeConfig() {
  const attempts = [
    ['docker', ['compose', '--profile', '*', 'config', '--format', 'json']],
    ['docker-compose', ['--profile', '*', 'config', '--format', 'json']],
  ];
  const errors = [];
  for (const [cmd, args] of attempts) {
    try {
      return JSON.parse(execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    } catch (err) {
      errors.push(`${cmd} ${args.join(' ')}: ${String(err.stderr || err.message).trim()}`);
    }
  }
  throw new Error(`could not read compose config:\n${errors.join('\n')}`);
}

function isGitIgnored(path) {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

const config = composeConfig();
const services = config.services ?? {};
const dependsOn = (name) => Object.keys(services[name]?.depends_on ?? {});

for (const name of ['db', 'batch', 'api', 'frontend', 'tools']) {
  check(name in services, `service '${name}' is missing`);
}
// AWS is verified on the real account (spec 3.12); no emulator belongs in the stack.
check(!('localstack' in services), "service 'localstack' must not exist");

check(services.api?.depends_on?.db?.condition === 'service_healthy', 'api must wait for a healthy db');
check(Boolean(services.db?.healthcheck), 'db needs a healthcheck');

// Dev ports must not be reachable from the LAN.
for (const [name, svc] of Object.entries(services)) {
  for (const port of svc.ports ?? []) {
    check(port.host_ip === '127.0.0.1', `${name}: published port ${port.published} must bind 127.0.0.1 (got '${port.host_ip ?? 'all interfaces'}')`);
  }
}

check(services.batch?.environment?.APP_ENV === 'local', 'batch must set APP_ENV=local');
check(services.batch?.build?.target === 'batch', 'batch must build the Dockerfile batch stage');
check((services.batch?.profiles ?? []).includes('batch'), "batch must be behind the 'batch' profile");
check((services.tools?.profiles ?? []).includes('tools'), "tools must be behind the 'tools' profile");
check(services.api?.environment?.APP_ENV === 'local', 'api must set APP_ENV=local');
check(services.frontend?.environment?.NEXT_PUBLIC_AUTH_MODE === 'none', 'frontend must set NEXT_PUBLIC_AUTH_MODE=none');

check(isGitIgnored('.env'), '.env must be git-ignored');

if (failures.length > 0) {
  console.error(`check:compose FAILED\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('check:compose OK');
