import { describe, expect, it } from 'vitest';
import { isOutOfRange, selectSingleSidedToken } from './helpers.js';

describe('range helpers', () => {
	it('detects in-range ticks', () => {
		expect(isOutOfRange(5, 0, 10)).toBe(false);
	});

	it('detects below range', () => {
		expect(isOutOfRange(-1, 0, 10)).toBe(true);
	});

	it('detects above range', () => {
		expect(isOutOfRange(11, 0, 10)).toBe(true);
	});
});

describe('selectSingleSidedToken', () => {
	it('prefers A when below range', () => {
		expect(selectSingleSidedToken(-5, 0, 10, true, true)).toBe('A');
	});

	it('prefers B when above range', () => {
		expect(selectSingleSidedToken(11, 0, 10, true, true)).toBe('B');
	});

	it('returns null when no balance configured', () => {
		expect(selectSingleSidedToken(5, 0, 10, false, false)).toBeNull();
	});

	it('falls back to available side when in range', () => {
		expect(selectSingleSidedToken(5, 0, 10, false, true)).toBe('B');
	});
});
