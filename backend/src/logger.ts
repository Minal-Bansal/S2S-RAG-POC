type LogEvent =
  | { kind: "session_created"; sessionId: string }
  | { kind: "session_error"; message: string }
  | { kind: "tool_call"; question: string }
  | { kind: "tool_result"; question: string; sufficient: boolean; chunkCount: number; topScore: number | null }
  | { kind: "error"; message: string };

/**
 * Minimal structured logger for the POC. Swap for pino/winston later
 * without touching call sites.
 */
export function logEvent(event: LogEvent): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));
}
