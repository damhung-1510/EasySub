export function currencyDigits(currency: string): number {
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
  }).resolvedOptions().maximumFractionDigits;
}
export function toMinor(amount: number, currency: string): number {
  return Math.round(amount * 10 ** currencyDigits(currency));
}
export function toMajor(minor: number, currency: string): number {
  return minor / 10 ** currencyDigits(currency);
}
