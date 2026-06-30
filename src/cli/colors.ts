/**
 * Tiny zero-dependency ANSI colour helper. Honours `NO_COLOR` and non-TTY
 * output so piped/redirected traces stay clean.
 */
export interface Palette {
  enabled: boolean;
  bold: (s: string) => string;
  dim: (s: string) => string;
  red: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  blue: (s: string) => string;
  magenta: (s: string) => string;
  cyan: (s: string) => string;
  gray: (s: string) => string;
}

const ESC = String.fromCharCode(27); // ANSI escape; avoids a literal control char in source

/** Build a palette whose colours are on or off as given. */
export function makeColors(enabled: boolean): Palette {
  const w =
    (open: number, close: number) =>
    (s: string): string =>
      enabled ? `${ESC}[${open}m${s}${ESC}[${close}m` : s;
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

/** Whether ANSI colour should be enabled for the current process by default. */
export const colorEnabled =
  !process.env.NO_COLOR &&
  process.env.TERM !== "dumb" &&
  (process.stdout.isTTY ?? false);

/** The default, environment-aware palette used by the CLI. */
export const colors: Palette = makeColors(colorEnabled);
