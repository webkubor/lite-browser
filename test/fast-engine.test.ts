import { describe, it, expect } from 'bun:test';
import { INJECTED_DOM_SCRIPT, FAST_RESOLVE_TARGET_SCRIPT, ADAPTIVE_SETTLE_SCRIPT, formatSnapshot } from '../src/dom.js';

describe('Jev-Ultrafast Fast Engine Integration', () => {
  it('should include cache and checkVisibility in INJECTED_DOM_SCRIPT', () => {
    expect(INJECTED_DOM_SCRIPT).toContain('__lite_fast__');
    expect(INJECTED_DOM_SCRIPT).toContain('checkVisibility');
    expect(INJECTED_DOM_SCRIPT).toContain('aria-labelledby');
    expect(INJECTED_DOM_SCRIPT).toContain('pageKey');
  });

  it('should validate FAST_RESOLVE_TARGET_SCRIPT structure and safety', () => {
    expect(FAST_RESOLVE_TARGET_SCRIPT).toContain('elementFromPoint');
    expect(FAST_RESOLVE_TARGET_SCRIPT).toContain('getBoundingClientRect');
    expect(FAST_RESOLVE_TARGET_SCRIPT).toContain('checkVisibility');
    expect(FAST_RESOLVE_TARGET_SCRIPT).toContain('occluded');
  });

  it('should validate ADAPTIVE_SETTLE_SCRIPT structure', () => {
    expect(ADAPTIVE_SETTLE_SCRIPT).toContain('requestAnimationFrame');
    expect(ADAPTIVE_SETTLE_SCRIPT).toContain('isCombobox');
    expect(ADAPTIVE_SETTLE_SCRIPT).toContain('role="option"');
  });

  it('formatSnapshot should cleanly format extracted elements', () => {
    const mockElements = [
      { id: '@1', tag: 'button', role: 'button', text: 'Search Flights', selector: '#search-btn', x: 120, y: 45, width: 80, height: 32 },
      { id: '@2', tag: 'input', role: 'combobox', text: 'From City', selector: '#origin-input', x: 200, y: 45, width: 120, height: 32 },
    ];
    const formatted = formatSnapshot(mockElements, 'https://flights.google.com', 'Google Flights');
    expect(formatted).toContain('Google Flights');
    expect(formatted).toContain('@1');
    expect(formatted).toContain('Search Flights');
    expect(formatted).toContain('(x:120, y:45)');
  });
});
