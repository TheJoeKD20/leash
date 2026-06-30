/**
 * Tiny zero-dependency ANSI colour helper. Honours `NO_COLOR` and non-TTY
 * output so piped/redirected traces stay clean.
 */
const ENABLED =
  !process.env.NO_COLOR &&
  process.env.TERM !== "dumb" &&
  (process.stdout.isTTY ?? false);

function wrap(open: number, close: number) {
  return (s: string): string => (ENABLED ? `[${open}m${s}[${close}m` : s);
}

export const colors = {
  enabled: ENABLED,
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

/** Force colours on/off regardless of environment (used by the CLI flag). */
export function makeColors(enabled: boolean): typeof colors {
  const w = (open: number, close: number) => (s: string) =>
    enabled ? `[${open}m${s}[${close}m` : s;
  return {
    enabled,
    bold: w(1, 22),
    dim: w(2, 22),
    red: w(31, 39),
    green: w(32, 39),
    yellow: w(33, 39),
    blue: w(34, 39),
    magenta: w(35, 39),
    cyan: w(36, 39),
    gray: w(90, 39),
  };
}
