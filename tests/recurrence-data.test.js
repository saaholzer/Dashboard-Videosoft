import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDate, parseReferenceDate, parseSheetDate, parseRecurrenceData, contractMonths, projectedValues, activeInMonth, monthEnd, groupRecurrence, sumCents, contractBillingPeriods, matchesBillingPeriod, nextCalendarMonth, nextMonthForSelection, growthRate, endingContractsByMonth, matchesDateRange } from '../recurrence-data.js';

const date = value => parseReferenceDate(value);
const item = (start, end, amountCents = 10000) => ({ start: date(start), end: date(end), amountCents });

test('date range requires two ordered dates and includes complete boundary months', () => {
  const start = date('2026-10-28'), end = date('2027-01-02');
  assert(matchesDateRange({ year: 2026, month: 9 }, start, end));
  assert(matchesDateRange({ year: 2027, month: 0 }, start, end));
  assert(!matchesDateRange({ year: 2026, month: 8 }, start, end));
  assert(!matchesDateRange({ year: 2027, month: 1 }, start, end));
  assert(!matchesDateRange({ year: 2026, month: 9 }, start, null));
  assert(!matchesDateRange({ year: 2026, month: 9 }, end, start));
  assert(matchesDateRange({ year: 2026, month: 9 }, null, null));
});

test('count unique contract endings by final validity month within selected periods', () => {
  const rows = [
    { ...item('2026-01-01', '2026-10-15'), contract: 'A' },
    { ...item('2026-01-01', '2026-10-15'), contract: 'A' },
    { ...item('2026-01-01', '2026-11-30', 20000), contract: 'B' },
    { ...item('2026-01-01', '2026-10-01'), contract: '' },
    { ...item('2027-01-01', '2026-10-01'), contract: 'INVALID' }
  ];
  const groups = endingContractsByMonth(rows, [{ key: '2026-10' }, { key: '2026-11' }]);
  assert.deepEqual(groups.map(group => [group.key, group.value]), [['2026-10', 1], ['2026-11', 1]]);
  assert.deepEqual(groups.map(group => group.monthlyCents), [10000, 20000]);
  assert.equal(groups[0].test(rows[0]), true);
  assert.equal(groups[0].test(rows[3]), false);
  assert.equal(endingContractsByMonth(rows, [{ key: '2026-11' }]).length, 1);
});

test('growth reports rises, falls, stability and unavailable previous bases', () => {
  assert.equal(growthRate(12000, 10000), 20);
  assert.equal(growthRate(7500, 10000), -25);
  assert.equal(growthRate(10000, 10000), 0);
  assert.equal(growthRate(0, 10000), -100);
  assert.equal(growthRate(10000, 0), null);
  assert.equal(growthRate(10000, undefined), null);
});

test('next-month card follows selected month, year and chart period', () => {
  const reference = date('2026-10-28');
  assert.deepEqual(nextMonthForSelection(reference), date('2026-11-01'));
  assert.deepEqual(nextMonthForSelection(reference, { month: '10' }), date('2026-12-01'));
  assert.deepEqual(nextMonthForSelection(reference, { month: '11', year: '2027' }), date('2028-01-01'));
  assert.deepEqual(nextMonthForSelection(reference, { period: { year: 2029, month: 1 } }), date('2029-03-01'));
});

test('next-month indicator advances October to November and December to next January', () => {
  assert.deepEqual(nextCalendarMonth(date('2026-10-28')), date('2026-11-01'));
  assert.deepEqual(nextCalendarMonth(date('2026-11-01')), date('2026-12-01'));
  assert.deepEqual(nextCalendarMonth(date('2026-12-31')), date('2027-01-01'));
  assert(activeInMonth(item('2026-11-30', '2026-12-01'), nextCalendarMonth(date('2026-10-28'))));
});

test('historical ends last month and current includes this month regardless of day', () => {
  const reference = date('2026-10-28');
  assert(matchesBillingPeriod({ year: 2026, month: 8 }, reference, 'historical'));
  assert(!matchesBillingPeriod({ year: 2026, month: 9 }, reference, 'historical'));
  assert(matchesBillingPeriod({ year: 2026, month: 9 }, reference, 'current'));
  assert(matchesBillingPeriod({ year: 2027, month: 0 }, reference, 'current'));
  assert(!matchesBillingPeriod({ year: 2025, month: 11 }, reference, 'current'));
  assert(matchesBillingPeriod({ year: 2025, month: 11 }, reference, 'all'));
});

test('uses typed sheet dates instead of guessing ambiguous source formatting', () => {
  assert.equal(parseSheetDate('Date(2026,8,1)').month, 8);
  assert.equal(parseSheetDate('Date(2026,10,1)').month, 10);
  assert.equal(parseSheetDate('9/1/2026'), null);
  assert.equal(parseSheetDate('Date(2026,1,30)'), null);
  assert.equal(parseReferenceDate('2026-02-30'), null);
});

test('include one full fee in both the start month and termination month', () => {
  assert.equal(contractMonths(date('2025-09-12'), date('2028-09-12')), 37);
  assert.equal(contractMonths(date('2025-10-06'), date('2029-10-06')), 49);
  assert.equal(contractMonths(date('2026-01-01'), date('2026-12-31')), 12);
  assert.equal(contractMonths(date('2026-01-31'), date('2026-02-28')), 2);
  assert.equal(contractMonths(date('2026-10-01'), date('2026-10-01')), 1);
  assert.equal(contractMonths(date('2026-01-15'), date('2026-03-16')), 3);
});

test('remaining projection handles ended, future and invalid terms', () => {
  const reference = date('2026-10-28');
  assert.equal(projectedValues(item('2026-01-01', '2026-09-30'), reference).remainingCents, 0);
  const future = projectedValues(item('2027-01-01', '2027-12-31', 25000), reference);
  assert.equal(future.remainingMonths, 12);
  assert.equal(future.remainingCents, future.lifetimeCents);
  const ongoing = projectedValues(item('2026-01-01', '2026-12-31'), reference);
  assert.equal(ongoing.remainingMonths, 3);
  assert.equal(ongoing.remainingCents, 30000);
  assert.equal(projectedValues(item('2027-01-01', '2026-12-31'), reference).lifetimeCents, 0);
});

test('active months include a full fee for any start or end day', () => {
  assert.equal(monthEnd(2024, 1).day, 29);
  assert.equal(monthEnd(2026, 1).day, 28);
  const row = item('2026-10-31', '2026-11-30');
  assert(activeInMonth(row, monthEnd(2026, 9)));
  assert(activeInMonth(row, monthEnd(2026, 10)));
  assert(!activeInMonth(row, monthEnd(2026, 11)));
  assert(activeInMonth(item('2026-01-01', '2026-10-01'), date('2026-10-31')));
  assert(activeInMonth(item('2026-10-31', '2026-12-01'), date('2026-10-01')));
});

test('remaining balance is identical on every day of the same month', () => {
  const ending = item('2026-01-01', '2026-10-01', 15000);
  assert.equal(projectedValues(ending, date('2026-10-28')).remainingCents, 15000);
  const row = item('2026-01-15', '2026-12-03', 12500);
  for (const day of ['01', '15', '28', '31']) {
    assert.equal(projectedValues(row, date(`2026-10-${day}`)).remainingCents, 37500);
  }
});

test('sum cents exactly and keep unclassified billing types in totals', () => {
  const rows = [{ amountCents: 10, type: 'NOTA' }, { amountCents: 20, type: 'NOTA' }, { amountCents: 15, type: 'Não informado' }];
  assert.equal(sumCents(rows), 45);
  const grouped = groupRecurrence(rows, row => row.type);
  assert.equal(sumCents(grouped, group => group.value), 45);
  assert.equal(grouped[0].test(rows[1]), true);
  assert.equal(grouped[0].test(rows[2]), false);
});

test('forecast each month and reconcile annual and full-term category totals', () => {
  const rows = [item('2026-10-01', '2026-12-31'), item('2026-11-01', '2027-01-31', 20000)];
  const periods = contractBillingPeriods(rows);
  assert.deepEqual(periods.map(period => [period.key, period.value]), [
    ['2026-10', 10000], ['2026-11', 30000], ['2026-12', 30000], ['2027-01', 20000]
  ]);
  const annual = groupRecurrence(periods, period => period.year, period => period.value);
  assert.deepEqual(annual.map(group => [group.key, group.value]), [['2026', 70000], ['2027', 20000]]);
  const lifetime = sumCents(rows, row => projectedValues(row, date('2026-10-28')).lifetimeCents);
  assert.equal(sumCents(periods, period => period.value), lifetime);
});

test('calendar starts at the first contract, includes missing forecast dates and excludes invalid terms', () => {
  const periods = contractBillingPeriods([
    item('2023-02-01', '2023-04-01'), item('2026-10-15', '2026-12-15'), item('2027-01-01', '2026-01-01')
  ]);
  assert.equal(periods[0].key, '2023-02');
  assert.deepEqual(periods.map(period => period.key), ['2023-02', '2023-03', '2023-04', '2026-10', '2026-11', '2026-12']);
  assert.equal(sumCents(periods, period => period.value), 60000);
});

test('a contract ending on October 1 still contributes a full October fee', () => {
  const periods = contractBillingPeriods([item('2026-08-15', '2026-10-01', 12550)]);
  assert.deepEqual(periods.map(period => [period.key, period.value]), [
    ['2026-08', 12550], ['2026-09', 12550], ['2026-10', 12550]
  ]);
});

test('exclude spreadsheet totals, retain identified invoices without a contract code', () => {
  const labels = ['Número da Fatura ', 'Descrição do Faturamento ', 'Tipo Faturamento', 'Valor Bruto ', 'Data de Previsão Faturamento', 'Previsão do Início de Vigência', 'Previsão do Fim de Vigência', 'Contrato'];
  const result = { status: 'ok', table: { cols: labels.map(label => ({ label })), rows: [
    { c: ['A', 'LOC', 'RECIBO', 0.1, 'Date(2026,8,1)', 'Date(2026,0,1)', 'Date(2026,11,31)', 100].map(v => ({ v })) },
    { c: ['B', 'LOC', null, 0.2, null, 'Date(2026,0,1)', 'Date(2026,11,31)', null].map(v => ({ v })) },
    { c: [null, null, null, 0.3].map(v => ({ v })) }
  ] } };
  const parsed = parseRecurrenceData(`/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify(result)});`);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.ignoredRows, 1);
  assert.equal(sumCents(parsed.records), 30);
  assert.equal(parsed.records[1].contract, '');
  assert.equal(parsed.records[1].billingType, 'Não informado');
  assert.equal(parsed.records[0].forecast.month, 8);
});
