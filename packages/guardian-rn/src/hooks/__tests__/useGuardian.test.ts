
describe('wireAppStateThrottle', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns undefined when react-native require throws', () => {
    // Override require for react-native inside this test
    jest.doMock('react-native', () => {
      throw new Error('Module not found');
    }, { virtual: true });

    // Re-import to ensure it picks up the mock
    const { wireAppStateThrottle: testFn } = require('../useGuardian.js');

    const result = testFn([]);
    expect(result).toBeUndefined();
  });

  it('subscribes to AppState and handles state changes', () => {
    const mockRemove = jest.fn();
    let changeHandler: (state: string) => void = () => {};

    jest.doMock('react-native', () => ({
      AppState: {
        addEventListener: jest.fn((event, handler) => {
          if (event === 'change') {
            changeHandler = handler;
          }
          return { remove: mockRemove };
        }),
      },
    }), { virtual: true });

    const { wireAppStateThrottle: testFn } = require('../useGuardian.js');

    const mockEngine = { throttle: jest.fn() };
    const engines = [mockEngine as unknown as import("../../engine/Engine.js").Engine];

    const unsubscribe = testFn(engines);

    expect(unsubscribe).toBeDefined();

    // Trigger state changes
    changeHandler('active');
    expect(mockEngine.throttle).toHaveBeenCalledWith('foreground');

    changeHandler('background');
    expect(mockEngine.throttle).toHaveBeenCalledWith('background');

    // Test unsubscribe
    if (unsubscribe) {
        unsubscribe();
    }
    expect(mockRemove).toHaveBeenCalled();
  });
});
