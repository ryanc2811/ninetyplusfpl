/**
 * Reads a team ID out of whatever a manager pastes.
 *
 * A team ID is the only public handle the official API gives on a manager,
 * and it is buried in the URL of their Points page, so accepting the whole
 * URL saves them picking it out by hand.
 */
export function parseTeamId(input: string): number | null {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/\/entry\/(\d+)/);
  const candidate = fromUrl ? fromUrl[1] : trimmed.replace(/[^\d]/g, "");
  const id = Number(candidate);
  return Number.isInteger(id) && id > 0 ? id : null;
}
