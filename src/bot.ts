import 'dotenv/config';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey, Keypair } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
import { Secp256r1Keypair } from '@mysten/sui/keypairs/secp256r1';
import {
	CetusClmmSDK,
	ClmmPoolUtil,
	initCetusSDK,
	Position,
	Pool,
} from '@cetusprotocol/cetus-sui-clmm-sdk';
import BN from 'bn.js';
import { isOutOfRange, selectSingleSidedToken, Side } from './helpers';

type Network = 'mainnet' | 'testnet';

type Config = {
	rpcUrl: string;
	network: Network;
	privateKey: string;
	poolId: string;
	lowerTick: number;
	upperTick: number;
	checkIntervalMs: number;
	zapAmountA: string;
	zapAmountB: string;
	slippage: number;
};

const MOVE_ABORT_ZERO = 'MoveAbort(0)';

function requiredEnv(key: string): string {
	const value = process.env[key];
	if (!value) {
		throw new Error(`Missing required env ${key}`);
	}
	return value;
}

function parseNumberEnv(key: string, fallback: number): number {
	const raw = process.env[key];
	if (raw === undefined) return fallback;
	const parsed = Number(raw);
	if (Number.isNaN(parsed)) {
		throw new Error(`Invalid number for ${key}`);
	}
	return parsed;
}

function loadConfig(): Config {
	const network: Network = process.env.SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
	const defaultRpc =
		network === 'mainnet' ? 'https://fullnode.mainnet.sui.io' : 'https://fullnode.testnet.sui.io';
	const rpcUrl = process.env.SUI_RPC_URL ?? defaultRpc;
	const poolId = requiredEnv('POOL_ID');
	const lowerTick = Number(requiredEnv('LOWER_TICK'));
	const upperTick = Number(requiredEnv('UPPER_TICK'));
	const checkIntervalMs = parseNumberEnv('CHECK_INTERVAL_SECONDS', 60) * 1000;
	const zapAmountA = process.env.ZAP_AMOUNT_A ?? '0';
	const zapAmountB = process.env.ZAP_AMOUNT_B ?? '0';
	const slippageBps = parseNumberEnv('ZAP_SLIPPAGE_BPS', 50);

	return {
		rpcUrl,
		network,
		privateKey: requiredEnv('SUI_PRIVATE_KEY'),
		poolId,
		lowerTick,
		upperTick,
		checkIntervalMs,
		zapAmountA,
		zapAmountB,
		slippage: slippageBps / 10_000,
	};
}

function loadKeypair(secret: string): Keypair {
	const parsed = decodeSuiPrivateKey(secret);
	if (parsed.scheme === 'ED25519') {
		return Ed25519Keypair.fromSecretKey(parsed.secretKey);
	}
	if (parsed.scheme === 'Secp256k1') {
		return Secp256k1Keypair.fromSecretKey(parsed.secretKey);
	}
	if (parsed.scheme === 'Secp256r1') {
		return Secp256r1Keypair.fromSecretKey(parsed.secretKey);
	}
	throw new Error(`Unsupported key scheme ${parsed.scheme}`);
}

type BotContext = {
	config: Config;
	client: CetusClmmSDK['fullClient'];
	sdk: CetusClmmSDK;
	keypair: Keypair;
	address: string;
};

async function signAndExecute(
	client: CetusClmmSDK['fullClient'],
	keypair: Keypair,
	tx: Transaction,
	label: string,
): Promise<void> {
	try {
		console.log(`Executing ${label}...`);
		const result = await keypair.signAndExecuteTransaction({
			transaction: tx,
			client: client as unknown as ClientWithCoreApi,
		});
		const status =
			(result as any).effects?.status?.status ??
			(result as any).outcome?.status?.status ??
			(result as any).result?.effects?.status?.status ??
			'ok';
		console.log(`${label} success: ${status}`);
	} catch (error) {
		const message = (error as Error).message ?? String(error);
		if (message.includes(MOVE_ABORT_ZERO)) {
			console.error(`${label} failed with non-retryable MoveAbort(0): ${message}`);
			return;
		}
		console.error(`${label} failed: ${message}`);
	}
}

function hasLiquidity(position: Position): boolean {
	try {
		return BigInt(position.liquidity) > 0n;
	} catch {
		return false;
	}
}

async function removeOutOfRangePositions(context: BotContext, pool: Pool): Promise<void> {
	const positions = await context.sdk.Position.getPositionList(context.address, [context.config.poolId]);
	const active = positions.filter(hasLiquidity);

	for (const position of active) {
		if (!isOutOfRange(pool.current_tick_index, position.tick_lower_index, position.tick_upper_index)) {
			continue;
		}
		console.log(
			`Position ${position.pos_object_id} out of range; removing liquidity ${position.liquidity} and collecting fees...`,
		);
		const tx = await context.sdk.Position.removeLiquidityTransactionPayload({
			pool_id: context.config.poolId,
			pos_id: position.pos_object_id,
			coinTypeA: pool.coinTypeA,
			coinTypeB: pool.coinTypeB,
			delta_liquidity: position.liquidity,
			min_amount_a: '0',
			min_amount_b: '0',
			collect_fee: true,
			rewarder_coin_types: [],
		});
		await signAndExecute(context.client, context.keypair, tx, `remove-liquidity ${position.pos_object_id}`);
	}
}

function pickSide(context: BotContext, pool: Pool): Side | null {
	const hasAmountA = BigInt(context.config.zapAmountA) > 0n;
	const hasAmountB = BigInt(context.config.zapAmountB) > 0n;
	return selectSingleSidedToken(
		pool.current_tick_index,
		context.config.lowerTick,
		context.config.upperTick,
		hasAmountA,
		hasAmountB,
	);
}

async function addSingleSidedLiquidity(context: BotContext, pool: Pool): Promise<void> {
	const positions = await context.sdk.Position.getPositionList(context.address, [context.config.poolId]);
	const hasActiveInRange = positions.some(
		(position) =>
			hasLiquidity(position) &&
			!isOutOfRange(pool.current_tick_index, position.tick_lower_index, position.tick_upper_index),
	);
	if (hasActiveInRange) {
		console.log('Active in-range position already exists; skipping add-liquidity.');
		return;
	}

	const side = pickSide(context, pool);
	if (!side) {
		console.warn('No valid token side or amount configured for zap-in; aborting add-liquidity.');
		return;
	}

	const amount = side === 'A' ? context.config.zapAmountA : context.config.zapAmountB;
	const amountBN = new BN(amount);
	const predicted = ClmmPoolUtil.estLiquidityAndcoinAmountFromOneAmounts(
		context.config.lowerTick,
		context.config.upperTick,
		amountBN,
		side === 'A',
		true,
		context.config.slippage,
		new BN(pool.current_sqrt_price),
	);
	if (predicted.liquidityAmount.lte(new BN(0))) {
		console.warn('Predicted liquidity is zero; aborting add-liquidity.');
		return;
	}

	console.log(
		`Zap-in on side ${side} with amount ${amount}; estimated liquidity ${predicted.liquidityAmount.toString()}`,
	);

	const tx = await context.sdk.Position.createAddLiquidityFixTokenPayload({
		pool_id: context.config.poolId,
		pos_id: '',
		coinTypeA: pool.coinTypeA,
		coinTypeB: pool.coinTypeB,
		tick_lower: context.config.lowerTick,
		tick_upper: context.config.upperTick,
		amount_a: side === 'A' ? amount : '0',
		amount_b: side === 'B' ? amount : '0',
		fix_amount_a: side === 'A',
		slippage: context.config.slippage,
		is_open: true,
		collect_fee: false,
		rewarder_coin_types: [],
	});

	await signAndExecute(context.client, context.keypair, tx, `zap-add-liquidity-${side}`);
}

async function runLoop(context: BotContext): Promise<void> {
	while (true) {
		console.log(`\n[${new Date().toISOString()}] Checking pool ${context.config.poolId}`);
		try {
			const pool = await context.sdk.Pool.getPool(context.config.poolId);
			console.log(
				`Pool tick ${pool.current_tick_index}, target range [${context.config.lowerTick}, ${context.config.upperTick}]`,
			);
			await removeOutOfRangePositions(context, pool);
			await addSingleSidedLiquidity(context, pool);
		} catch (error) {
			const message = (error as Error).message ?? String(error);
			if (message.includes(MOVE_ABORT_ZERO)) {
				console.error(`Encountered non-retryable MoveAbort(0); ${message}`);
			} else {
				console.error(`Iteration failed: ${message}`);
			}
		}
		await new Promise((resolve) => setTimeout(resolve, context.config.checkIntervalMs));
	}
}

async function main(): Promise<void> {
	const config = loadConfig();
	const keypair = loadKeypair(config.privateKey);
	const address = keypair.getPublicKey().toSuiAddress();
	const sdk = initCetusSDK({ network: config.network, fullNodeUrl: config.rpcUrl, wallet: address });
	sdk.senderAddress = address;

	console.log('Starting Cetus rebalance bot with address', address);
	await runLoop({ config, client: sdk.fullClient, sdk, keypair, address });
}

if (require.main === module) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
