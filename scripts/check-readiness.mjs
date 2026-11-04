import { mkdir, writeFile } from 'node:fs/promises';
export const API_ORIGIN = 'https://coldspan-api.tajudeenowoeteniyan.workers.dev';
export const SITE_ORIGIN = 'https://coldspan-preview.deeen-code.chatgpt.site';
export async function checkReadiness(transport = fetch, expectedBuild = process.env.EXPECTED_BUILD) {
  const checks = [];
  for (const path of ['/api/health', '/api/capabilities']) {
    try {
      const r = await transport(API_ORIGIN + path, { headers: { Origin: SITE_ORIGIN }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      const data = await r.json();
      const pass = r.status === 200 && r.headers.get('access-control-allow-origin') === SITE_ORIGIN && data.mode === 'SYNTHETIC_SIMULATOR' && (path.endsWith('health') ? data.status === 'ok' && data.storage === 'CLOUDFLARE_DURABLE_OBJECT_SQLITE' && (!expectedBuild || data.build === expectedBuild) : ['UNAVAILABLE', 'CONFIGURED_NOT_VERIFIED'].includes(data.model?.status));
      checks.push({ path, pass, ...(path.endsWith('health') ? { build: data.build ?? null } : { model: data.model?.status ?? null, reason: data.model?.reason ?? null }) });
    } catch { checks.push({ path, pass: false, reason: 'REQUEST_OR_RESPONSE_FAILED' }); }
  }
  return { checkedAt: new Date().toISOString(), kind: 'READ_ONLY_API_READINESS', pass: checks.every(c => c.pass), checks, limitation: 'Availability and configuration only. Does not prove browser workflow, account recovery, live model behavior or physical operation.' };
}
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const report = await checkReadiness();
  await mkdir('ops-output', { recursive: true });
  await writeFile('ops-output/readiness.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (!report.pass) process.exitCode = 1;
}
