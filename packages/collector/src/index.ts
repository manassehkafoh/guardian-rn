import Fastify from 'fastify';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-key';

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
  const body = request.body as { sessionId?: string; publicKeyHash?: string } | undefined;

  if (!body || typeof body.sessionId !== 'string' || typeof body.publicKeyHash !== 'string') {
    return reply.code(400).send({ error: 'Missing or invalid sessionId or publicKeyHash' });
  }

  const { sessionId, publicKeyHash } = body;

  // Note: Derivation of session key from publicKeyHash would happen here
  // For now, we issue the token as per ADR-0007

  const sessionToken = jwt.sign(
    { sessionId, publicKeyHash },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  return reply.send({ sessionToken, expiresAt });
});

const PORT = parseInt(process.env.PORT ?? '4200', 10);

app.listen({ port: PORT, host: '0.0.0.0' }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
