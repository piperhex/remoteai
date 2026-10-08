// Existing UI fixtures assert Chinese copy. Make their locale explicit now that
// new installations follow the system language; locale-specific tests override it.
const testNavigator = globalThis.navigator ?? {};
Object.defineProperty(testNavigator, 'language', { configurable: true, get: () => 'zh-CN' });
if (!globalThis.navigator) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: testNavigator });
}
