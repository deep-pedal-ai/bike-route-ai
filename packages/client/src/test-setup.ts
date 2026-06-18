import '@testing-library/jest-dom';

// jsdom doesn't implement matchMedia; useIsMobile (and any future media hook)
// needs it. Default to `matches: false` so tests run on the desktop layout path
// unless a test overrides window.matchMedia itself.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// jsdom doesn't implement scrollIntoView; Conversation scrolls to the latest
// message as it streams, so the call needs a no-op stand-in under test.
Element.prototype.scrollIntoView = () => {};
