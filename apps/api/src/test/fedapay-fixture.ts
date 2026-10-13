// Fixture de test : corps de webhook FedaPay à la forme OFFICIELLE d'une livraison
// (B2, revue indépendante du 13/10/2026) — la transaction est dans `entity`, le
// type d'événement dans `name` (docs.fedapay.com « webhooks », intégrations
// officielles PMPro/Odoo). `object: 'event'` et `klass` ne sont attestés que par
// une capture tierce : ils ne sont pas lus par le code.
//
// Un `id` d'ÉVÉNEMENT racine NUMÉRIQUE, distinct de celui de la transaction, est
// posé par défaut : chaque test webhook exerce ainsi le cas qui faisait échouer
// l'ancienne extraction (`event.id` pris pour la transaction, ou Prisma levant
// sur un entier). Signer TOUJOURS avec `buildWebhookSignatureHeader`.

const EVENT_NAMES: Record<string, string> = {
  approved: 'transaction.approved',
  declined: 'transaction.declined',
  canceled: 'transaction.canceled',
  transferred: 'transaction.transferred',
};

let nextEventId = 880_000_001;

export function fedapayWebhookBody(
  transactionId: string | number,
  status: string,
  opts: { eventId?: string | number; name?: string } = {},
): string {
  return JSON.stringify({
    id: opts.eventId ?? nextEventId++,
    name: opts.name ?? EVENT_NAMES[status] ?? 'transaction.updated',
    object: 'event',
    entity: { klass: 'v1/transaction', id: transactionId, status },
  });
}
