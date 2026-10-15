export const number = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? 'Not available' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
export const integer = (value: number) => new Intl.NumberFormat('en-IN').format(value);
export const percent = (value: number) => number(value * 100, 1) + '%';
export const money = (value: number) => '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);
export function downloadJson(value: unknown, prefix = 'road-analysis') {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = prefix + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
