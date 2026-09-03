import Fastify from 'fastify';
import * as jwt from 'jsonwebtoken';

export const app = Fastify({ logger: true });

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-key-do-not-use-in-prod';

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
  const apiKey = request.headers['x-api-key'];
  if (!apiKey) {
    return reply.code(401).send({ error: 'Missing X-API-Key header' });
  }

  const body = request.body as { sessionId?: string; publicKeyHash?: string };
  if (!body || !body.sessionId || !body.publicKeyHash) {
    return reply.code(400).send({ error: 'Missing sessionId or publicKeyHash in body' });
  }

  const { sessionId, publicKeyHash } = body;

  const expiresIn = '1h';
  const sessionToken = jwt.sign(
    { sessionId, publicKeyHash },
    JWT_SECRET,
    { expiresIn }
  );

  // Calculate expiresAt as an ISO-8601 string (1 hour from now)
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  return reply.code(200).send({ sessionToken, expiresAt });
});

const PORT = parseInt(process.env.PORT ?? '4200', 10);

if (require.main === module) {
  app.listen({ port: PORT, host: '0.0.0.0' }).catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
}
