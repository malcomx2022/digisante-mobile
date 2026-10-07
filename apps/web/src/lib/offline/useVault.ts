'use client';
import { useEffect, useState } from 'react';

import { isVaultOpen, subscribeVault } from './vault';
export function useVault() {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeVault(() => setTick((n) => n + 1)), []);
  return { open: isVaultOpen(), tick };
}
