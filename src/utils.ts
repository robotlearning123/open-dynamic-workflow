/** Rough token estimate: 1 token ≈ 4 characters. */
export const estTokens = (s: string): number => Math.ceil(s.length / 4);
