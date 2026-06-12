import { describe, expect, it } from 'vitest';

import { nextMode } from './consultations.rules.js';

describe('nextMode', () => {
  it('dégrade VIDEO → AUDIO → CHAT', () => {
    expect(nextMode('VIDEO')).toBe('AUDIO');
    expect(nextMode('AUDIO')).toBe('CHAT');
  });

  it('reste à CHAT (palier le plus bas)', () => {
    expect(nextMode('CHAT')).toBe('CHAT');
  });
});
