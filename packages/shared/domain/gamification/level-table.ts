import type { LevelDefinitionRecord } from '../../ports/i-gamification-repository';

export class LevelTable {
  private readonly sorted: LevelDefinitionRecord[];

  constructor(definitions: LevelDefinitionRecord[]) {
    this.sorted = [...definitions].sort((a, b) => a.minXp - b.minXp);
  }

  forXp(totalXp: number): { definition: LevelDefinitionRecord; xpToNext: number | null } {
    if (this.sorted.length === 0) {
      throw new Error('LevelTable: no level definitions loaded');
    }

    let current = this.sorted[0];
    for (const def of this.sorted) {
      if (def.minXp <= totalXp) {
        current = def;
      } else {
        break;
      }
    }

    const idx = this.sorted.indexOf(current);
    const next = this.sorted[idx + 1] ?? null;
    return {
      definition: current,
      xpToNext: next ? next.minXp - totalXp : null,
    };
  }
}
