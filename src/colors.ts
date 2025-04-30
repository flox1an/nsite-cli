import chalk from "chalk";

/**
 * Standardized color utilities for CLI output
 * This ensures consistent colors across all commands
 */
export const colors = {
  /** For file paths and names */
  filePath: (text: string) => chalk.yellow(text),

  /** For success messages and indicators */
  success: (text: string | number) => chalk.green(text),

  /** For error messages */
  error: (text: string | number) => chalk.red(text),

  /** For counts and numeric values */
  count: (value: number | string) => chalk.cyan(value),

  /** For headers and section titles */
  header: (text: string) => chalk.bold.white(text),

  /** For normal text that needs emphasis */
  emphasis: (text: string) => chalk.white(text),

  /** For commands and technical terms */
  command: (text: string) => chalk.magenta(text),

  /** For URLs and links */
  url: (text: string) => chalk.blue.underline(text),
};

/**
 * Formats a summary line with counts
 */
export function formatSummary(label: string, count: number, total?: number): string {
  if (total !== undefined) {
    return `${label}: ${colors.count(count)}/${colors.count(total)}`;
  }
  return `${label}: ${colors.count(count)}`;
}
