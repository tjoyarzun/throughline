'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { NodePicker, type PickedNode } from './node-picker';

/** Two pickers and a submit. State lives in the URL so a path is shareable. */
export function ConnectForm({
  initialA,
  initialB,
}: {
  initialA: PickedNode | null;
  initialB: PickedNode | null;
}) {
  const router = useRouter();
  const [a, setA] = useState<PickedNode | null>(initialA);
  const [b, setB] = useState<PickedNode | null>(initialB);

  function go(nextA: PickedNode | null, nextB: PickedNode | null): void {
    if (!nextA || !nextB) return;
    router.push(`/universe/connect?a=${nextA.type}:${nextA.id}&b=${nextB.type}:${nextB.id}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <NodePicker
        label="From"
        value={a}
        onChange={(n) => {
          setA(n);
          go(n, b);
        }}
      />
      <NodePicker
        label="To"
        value={b}
        onChange={(n) => {
          setB(n);
          go(a, n);
        }}
      />
    </div>
  );
}
