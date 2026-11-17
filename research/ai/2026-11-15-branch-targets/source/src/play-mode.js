// Control ownership is fixed at setup. It must not follow the viewing seat.
export function controlledSeats(mode, anchor, teams) {
  if (!Number.isInteger(anchor) || anchor < 0 || anchor >= teams.length) throw new Error('无效的玩家位置');
  if (mode === 'spectate') return [];
  if (mode === 'developer') return teams.map((_, id) => id);
  if (mode === 'team') return teams.flatMap((team, id) => team === teams[anchor] ? [id] : []);
  return [anchor];
}

export const revealsHiddenCards = mode => ['test', 'spectate', 'developer'].includes(mode);
