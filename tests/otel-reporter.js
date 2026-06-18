const { NodeTracerProvider, BatchSpanProcessor } = require('@opentelemetry/sdk-trace-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { context, trace, SpanStatusCode } = require('@opentelemetry/api');

class HoneycombReporter {
  constructor() {
    const apiKey = process.env.HONEYCOMB_API_KEY;
    if (!apiKey) return;

    const exporter = new OTLPTraceExporter({
      url: 'https://api.honeycomb.io/v1/traces',
      headers: {
        'x-honeycomb-team': apiKey,
        'x-honeycomb-dataset': 'comics-app-e2e',
      },
    });

    this._provider = new NodeTracerProvider({
      resource: new Resource({ 'service.name': 'comics-app-e2e' }),
    });
    this._provider.addSpanProcessor(new BatchSpanProcessor(exporter));
    this._provider.register();
    this._tracer = trace.getTracer('comics-app-e2e');
    this._spans = new Map();
    this._rootSpan = null;
    this._rootContext = null;
  }

  onBegin(config, suite) {
    if (!this._tracer) return;
    this._rootSpan = this._tracer.startSpan('e2e-test-run', {
      attributes: {
        'ci.run_id': process.env.GITHUB_RUN_ID || 'local',
        'ci.sha': process.env.GITHUB_SHA || 'local',
        'ci.ref': process.env.GITHUB_REF || 'local',
        'test.total': suite.allTests().length,
      },
    });
    this._rootContext = trace.setSpan(context.active(), this._rootSpan);
  }

  onTestBegin(test) {
    if (!this._tracer) return;
    const span = this._tracer.startSpan(test.title, {
      attributes: {
        'test.suite': test.parent ? test.parent.title : '',
        'test.file': test.location.file.replace(process.cwd() + '/', ''),
        'test.line': test.location.line,
      },
    }, this._rootContext);
    this._spans.set(test.id, span);
  }

  onTestEnd(test, result) {
    if (!this._tracer) return;
    const span = this._spans.get(test.id);
    if (!span) return;

    span.setAttribute('test.status', result.status);
    span.setAttribute('test.duration_ms', result.duration);

    if (result.status === 'failed' || result.status === 'timedOut') {
      const msg = result.errors.length > 0 ? result.errors[0].message : 'Test failed';
      span.setStatus({ code: SpanStatusCode.ERROR, message: msg });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();
    this._spans.delete(test.id);
  }

  async onEnd(result) {
    if (!this._rootSpan) return;

    this._rootSpan.setAttribute('test.run.status', result.status);
    this._rootSpan.setStatus({
      code: result.status === 'passed' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
    });
    this._rootSpan.end();

    await this._provider.shutdown();
  }
}

module.exports = HoneycombReporter;
