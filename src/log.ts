// stdout carries the MCP protocol, so all logging goes to stderr.
export function log(...args: unknown[]): void {
  console.error('[shopper]', ...args);
}
