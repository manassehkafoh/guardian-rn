import Fastify from 'fastify';
import * as net from 'net';

const app = Fastify({ logger: true });

app.get('/health', async () => ({
  status: 'ok',
  version: process.env.npm_package_version ?? '1.0.0',
  uptime: Math.floor(process.uptime()),
}));

app.post('/ingest', async (request, reply) => {
  // TODO Phase 3: mTLS validation, HMAC verification, ECS validation, PII redaction, fan-out
  reply.code(501).send({ error: 'not implemented — Phase 3' });
});

// Dev-only debug endpoint (disabled in production)
if (process.env.NODE_ENV !== 'production') {
  app.post('/ingest/debug', async (request, reply) => {
    const payload = request.body as Record<string, unknown>;

    // Simulate HMAC verification success for dev-bypass
    if (typeof payload === 'object' && payload !== null) {
      if (!('guardian' in payload)) {
        payload.guardian = {};
      }
      const guardian = payload.guardian as Record<string, unknown>;
      if (!('envelope' in guardian)) {
        guardian.envelope = {};
      }
      const envelope = guardian.envelope as Record<string, unknown>;
      envelope.verified = true;
    }

    const host = process.env.LOGSTASH_HOST ?? 'logstash';
    const port = parseInt(process.env.LOGSTASH_PORT ?? '5044', 10);

    try {
      await new Promise<void>((resolve, reject) => {
        const client = new net.Socket();
        client.connect(port, host, () => {
          client.write(JSON.stringify(payload) + '\n', () => {
            client.destroy();
            resolve();
          });
        });
        client.on('error', reject);
      });
      return reply.send({ status: 'ok', debug: true });
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: 'failed to write to Logstash' });
    }
  });
}

app.post('/session', async (request, reply) => {
  // TODO Phase 3: session handshake — return JWT session token
  reply.code(501).send({ error: 'not implemented — Phase 3' });
});

const PORT = parseInt(process.env.PORT ?? '4200', 10);

app.listen({ port: PORT, host: '0.0.0.0' }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
