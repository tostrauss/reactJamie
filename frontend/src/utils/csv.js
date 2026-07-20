/**
 * CSV export helpers shared across the admin dashboard.
 *
 * csvCell neutralizes CSV/formula injection: a cell whose value starts with
 * = + - @ (or tab/CR) is evaluated as a formula by Excel/Google Sheets EVEN
 * when quoted, so a user who sets their name/location to `=HYPERLINK(...)`
 * could run code in an admin's spreadsheet. Prefix those with a single quote
 * so the value renders as literal text. JSON.stringify handles comma/quote/
 * newline escaping for valid CSV.
 */
export const csvCell = (val) => {
  let s = val === null || val === undefined ? '' : String(val);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return JSON.stringify(s);
};

export const downloadCSV = (data, filename) => {
  if (!data?.length) return;
  const headers = Object.keys(data[0]);
  const rows = data.map(row => headers.map(h => csvCell(row[h])).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
