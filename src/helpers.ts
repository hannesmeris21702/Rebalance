export type Side = 'A' | 'B';

export function isOutOfRange(current: number, lower: number, upper: number): boolean {
	return current < lower || current > upper;
}

export function selectSingleSidedToken(
	current: number,
	lower: number,
	upper: number,
	hasAmountA: boolean,
	hasAmountB: boolean,
): Side | null {
	if (current <= lower && hasAmountA) {
		return 'A';
	}
	if (current >= upper && hasAmountB) {
		return 'B';
	}
	if (hasAmountA) {
		return 'A';
	}
	if (hasAmountB) {
		return 'B';
	}
	return null;
}
