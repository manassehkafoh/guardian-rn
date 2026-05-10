import Fastify from 'fastify';

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
    // TODO Phase 3: accept dev-bypass HMAC, write directly to Logstash sink
    reply.code(501).send({ error: 'not implemented — Phase 3' });
  });
}

app.post('/session', async (request, reply) => {
  // TODO Phase 3: session handshake — return JWT session token
  reply.code(501).send({ error: 'not implemented — Phase 3' });
});

const PORT = parseInt(process.env.PORT ?? '4200', 10);

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
