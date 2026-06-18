// Sends a single OTLP span to Honeycomb for a CI job.
// Usage: node send-trace.js --job <name> --status <status> --run-id <id> --sha <sha> --ref <ref>
const https = require('https');
const url = require('url');

function arg(name) {
  var idx = process.argv.indexOf('--' + name);
  return idx >= 0 ? process.argv[idx + 1] : '';
}

var apiKey = process.env.HONEYCOMB_API_KEY;
if (!apiKey) {
  console.log('No HONEYCOMB_API_KEY set, skipping trace export');
  process.exit(0);
}

var jobName = arg('job');
var status = arg('status');
var runId = arg('run-id');
var sha = arg('sha');
var ref = arg('ref');

var nowNs = BigInt(Date.now()) * BigInt(1000000);
var durationNs = BigInt(1000000); // nominal 1ms — we don't have real timing here

var traceId = (runId + '0000000000000000').slice(0, 32).replace(/[^0-9a-f]/gi, '0');
var spanId = Buffer.from(jobName.padEnd(8, '0').slice(0, 8)).toString('hex');

var body = JSON.stringify({
  resourceSpans: [{
    resource: {
      attributes: [
        { key: 'service.name', value: { stringValue: 'comics-app-ci' } },
        { key: 'ci.provider', value: { stringValue: 'github-actions' } },
      ]
    },
    scopeSpans: [{
      scope: { name: 'comics-app-ci' },
      spans: [{
        traceId: traceId,
        spanId: spanId,
        name: 'job/' + jobName,
        kind: 1,
        startTimeUnixNano: String(nowNs - durationNs),
        endTimeUnixNano: String(nowNs),
        status: { code: status === 'success' ? 1 : 2 },
        attributes: [
          { key: 'ci.job', value: { stringValue: jobName } },
          { key: 'ci.status', value: { stringValue: status } },
          { key: 'ci.run_id', value: { stringValue: runId } },
          { key: 'ci.sha', value: { stringValue: sha } },
          { key: 'ci.ref', value: { stringValue: ref } },
        ]
      }]
    }]
  }]
});

var parsed = url.parse('https://api.honeycomb.io/v1/traces');
var options = {
  hostname: parsed.hostname,
  path: parsed.path,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-honeycomb-team': apiKey,
    'x-honeycomb-dataset': 'comics-app-ci',
    'Content-Length': Buffer.byteLength(body),
  }
};

var req = https.request(options, function (res) {
  console.log('Honeycomb response:', res.statusCode);
  res.resume();
});

req.on('error', function (e) {
  console.error('Failed to send trace:', e.message);
});

req.write(body);
req.end();
