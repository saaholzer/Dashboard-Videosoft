export const RECURRENCE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1fO7K5k5ak32kc1SDg6DAuoqAw3DmYUeD/edit?gid=868588654#gid=868588654';
export const RECURRENCE_DATA_URL = 'https://docs.google.com/spreadsheets/d/1fO7K5k5ak32kc1SDg6DAuoqAw3DmYUeD/gviz/tq?gid=868588654&tqx=out:json';
export const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function calendarDate(year, month, day) {
  const timestamp = Date.UTC(year, month, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day
    ? { year, month, day, timestamp } : null;
}

export function parseSheetDate(value) {
  // GViz returns unambiguous calendar components, even when source cells have mixed formats.
  const match = /^Date\((\d{4}),(\d{1,2}),(\d{1,2})(?:,\d+,\d+,\d+)?\)$/.exec(String(value ?? ''));
  return match ? calendarDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

export function parseReferenceDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  return match ? calendarDate(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

export function todayInSaoPaulo() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function parseRecurrenceData(text) {
  const prefix = 'google.visualization.Query.setResponse(';
  const start = text.indexOf(prefix);
  if (start < 0) throw new Error('A planilha não retornou uma tabela legível. Verifique o acesso de leitura.');
  const body = text.slice(start + prefix.length).trim();
  const result = JSON.parse(body.replace(/\);?\s*$/, ''));
  if (result.status !== 'ok' || !result.table?.cols || !result.table?.rows) {
    throw new Error(result.errors?.[0]?.detailed_message || 'Não foi possível ler os dados da recorrência.');
  }
  const columns = result.table.cols.map(column => column.label.trim());
  for (const name of ['Número da Fatura', 'Descrição do Faturamento', 'Tipo Faturamento', 'Valor Bruto',
    'Data de Previsão Faturamento', 'Previsão do Início de Vigência', 'Previsão do Fim de Vigência']) {
    if (!columns.includes(name)) throw new Error(`Coluna obrigatória não encontrada: ${name}.`);
  }
  const records = [];
  let ignoredRows = 0;
  let invalidAmounts = 0;
  for (const [index, source] of result.table.rows.entries()) {
    const cells = Object.fromEntries(columns.map((name, position) => [name, source.c[position]?.v ?? null]));
    const textOf = name => String(cells[name] ?? '').trim();
    const invoice = textOf('Número da Fatura');
    const contract = textOf('Contrato');
    const clientCode = textOf('Cliente');
    // A source total/subtotal is not a contract item. Records without a contract code remain valid.
    if (!invoice && !contract && !clientCode) { ignoredRows++; continue; }
    const amount = cells['Valor Bruto'];
    if (typeof amount !== 'number' || !Number.isFinite(amount)) { invalidAmounts++; continue; }
    records.push({
      sourceRow: index + 2,
      invoice, contract, clientCode,
      client: textOf('Cliente - Descricao') || 'Cliente não informado',
      contractName: textOf('Contrato - Descricao') || '—',
      description: textOf('Descrição do Faturamento') || 'Não informado',
      billingType: textOf('Tipo Faturamento') || 'Não informado',
      amountCents: Math.round(amount * 100),
      forecast: parseSheetDate(cells['Data de Previsão Faturamento']),
      start: parseSheetDate(cells['Previsão do Início de Vigência']),
      end: parseSheetDate(cells['Previsão do Fim de Vigência'])
    });
  }
  if (!records.length) throw new Error('A planilha não retornou itens com identificação e valor bruto válido.');
  return { records, ignoredRows, invalidAmounts };
}

export function validTerm(row) {
  return Boolean(row.start && row.end && row.end.timestamp >= row.start.timestamp);
}

export function contractMonths(start, end) {
  if (!start || !end || end.timestamp < start.timestamp) return 0;
  // Each calendar month touched by the term counts as one full monthly fee,
  // including both the start month and the termination month.
  const months = (end.year - start.year) * 12 + end.month - start.month;
  return months + 1;
}

export function projectedValues(row, reference) {
  if (!reference || !validTerm(row)) return { months: 0, remainingMonths: 0, lifetimeCents: 0, remainingCents: 0 };
  const months = contractMonths(row.start, row.end);
  const referenceMonthStart = calendarDate(reference.year, reference.month, 1);
  const remainingStart = row.start.timestamp > referenceMonthStart.timestamp ? row.start : referenceMonthStart;
  const remainingMonths = contractMonths(remainingStart, row.end);
  return { months, remainingMonths, lifetimeCents: months * row.amountCents, remainingCents: remainingMonths * row.amountCents };
}

export function monthEnd(year, month) {
  const date = new Date(Date.UTC(year, month + 1, 0));
  return calendarDate(year, month, date.getUTCDate());
}

export function nextCalendarMonth(date) {
  return calendarDate(date.year + Number(date.month === 11), (date.month + 1) % 12, 1);
}

export function nextMonthForSelection(reference, { year = 'all', month = 'all', period = null } = {}) {
  const selected = period ?? calendarDate(
    year === 'all' ? reference.year : Number(year),
    month === 'all' ? reference.month : Number(month), 1
  );
  return nextCalendarMonth(selected);
}

export function activeInMonth(row, date) {
  if (!validTerm(row)) return false;
  const month = date.year * 12 + date.month;
  return row.start.year * 12 + row.start.month <= month && row.end.year * 12 + row.end.month >= month;
}

export function sumCents(rows, valueOf = row => row.amountCents) {
  return rows.reduce((sum, row) => sum + valueOf(row), 0);
}

export function groupRecurrence(rows, keyOf, valueOf = row => row.amountCents) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(keyOf(row));
    const group = groups.get(key) ?? { key, name: key, value: 0, count: 0, test: candidate => String(keyOf(candidate)) === key };
    group.value += valueOf(row);
    group.count++;
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function forecastKey(row) {
  return row.forecast ? `${row.forecast.year}-${String(row.forecast.month + 1).padStart(2, '0')}` : 'sem-data';
}

// Allocate every monthly contract fee to its calendar month, from the first fee
// through the complete term. This is a contractual estimate, not a payment ledger.
export function contractBillingPeriods(rows) {
  const periods = new Map();
  for (const row of rows) {
    if (!validTerm(row)) continue;
    const months = contractMonths(row.start, row.end);
    for (let offset = 0; offset < months; offset++) {
      const absoluteMonth = row.start.year * 12 + row.start.month + offset;
      const year = Math.floor(absoluteMonth / 12);
      const month = absoluteMonth % 12;
      const key = `${year}-${String(month + 1).padStart(2, '0')}`;
      const period = periods.get(key) ?? { key, year, month, name: `${MONTH_NAMES[month]}/${year}`, value: 0, count: 0, rows: [] };
      period.value += row.amountCents;
      period.count++;
      period.rows.push(row);
      periods.set(key, period);
    }
  }
  return [...periods.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function matchesBillingPeriod(period, reference, mode = 'all') {
  if (mode === 'all') return true;
  const historical = period.year * 12 + period.month < reference.year * 12 + reference.month;
  return mode === 'historical' ? historical : !historical;
}

export function matchesDateRange(period, start, end) {
  if (!start && !end) return true;
  if (!start || !end || start.timestamp > end.timestamp) return false;
  const month = period.year * 12 + period.month;
  return month >= start.year * 12 + start.month && month <= end.year * 12 + end.month;
}

export function growthRate(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / Math.abs(previous) * 100;
}

export function endingContractsByMonth(rows, periods) {
  const periodKeys = new Set(periods.map(period => period.key));
  const contracts = new Map();
  for (const row of rows) {
    if (!row.contract || !validTerm(row)) continue;
    const previous = contracts.get(row.contract);
    if (!previous || row.end.timestamp > previous.end.timestamp) contracts.set(row.contract, row);
  }
  const endKey = row => row.end ? `${row.end.year}-${String(row.end.month + 1).padStart(2, '0')}` : '';
  const endingRows = [...contracts.values()].filter(row => periodKeys.has(endKey(row)));
  const monthlyValues = new Map(groupRecurrence(endingRows, endKey).map(group => [group.key, group.value]));
  return groupRecurrence(endingRows, endKey, () => 1)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(group => ({
      ...group, count: undefined,
      monthlyCents: monthlyValues.get(group.key) ?? 0,
      test: row => Boolean(row.contract) && validTerm(row) && endKey(contracts.get(row.contract) ?? row) === group.key,
      name: `${MONTH_NAMES[Number(group.key.slice(5)) - 1]}/${group.key.slice(0, 4)}`
    }));
}
