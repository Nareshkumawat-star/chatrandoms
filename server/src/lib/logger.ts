/* eslint-disable no-console */
const ts = () => new Date().toISOString();

export const logger = {
  info: (...args: unknown[]) => console.log(`[info ${ts()}]`, ...args),
  warn: (...args: unknown[]) => console.warn(`[warn ${ts()}]`, ...args),
  error: (...args: unknown[]) => console.error(`[error ${ts()}]`, ...args),
};
