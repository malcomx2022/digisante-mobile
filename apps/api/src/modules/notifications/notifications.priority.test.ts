import { describe, expect, it } from 'vitest';

import { priorityOf, sortByPriority } from './notifications.priority.js';

describe('priorité des notifications', () => {
  it('SOS est la plus prioritaire', () => {
    expect(priorityOf('SOS_ALERT')).toBeGreaterThan(priorityOf('LAB_RESULT'));
    expect(priorityOf('LAB_RESULT')).toBeGreaterThan(priorityOf('APPOINTMENT_REMINDER'));
  });

  it('trie SOS et critiques en tête', () => {
    const items = [
      { type: 'APPOINTMENT_REMINDER' as const, id: 1 },
      { type: 'SOS_ALERT' as const, id: 2 },
      { type: 'LAB_RESULT' as const, id: 3 },
    ];
    expect(sortByPriority(items).map((i) => i.id)).toEqual([2, 3, 1]);
  });
});
