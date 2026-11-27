/** The message of anything thrown: an Error's message, or the thrown value as text. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
