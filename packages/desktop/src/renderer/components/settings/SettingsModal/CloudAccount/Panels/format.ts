import type { CloudQuota } from '@/common/types/platform/cloudAccount';

/** Preserve the server's exact USD equivalent without converting account units locally. */
export function formatAccountAmount(value?: CloudQuota | null): string | undefined {
  const money = value?.display_amount;
  return money ? `${money.amount} ${money.currency}` : undefined;
}

/** Format a server Unix timestamp in the account viewer's locale and local time zone. */
export function formatAccountTime(seconds: number, locale?: string): string | undefined {
  if (!seconds) return undefined;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}
