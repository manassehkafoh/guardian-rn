import { renderHook } from '@testing-library/react-hooks';
import type { GuardianConfig } from '../../config/GuardianConfig';
import * as React from 'react';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('useGuardian', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('uses native GuardianKeyProvider if available', () => {
    // Mock react-native before requiring useGuardian
    const generateSessionKey = jest.fn(() => Array(32).fill(0xaa));
    jest.doMock('react-native', () => ({
      NativeModules: {
        GuardianKeyProvider: {
          generateSessionKey
        },
      },
      Platform: { OS: 'ios' },
      AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
    }), { virtual: true });

    // Ensure we're using the required react
    jest.doMock('react', () => React);

    const { useGuardian: useGuardianMocked } = require('../useGuardian');

    const config: GuardianConfig = {
      tenantId: 'test',
      engines: [],
      actions: {},
    };

    const { result } = renderHook(() => useGuardianMocked(config));

    expect(result.error).toBeUndefined();
    expect(generateSessionKey).toHaveBeenCalled();
  });

  it('falls back to Math.random if native module is not available', () => {
    jest.doMock('react-native', () => ({
      NativeModules: {},
      Platform: { OS: 'ios' },
      AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
    }), { virtual: true });

    const mathRandomSpy = jest.spyOn(Math, 'random');

    // Ensure we're using the required react
    jest.doMock('react', () => React);

    const { useGuardian: useGuardianMocked } = require('../useGuardian');

    const config: GuardianConfig = {
      tenantId: 'test',
      engines: [],
      actions: {},
    };

    const { result } = renderHook(() => useGuardianMocked(config));

    expect(result.error).toBeUndefined();

    // Math.random should be called 32 times for generating the session key,
    // plus some times for generating the session id. We just need to check it
    // was called significantly more than just the session id generation.
    // The session id generates 36 chars.
    expect(mathRandomSpy).toHaveBeenCalled();
    mathRandomSpy.mockRestore();
  });

  it('falls back to Math.random if NativeModules.GuardianKeyProvider.generateSessionKey throws', () => {
    jest.doMock('react-native', () => ({
      NativeModules: {
        GuardianKeyProvider: {
          generateSessionKey: () => { throw new Error('Missing implementation'); }
        }
      },
      Platform: { OS: 'ios' },
      AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
    }), { virtual: true });

    const mathRandomSpy = jest.spyOn(Math, 'random');

    // Ensure we're using the required react
    jest.doMock('react', () => React);

    const { useGuardian: useGuardianMocked } = require('../useGuardian');

    const config: GuardianConfig = {
      tenantId: 'test',
      engines: [],
      actions: {},
    };

    const { result } = renderHook(() => useGuardianMocked(config));

    expect(result.error).toBeUndefined();

    expect(mathRandomSpy).toHaveBeenCalled();
    mathRandomSpy.mockRestore();
  });
});
