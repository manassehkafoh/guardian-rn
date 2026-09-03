import { app } from '../index';

describe('/session endpoint', () => {
  afterAll(async () => {
    await app.close();
  });

  it('should return 401 if X-API-Key is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/session',
      payload: {
        sessionId: 'test-session-id',
        publicKeyHash: 'test-hash'
      }
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.payload)).toEqual({ error: 'Missing X-API-Key header' });
  });

  it('should return 400 if sessionId or publicKeyHash is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/session',
      headers: {
        'x-api-key': 'test-key'
      },
      payload: {
        sessionId: 'test-session-id'
        // Missing publicKeyHash
      }
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload)).toEqual({ error: 'Missing sessionId or publicKeyHash in body' });
  });

  it('should return 200 with sessionToken and expiresAt if valid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/session',
      headers: {
        'x-api-key': 'test-key'
      },
      payload: {
        sessionId: 'test-session-id',
        publicKeyHash: 'test-hash'
      }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body).toHaveProperty('sessionToken');
    expect(body).toHaveProperty('expiresAt');
  });
});
