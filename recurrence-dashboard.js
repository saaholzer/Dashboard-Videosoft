import { createChartFilters } from './chart-filters.js';
import {
  RECURRENCE_DATA_URL, MONTH_NAMES, parseRecurrenceRows, parseReferenceDate, todayInSaoPaulo,
  validTerm, projectedValues, monthEnd, activeInMonth, sumCents, groupRecurrence, contractBillingPeriods, matchesBillingPeriod, nextMonthForSelection, growthRate, endingContractsByMonth, matchesDateRange
} from './recurrence-data.js';
import './recurrence-dashboard.css';

const root = document.querySelector('#panel-recurrence');
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const integer = new Intl.NumberFormat('pt-BR');
const growthPercent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2, signDisplay: 'exceptZero' });
const formatMoney = cents => money.format(cents / 100);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
const formatDate = date => date ? `${String(date.day).padStart(2, '0')}/${String(date.month + 1).padStart(2, '0')}/${date.year}` : '—';
const byId = id => root.querySelector(`#${id}`);
const chartFilters = createChartFilters('#panel-recurrence', () => { page = 0; render(); });
const filterIds = ['recurrenceYear', 'recurrenceMonth', 'recurrenceDescription', 'recurrenceType', 'recurrenceBillingPeriod'];
let records = [];
let sourceInfo = { ignoredRows: 0, invalidAmounts: 0 };
let loaded = false;
let page = 0;
let pendingRefresh;
let rangeStart = null;
let rangeEnd = null;
let reference = parseReferenceDate(todayInSaoPaulo());

function setOptions(id, values, allLabel, labelOf = value => value) {
  const select = byId(id);
  const previous = select.value;
  select.innerHTML = `<option value="all">${allLabel}</option>${values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(labelOf(value))}</option>`).join('')}`;
  if (values.includes(previous)) select.value = previous;
}

function populateFilters() {
  const years = [...new Set(contractBillingPeriods(records).map(period => String(period.year)))];
  setOptions('recurrenceYear', years, 'Todos os anos');
  setOptions('recurrenceMonth', MONTH_NAMES.map((_, index) => String(index)), 'Todos os meses', value => MONTH_NAMES[Number(value)]);
  setOptions('recurrenceDescription', [...new Set(records.map(row => row.description))].sort((a, b) => a.localeCompare(b, 'pt-BR')), 'Todas as descrições');
  setOptions('recurrenceType', [...new Set(records.map(row => row.billingType))].sort((a, b) => a.localeCompare(b, 'pt-BR')), 'Todos os tipos');
}

function selectedRows() {
  const [, , description, type] = filterIds.map(id => byId(id).value);
  return chartFilters.filter(records).filter(row =>
    (description === 'all' || row.description === description) &&
    (type === 'all' || row.billingType === type)
  );
}

function chartPanel(title, subtitle, items, scope, { chronological = false, compact = false, domain = '', totalLabel = '', format = 'money', total = sumCents(items, item => item.value) } = {}) {
  const displayValue = value => format === 'count' ? `${integer.format(value)} ${value === 1 ? 'contrato' : 'contratos'}` : formatMoney(value);
  const sorted = loaded ? [...items] : [];
  if (!chronological) sorted.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'pt-BR'));
  const maximum = Math.max(...sorted.map(item => Math.abs(item.value)), 1);
  const content = sorted.length ? `<div class="wow-chart-list recurrence-bar-list${compact ? ' recurrence-compact-list' : ''}">${sorted.map(item => {
    const width = Math.max(0, Math.abs(item.value) / maximum * 100);
    const growth = item.growth;
    const growthText = !growth ? '' : growth.rate === null ? 'Sem base de comparação' : `${growthPercent.format(growth.rate)}% vs ${growth.previousLabel}`;
    const growthTone = !growth || growth.rate === null || growth.rate === 0 ? 'neutral' : growth.rate > 0 ? 'up' : 'down';
    const growthTitle = !growth ? '' : `${growth.previousLabel}: ${growth.previousValue == null ? 'sem dados' : formatMoney(growth.previousValue)}. ${growth.rate === null ? 'Variação percentual indisponível quando não há base anterior ou ela é zero.' : 'Variação = (valor atual − anterior) ÷ valor anterior × 100.'}`;
    const metadata = item.count == null && !growth && !item.note ? '' : `<div class="recurrence-row-meta">${item.count == null ? '' : `<span class="wow-chart-note">${integer.format(item.count)} itens</span>`}${item.note ? `<span class="wow-chart-note">${escapeHtml(item.note)}</span>` : ''}${growth ? `<span class="recurrence-growth ${growthTone}" title="${escapeHtml(growthTitle)}">${escapeHtml(growthText)}</span>` : ''}</div>`;
    return `<div class="wow-chart-row" ${chartFilters.attrs(scope, item.name, item.test, domain)} title="${escapeHtml(`${item.name}: ${displayValue(item.value)}`)}"><div class="wow-chart-row-head"><span class="wow-chart-name">${escapeHtml(item.name)}</span><span class="wow-chart-value">${displayValue(item.value)}</span></div><div class="wow-chart-track"><div class="wow-chart-fill" style="width:${width.toFixed(2)}%"></div></div>${metadata}</div>`;
  }).join('')}</div>` : `<p class="recurrence-empty">${loaded ? 'Sem dados para os filtros selecionados.' : 'Carregando dados da planilha…'}</p>`;
  return `<article class="panel"><div class="panel-head"><div><h2 class="panel-title">${escapeHtml(title)}</h2><p class="panel-subtitle">${escapeHtml(subtitle)}</p></div></div><p class="recurrence-chart-total">${totalLabel ? `<span>${escapeHtml(totalLabel)}</span>` : ''}${loaded ? displayValue(total) : '—'}</p>${content}</article>`;
}

function kpi(label, cents, foot) {
  return `<article class="kpi"><p class="kpi-label"><span class="kpi-dot"></span>${escapeHtml(label)}</p><p class="kpi-value">${loaded ? formatMoney(cents) : '—'}</p><p class="kpi-foot">${escapeHtml(foot)}</p></article>`;
}

function renderDetails(rows) {
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  page = Math.max(0, Math.min(page, pages - 1));
  const sorted = [...rows].sort((a, b) => (a.forecast?.timestamp ?? Infinity) - (b.forecast?.timestamp ?? Infinity) || a.client.localeCompare(b.client, 'pt-BR'));
  byId('recurrenceTableCount').textContent = `${integer.format(rows.length)} itens no recorte · 50 por página`;
  byId('recurrenceTable').innerHTML = `<table><thead><tr><th>Contrato</th><th>Fatura</th><th>Cliente</th><th>Descrição do contrato</th><th>Descrição do faturamento</th><th>Tipo</th><th>Valor mensal bruto</th><th>Previsão faturamento</th><th>Início da vigência</th><th>Fim da vigência</th><th>Meses de vigência</th><th>Valor total da vigência</th><th>Meses restantes</th><th>Saldo projetado</th></tr></thead><tbody>${sorted.slice(page * 50, (page + 1) * 50).map(row => {
    const projection = projectedValues(row, reference);
    const valid = validTerm(row);
    return `<tr><td>${escapeHtml(row.contract || 'Sem código')}</td><td>${escapeHtml(row.invoice || '—')}</td><td>${escapeHtml(row.client)}</td><td>${escapeHtml(row.contractName)}</td><td>${escapeHtml(row.description)}</td><td>${escapeHtml(row.billingType)}</td><td>${formatMoney(row.amountCents)}</td><td>${formatDate(row.forecast)}</td><td>${formatDate(row.start)}</td><td>${formatDate(row.end)}</td><td>${valid ? integer.format(projection.months) : 'Vigência inválida'}</td><td>${valid ? formatMoney(projection.lifetimeCents) : '—'}</td><td>${valid ? integer.format(projection.remainingMonths) : '—'}</td><td>${valid ? formatMoney(projection.remainingCents) : '—'}</td></tr>`;
  }).join('') || '<tr><td colspan="14">Sem itens para os filtros selecionados.</td></tr>'}</tbody></table>`;
  byId('recurrencePage').textContent = `Página ${page + 1} de ${pages}`;
  byId('recurrencePrevious').disabled = page === 0;
  byId('recurrenceNext').disabled = page >= pages - 1;
}

function render() {
  reference = parseReferenceDate(todayInSaoPaulo());
  chartFilters.begin();
  const baseRows = selectedRows();
  const allPeriods = contractBillingPeriods(baseRows);
  const selectedYear = byId('recurrenceYear').value;
  const selectedMonth = byId('recurrenceMonth').value;
  const billingPeriod = byId('recurrenceBillingPeriod').value;
  const billingPeriodLabel = byId('recurrenceBillingPeriod').selectedOptions[0].textContent;
  const chartMonth = chartFilters.selection('Mês a faturar');
  const chartYear = chartFilters.selection('Ano de faturamento');
  const periodFilterActive = rangeStart !== null || billingPeriod !== 'all' || selectedYear !== 'all' || selectedMonth !== 'all' || chartMonth !== null || chartYear !== null;
  const selectedPeriods = allPeriods.filter(period =>
    matchesDateRange(period, rangeStart, rangeEnd) &&
    matchesBillingPeriod(period, reference, billingPeriod) &&
    (selectedYear === 'all' || String(period.year) === selectedYear) &&
    (selectedMonth === 'all' || String(period.month) === selectedMonth) &&
    (chartMonth === null || period.name === chartMonth) &&
    (chartYear === null || String(period.year) === chartYear));
  const periodRows = new Set(selectedPeriods.flatMap(period => period.rows));
  const rows = periodFilterActive ? baseRows.filter(row => periodRows.has(row)) : baseRows;
  const referenceMonth = reference.year * 12 + reference.month;
  const futurePeriods = selectedPeriods.filter(period => period.year * 12 + period.month >= referenceMonth);
  const monthlyBaseTotal = sumCents(rows);
  const registeredMonthlyTotal = sumCents(baseRows);
  const projections = new Map(rows.map(row => [row, projectedValues(row, reference)]));
  const closingDate = monthEnd(reference.year, reference.month);
  const followingMonth = nextMonthForSelection(reference, {
    year: selectedYear !== 'all' ? selectedYear : chartYear ?? 'all',
    month: selectedMonth,
    period: allPeriods.find(period => period.name === chartMonth) ?? (selectedMonth === 'all' ? rangeEnd : null)
  });
  // Include undated invoices, but only when the contract covers the target month.
  const followingMonthTotal = sumCents(baseRows.filter(row => activeInMonth(row, followingMonth)));
  const validRows = rows.filter(validTerm);
  const remaining = sumCents(rows, row => projections.get(row).remainingCents);
  const lifetime = sumCents(rows, row => projections.get(row).lifetimeCents);
  const closing = sumCents(rows.filter(row => activeInMonth(row, closingDate)));
  const codedContracts = new Set(rows.map(row => row.contract).filter(Boolean)).size;
  byId('recurrencePeriodNote').textContent = loaded
    ? `${integer.format(rows.length)} itens · ${integer.format(codedContracts)} contratos com código · ${billingPeriodLabel} · Valor mensal cadastrado: ${formatMoney(registeredMonthlyTotal)}`
    : 'Aguardando leitura da planilha.';
  byId('recurrenceKpis').innerHTML = [
    kpi('Recorrência mês atual', monthlyBaseTotal, 'Soma mensal do Valor Bruto da base filtrada, inclusive sem data de faturamento'),
    kpi('Saldo contratual projetado', remaining, `De ${MONTH_NAMES[reference.month]}/${reference.year} até o fim da vigência · meses integrais`),
    kpi('Valor total da Recorrência', lifetime, 'Valor mensal × meses entre início e fim da vigência'),
    kpi('Recorrência do mês seguinte', followingMonthTotal, `Mensalidades vigentes em ${MONTH_NAMES[followingMonth.month]}/${followingMonth.year}, inclusive sem data de faturamento`)
  ].join('');

  const periodByKey = new Map(allPeriods.map(period => [period.key, period]));
  const monthly = selectedPeriods.map(period => {
    const previousIndex = period.year * 12 + period.month - 1;
    const previousYear = Math.floor(previousIndex / 12);
    const previousMonth = previousIndex % 12;
    const previous = periodByKey.get(`${previousYear}-${String(previousMonth + 1).padStart(2, '0')}`);
    return { ...period, test: () => true, growth: {
      rate: growthRate(period.value, previous?.value),
      previousValue: previous?.value,
      previousLabel: `${MONTH_NAMES[previousMonth]}/${previousYear}`
    } };
  });
  const annual = groupRecurrence(selectedPeriods, period => period.year, period => period.value)
    .map(group => {
      const months = new Set(selectedPeriods.filter(period => String(period.year) === group.key).map(period => period.month));
      const previousYear = Number(group.key) - 1;
      const previousPeriods = allPeriods.filter(period => period.year === previousYear && months.has(period.month));
      const previousValue = previousPeriods.length ? sumCents(previousPeriods, period => period.value) : undefined;
      return { ...group, count: undefined, test: () => true, growth: {
        rate: growthRate(group.value, previousValue), previousValue, previousLabel: String(previousYear)
      } };
    });
  const periodValues = new Map();
  for (const period of selectedPeriods) {
    for (const row of period.rows) periodValues.set(row, (periodValues.get(row) ?? 0) + row.amountCents);
  }
  const selectedPeriodValue = row => periodValues.get(row) ?? 0;
  const endings = endingContractsByMonth(baseRows, selectedPeriods).map(group => ({
    ...group, note: `${formatMoney(group.monthlyCents)}/mês de recorrência`
  }));
  byId('recurrenceCharts').innerHTML = [
    chartPanel('Recorrência por mês e ano', `${billingPeriodLabel}: mensalidades entre o início (Z) e o fim (AA). Crescimento em relação ao mês anterior.`, monthly, 'Mês a faturar', { chronological: true, domain: 'period' }),
    chartPanel('Valor por ano', 'Mensalidades de cada ano pela vigência (Z e AA). Crescimento vs ano anterior, comparando os mesmos meses selecionados.', annual, 'Ano de faturamento', { chronological: true, domain: 'period' }),
    chartPanel('Valor por descrição do faturamento', 'Soma das mensalidades por descrição no período selecionado. Todos os períodos: vigência completa.', groupRecurrence(validRows, row => row.description, selectedPeriodValue), 'Descrição do faturamento'),
    `<div class="recurrence-type-column">${chartPanel('Valor por tipo de contrato', 'Soma das mensalidades por tipo no período selecionado. Todos os períodos: vigência completa.', groupRecurrence(validRows, row => row.billingType, selectedPeriodValue), 'Tipo de contrato')}
      <div class="recurrence-ending-chart">${chartPanel('Encerramentos de contratos por mês', 'Contratos por mês de término (AA) e seu valor mensal bruto correspondente. Códigos únicos; itens sem código não são contados.', endings, 'Mês de encerramento', { chronological: true, format: 'count', totalLabel: `Recorrência mensal correspondente: ${formatMoney(sumCents(endings, group => group.monthlyCents))}/mês` })}</div></div>`
  ].join('');

  const accumulatedByYear = groupRecurrence(selectedPeriods, period => period.year, period => period.value).map(group => ({
    ...group,
    count: new Set(selectedPeriods.filter(period => String(period.year) === group.key).flatMap(period => period.rows)).size,
    test: () => true
  }));
  const accumulatedTitle = billingPeriod === 'historical' ? 'Valor acumulado do faturamento histórico'
    : billingPeriod === 'current' ? 'Valor acumulado do faturamento vigente' : 'Valor acumulado da vigência completa';
  const accumulatedSubtitle = billingPeriod === 'historical'
    ? `Somente mensalidades anteriores a ${MONTH_NAMES[reference.month]}/${reference.year}, pelo ano do faturamento.`
    : billingPeriod === 'current'
      ? `Mensalidades desde ${MONTH_NAMES[reference.month]}/${reference.year}, pelo ano do faturamento.`
      : 'Soma das mensalidades nos períodos selecionados, agrupada pelo ano do faturamento.';
  const futureByYear = groupRecurrence(futurePeriods, period => period.year, period => period.value).map(group => {
    const periods = futurePeriods.filter(period => String(period.year) === group.key);
    const firstMonth = periods[0].month;
    const lastMonth = periods.at(-1).month;
    const monthLabel = periods.length === 1 ? MONTH_NAMES[firstMonth]
      : periods.length === lastMonth - firstMonth + 1 ? `${MONTH_NAMES[firstMonth]} a ${MONTH_NAMES[lastMonth]}`
        : periods.map(period => MONTH_NAMES[period.month]).join(', ');
    return {
      ...group,
      count: new Set(periods.flatMap(period => period.rows)).size,
      note: `${monthLabel}/${group.key}`,
      test: () => true
    };
  });
  const closingMonths = MONTH_NAMES.map((name, month) => {
    const date = monthEnd(reference.year, month);
    const active = rows.filter(row => activeInMonth(row, date));
    return { name: `${name}/${reference.year}`, value: sumCents(active), count: active.length, test: row => activeInMonth(row, date) };
  });
  byId('recurrenceContractCharts').innerHTML = [
    chartPanel('Recorrência prevista a receber por ano', `Quanto está previsto faturar em cada ano, desde ${MONTH_NAMES[reference.month]}/${reference.year}. Inclui apenas os meses futuros e o mês atual, conforme os filtros.`, futureByYear, 'Ano de faturamento', { chronological: true, compact: true, domain: 'period', totalLabel: 'Total de recorrência futura' }),
    chartPanel(accumulatedTitle, accumulatedSubtitle, accumulatedByYear, 'Ano de faturamento', { chronological: true, compact: true, domain: 'period' }),
    chartPanel('Vigentes em cada mês', `Mensalidade integral dos contratos que tenham vigência em qualquer dia de cada mês de ${reference.year}.`, closingMonths, 'Vigentes no fechamento', { chronological: true, compact: true, total: closing })
  ].join('');
  // The total above is the selected reference month's closing amount, not the sum of 12 snapshots.
  byId('recurrenceContractCharts').lastElementChild.querySelector('.recurrence-chart-total').insertAdjacentHTML('beforeend', `<span>Fechamento de ${MONTH_NAMES[reference.month]}/${reference.year}</span>`);

  const noDate = rows.filter(row => !row.forecast);
  const invalidTerms = rows.filter(row => !validTerm(row));
  const missingCodes = rows.filter(row => !row.contract).length;
  const messages = [
    noDate.length ? `${integer.format(noDate.length)} itens sem data de previsão mantidos na projeção pela vigência contratual.` : '',
    invalidTerms.length ? `${integer.format(invalidTerms.length)} itens com vigência inválida, incluídos nos valores da base e excluídos das projeções contratuais.` : '',
    missingCodes ? `${integer.format(missingCodes)} itens sem código de contrato mantidos pelos dados da fatura.` : '',
    sourceInfo.invalidAmounts ? `${integer.format(sourceInfo.invalidAmounts)} linhas com valor inválido não foram somadas.` : ''
  ].filter(Boolean);
  byId('recurrenceDataNote').hidden = !loaded || !messages.length;
  byId('recurrenceDataNote').textContent = messages.join(' ');
  renderDetails(rows);
  chartFilters.finish();
}

async function loadData() {
  const status = byId('recurrenceDataStatus');
  status.textContent = 'Carregando dados de recorrência…';
  status.classList.remove('negative');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(RECURRENCE_DATA_URL, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`A planilha respondeu com ${response.status}.`);
    if (!window.Papa) throw new Error('O leitor CSV não está disponível. Atualize a página e tente novamente.');
    const csv = window.Papa.parse(await response.text(), { header: true, skipEmptyLines: 'greedy' });
    if (csv.errors.length) throw new Error(`Não foi possível ler o CSV: ${csv.errors[0].message}`);
    const parsed = parseRecurrenceRows(csv.data);
    records = parsed.records;
    sourceInfo = parsed;
    loaded = true;
    populateFilters();
    render();
    status.textContent = `${integer.format(records.length)} itens atualizados às ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })} · ${parsed.ignoredRows} linha(s) de totalização/vazias excluída(s).`;
  } catch (error) {
    status.classList.add('negative');
    status.textContent = `Não foi possível atualizar a recorrência: ${error.name === 'AbortError' ? 'a leitura excedeu 30 segundos.' : error.message} ${loaded ? 'Exibindo a última leitura desta sessão.' : 'Verifique o acesso de leitura da planilha e clique em Atualizar dados.'}`;
  } finally {
    clearTimeout(timeout);
  }
}

function refreshRecurrenceDashboard() {
  if (!pendingRefresh) pendingRefresh = loadData().finally(() => { pendingRefresh = null; });
  return pendingRefresh;
}

for (const id of filterIds) byId(id).addEventListener('change', () => { page = 0; render(); });
const rangeDialog = byId('recurrenceRangeDialog');
const startInput = byId('recurrenceRangeStart');
const endInput = byId('recurrenceRangeEnd');
function updateRangeButton() {
  const label = rangeStart && rangeEnd ? `${formatDate(rangeStart)} a ${formatDate(rangeEnd)}` : 'Selecionar 2 datas';
  byId('recurrenceRangeButton').textContent = label;
  byId('recurrenceRangeButton').title = label;
}
function validateRange() {
  const start = parseReferenceDate(startInput.value);
  const end = parseReferenceDate(endInput.value);
  const reversed = start && end && start.timestamp > end.timestamp;
  endInput.setCustomValidity(reversed ? 'A data final deve ser igual ou posterior à inicial.' : '');
  byId('recurrenceRangeError').textContent = reversed ? 'A data final deve ser igual ou posterior à inicial.' : '';
  byId('recurrenceRangeApply').disabled = !start || !end || reversed;
  return start && end && !reversed;
}
byId('recurrenceRangeButton').addEventListener('click', () => {
  const iso = date => date ? `${date.year}-${String(date.month + 1).padStart(2, '0')}-${String(date.day).padStart(2, '0')}` : '';
  startInput.value = iso(rangeStart);
  endInput.value = iso(rangeEnd);
  validateRange();
  rangeDialog.showModal();
});
startInput.addEventListener('input', validateRange);
endInput.addEventListener('input', validateRange);
byId('recurrenceRangeForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!validateRange() || !event.target.reportValidity()) return;
  rangeStart = parseReferenceDate(startInput.value);
  rangeEnd = parseReferenceDate(endInput.value);
  updateRangeButton();
  rangeDialog.close();
  page = 0;
  render();
});
byId('recurrenceRangeCancel').addEventListener('click', () => rangeDialog.close());
byId('recurrenceRangeClear').addEventListener('click', () => {
  rangeStart = rangeEnd = null;
  updateRangeButton();
  rangeDialog.close();
  page = 0;
  render();
});
byId('recurrenceClearFilters').addEventListener('click', () => {
  chartFilters.clear();
  for (const id of filterIds) byId(id).value = 'all';
  rangeStart = rangeEnd = null;
  updateRangeButton();
  page = 0;
  render();
});
byId('recurrencePrevious').addEventListener('click', () => { page--; render(); });
byId('recurrenceNext').addEventListener('click', () => { page++; render(); });
window.refreshRecurrenceDashboard = refreshRecurrenceDashboard;
render();
refreshRecurrenceDashboard();
setInterval(() => {
  const currentDate = parseReferenceDate(todayInSaoPaulo());
  if (currentDate.year !== reference.year || currentDate.month !== reference.month) render();
}, 60000);
