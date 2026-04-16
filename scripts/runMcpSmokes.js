const http = require('http');

const MCP_HOST = process.env.MCP_HOST || 'http://localhost:8787';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.TEKAI_OPENAI_API_KEY;
const MODEL = process.env.MCP_SMOKE_MODEL || 'gpt-4o';

if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY (or TEKAI_OPENAI_API_KEY) for MCP smoke tests.');
  process.exit(1);
}

const tests = [
  'Add FastFrame commands for 50 frames',
  'Add frequency and amplitude measurements on CH1, save results to a variable',
  'Add a screenshot step for an MSO5/6 scope',
  'Set up a CAN bus decode on B1 using CAN FD, 500kbps, data on CH2',
];

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode || 0, data }));
      }
    );
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function hasActionsJson(sse) {
  return /ACTIONS_JSON:/i.test(sse);
}

function hasSseError(sse) {
  return /event:\s*error/i.test(sse) || /"ok":\s*false/i.test(sse);
}

async function run() {
  let failed = 0;
  for (const prompt of tests) {
    const payload = {
      userMessage: prompt,
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: OPENAI_API_KEY,
      model: MODEL,
      flowContext: {
        backend: 'pyvisa',
        modelFamily: 'mso_5_series',
        steps: [],
        firmware: '',
        host: '127.0.0.1',
        selectedStepId: '',
        connectionType: 'lan',
        executionSource: 'ci',
      },
      runContext: {
        runStatus: 'idle',
        exitCode: 0,
        logTail: '',
        auditOutput: '',
        duration: 0,
      },
    };

    const res = await postJson(`${MCP_HOST}/ai/chat`, payload);
    const ok = res.status === 200 && hasActionsJson(res.data) && !hasSseError(res.data);
    console.log(`SMOKE: ${prompt}`);
    console.log(`  status=${res.status} actions_json=${hasActionsJson(res.data)} sse_error=${hasSseError(res.data)}`);
    if (!ok) {
      failed += 1;
      const preview = res.data.slice(0, 600).replace(/\s+/g, ' ');
      console.log(`  preview=${preview}`);
    }
  }

  if (failed) {
    console.error(`MCP smoke suite failed: ${failed}/${tests.length}`);
    process.exit(1);
  }
  console.log(`MCP smoke suite passed: ${tests.length}/${tests.length}`);
}

run().catch((err) => {
  console.error('MCP smoke runner error:', err.message || err);
  process.exit(1);
});
