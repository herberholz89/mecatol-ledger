import type { Player } from '@mecatol/shared';

/** `2026-05-21` → "May 21, 2026" in the reader's locale. Parsed as a local date, not UTC. */
export function formatDate(iso: string | null): string {
  if (!iso) return 'No date';
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Player names for a dropdown, adding the roster owner where two rosters share a name. */
export function playerLabels(players: readonly Player[]): Map<number, string> {
  const counts = new Map<string, number>();
  for (const p of players) counts.set(p.name.toLowerCase(), (counts.get(p.name.toLowerCase()) ?? 0) + 1);
  return new Map(
    players.map((p) => [
      p.id,
      (counts.get(p.name.toLowerCase()) ?? 0) > 1 ? `${p.name} (${p.ownerName ?? 'unnamed'}'s roster)` : p.name,
    ]),
  );
}
