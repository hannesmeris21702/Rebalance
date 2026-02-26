import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './bot.js';
import { isOutOfRange, selectSingleSidedToken } from './helpers.js';

vi.mock('@cetusprotocol/cetus-sui-clmm-sdk', () => ({
	CetusClmmSDK: class {},
	ClmmPoolUtil: {
		getCoinAmountFromLiquidity: vi.fn(),
		estLiquidityAndcoinAmountFromOneAmounts: vi.fn(),
	},
	initCetusSDK: vi.fn(),
	Position: class {},
	Pool: class {},
	TickMath: {
		tickIndexToSqrtPriceX64: vi.fn(),
	},
}));

const baseEnv = { ...process.env };
const requiredEnv = {
	SUI_PRIVATE_KEY: 'suiprivkey...',
	POOL_ID: '0xpoolid',
	LOWER_TICK: '0',
	UPPER_TICK: '10',
	CHECK_INTERVAL_SECONDS: '60',
	ZAP_AMOUNT_A: '0',
	ZAP_AMOUNT_B: '0',
	ZAP_SLIPPAGE_BPS: '50',
};

function setEnv(overrides: Record<string, string | undefined>): void {
	process.env = { ...baseEnv, ...requiredEnv, ...overrides };
}

afterEach(() => {
	process.env = { ...baseEnv };
});

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

describe('loadConfig network validation', () => {
	it('rejects mainnet config with testnet RPC', () => {
		setEnv({ SUI_NETWORK: 'mainnet', SUI_RPC_URL: 'https://fullnode.testnet.sui.io' });
		expect(() => loadConfig()).toThrow(/SUI_RPC_URL .* does not match SUI_NETWORK mainnet/);
	});

	it('rejects testnet config with mainnet RPC', () => {
		setEnv({ SUI_NETWORK: 'testnet', SUI_RPC_URL: 'https://fullnode.mainnet.sui.io' });
		expect(() => loadConfig()).toThrow(/SUI_RPC_URL .* does not match SUI_NETWORK testnet/);
	});

	it('rejects invalid RPC URL format', () => {
		setEnv({ SUI_RPC_URL: 'not-a-url' });
		expect(() => loadConfig()).toThrow(/Invalid SUI_RPC_URL format/);
	});
});
