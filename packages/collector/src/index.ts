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
    const body = request.body as any;
    const batchId = body?.batchId;
    const tenantId = body?.tenantId;

    let events = body?.events;
    if (!Array.isArray(events)) {
      events = [];
    }

    let accepted = 0;
    let rejected = 0;

    const host = process.env.LOGSTASH_HOST || '127.0.0.1';
    const port = parseInt(process.env.LOGSTASH_PORT || '5044', 10);

    try {
      await new Promise<void>((resolve, reject) => {
        const client = net.createConnection({ host, port });

        client.on('connect', () => {
          try {
            for (const event of events) {
              if (event.hmac === 'dev-bypass') {
                const doc = {
                  guardian: {
                    envelope: { verified: true },
                    tenantId,
                    batchId,
                    ...event
                  }
                };
                client.write(JSON.stringify(doc) + '\n');
                accepted++;
              } else {
                rejected++;
              }
            }
            client.end();
            resolve();
          } catch (e) {
            client.destroy();
            reject(e);
          }
        });

        client.on('error', (err) => {
          reject(err);
        });
      });

      return { accepted, rejected, batchId };
    } catch (error) {
      app.log.error(error);
      reply.code(500).send({ error: 'Failed to write to Logstash' });
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
