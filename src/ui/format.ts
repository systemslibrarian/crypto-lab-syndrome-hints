// Formatting helpers shared across panels.

const SUPER: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};

/** Render an integer exponent as Unicode superscripts, e.g. 12 -> "¹²". */
export function sup(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUPER[d] ?? d)
    .join('');
}

/** A work factor in bits, shown as ~2^b operations with one decimal. */
export function bitsToWork(bits: number): string {
  return `2^${bits.toFixed(1)}`;
}

export function fmtBits(bits: number): string {
  return `${bits.toFixed(1)} bits`;
}

/** Render a 0/1 vector as a compact string like "0110". */
export function bitstring(v: Uint8Array): string {
  return Array.from(v, (b) => (b ? '1' : '0')).join('');
}
