(() => {
  const sheetCsvUrl = "https://docs.google.com/spreadsheets/d/1M2VJ62UeSu4UHrqBj9PSUKx4FrcVELnfG5QUCSCAAiw/export?format=csv&gid=0";
  const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  const records = [];
  const chartFilters = new Map();
  const chartFilterControls = {
    year: "ifoodYearFilter",
    brand: "ifoodBrandFilter",
    model: "ifoodModelFilter",
    status: "ifoodStatusFilter",
    sla: "ifoodSlaFilter",
    shipmentStatus: "ifoodShipmentStatusFilter",
    shipmentCompletion: "ifoodShipmentCompletionFilter"
  };
  const normalize = value => String(value ?? "").trim();
  const normalizeCnpj = value => normalize(value).replace(/[.\/\s-]/g, "").toUpperCase();
  const normalizeKey = value => normalize(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);

  function columnValue(row, name) {
    const column = Object.keys(row).find(key => key.trim() === name);
    return column ? row[column] : "";
  }

  function parseDate(value) {
    const text = normalize(value);
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (match) {
      const [, day, month, year] = match.map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
        return { year, month: month - 1, timestamp: date.getTime() };
      }
      return null;
    }
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!iso) return null;
    const [, year, month, day] = iso.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? { year, month: month - 1, timestamp: date.getTime() }
      : null;
  }

  function parseQuantity(value) {
    const parsed = Number(normalize(value).replace(",", "."));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function formatDate(date) {
    if (!date) return "";
    const value = new Date(date.timestamp);
    return `${String(value.getUTCDate()).padStart(2, "0")}/${String(value.getUTCMonth() + 1).padStart(2, "0")}/${value.getUTCFullYear()}`;
  }

  function normalizeRow(row) {
    const entryDate = parseDate(row.Entrada);
    const plannedDepartureDate = parseDate(row["Data Prevista de Saída"]);
    const plannedDeliveryDate = parseDate(columnValue(row, "Prevista de Entrega"));
    const departureDate = parseDate(row["Data real da Previsão de saída"]);
    const deliveryDate = parseDate(row["Data Real de Entrega totem (executada)"]);
    const newDepartureDate = normalize(columnValue(row, "NOVA DATA DE ENVIO"));
    const serials = normalize(row["Num Série do Totem"]).split(/[,;\r\n]+/).map(serial => serial.trim()).filter(Boolean);
    const quantity = parseQuantity(row.Quantidade);
    return {
      cnpj: normalize(columnValue(row, "CNPJ")),
      tradeName: normalize(columnValue(row, "Nome Fantasia")),
      order: normalize(row.Pedido) || "Pedido não informado",
      entryDate,
      plannedDepartureDate,
      plannedDeliveryDate,
      newDepartureDate,
      departureDate,
      deliveryDate,
      quantity,
      transaction: normalize(row.Transação) || "Não informado",
      model: normalize(row["Modelo do totem"]) || "Não informado",
      status: normalize(row["Status do totem"]) || "Não informado",
      activationStatus: normalizeKey(columnValue(row, "Totem Ativo / Não Ativo")),
      brand: normalize(row.Marcas) || "Não informado",
      sla: normalize(row["Atendimento SLA Videosoft"]) || "Não informado",
      activationStatusLabel: normalize(columnValue(row, "Totem Ativo / Não Ativo")) || "Status não informado",
      recommissionedSerials: serials.filter(serial => /^R/i.test(serial))
    };
  }

  function productionShipmentStatus(row) {
    if (!row.plannedDepartureDate) return null;
    const planned = row.plannedDepartureDate.timestamp;
    if (row.departureDate) {
      if (row.departureDate.timestamp > planned) return "Atrasado";
      if (row.departureDate.timestamp < planned) return "Adiantando";
      return "No prazo";
    }
    const today = new Date();
    const todayTimestamp = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    return todayTimestamp > planned ? "Atrasado" : "No prazo";
  }

  function shipmentCompletionStatus(row) {
    return row.departureDate ? "Enviado" : "A Enviar";
  }

  function periodKey(date) {
    return date ? `${date.year}-${String(date.month).padStart(2, "0")}` : "";
  }

  function chartFilterLabel(type, value) {
    if (type === "entryPeriod" || type === "departurePeriod") {
      const [year, month] = value.split("-").map(Number);
      return `${monthNames[month]} ${year}`;
    }
    if (type === "activationStatus") {
      return ({
        ativo: "Totens ativos",
        inativo: "Totens inativos",
        cancelado: "Totens cancelados",
        recomissionado: "Totens recomissionados",
        "parcialmente inativo": "Totens parcialmente inativos",
        "nao informado": "Status não informado"
      })[value] ?? value;
    }
    return value;
  }

  function selectedChartFilter(type) {
    const controlId = chartFilterControls[type];
    return controlId
      ? document.querySelector(`#${controlId}`).value
      : chartFilters.get(type) ?? "all";
  }

  function applyChartFilter(type, value) {
    const controlId = chartFilterControls[type];
    if (controlId) {
      const control = document.querySelector(`#${controlId}`);
      if (![...control.options].some(option => option.value === value)) return;
      control.value = control.value === value ? "all" : value;
    } else if (chartFilters.get(type) === value) {
      chartFilters.delete(type);
    } else {
      chartFilters.set(type, value);
    }
    render();
  }

  function selectedRows(ignoreBrand = false) {
    const cnpj = normalizeCnpj(document.querySelector("#ifoodCnpjFilter").value);
    const year = document.querySelector("#ifoodYearFilter").value;
    const brand = document.querySelector("#ifoodBrandFilter").value;
    const transaction = document.querySelector("#ifoodTransactionFilter").value;
    const status = document.querySelector("#ifoodStatusFilter").value;
    const model = document.querySelector("#ifoodModelFilter").value;
    const sla = document.querySelector("#ifoodSlaFilter").value;
    const shipmentStatus = document.querySelector("#ifoodShipmentStatusFilter").value;
    const shipmentCompletion = document.querySelector("#ifoodShipmentCompletionFilter").value;
    return records.filter(row =>
      (year === "all" || String(row.entryDate?.year) === year) &&
      (ignoreBrand || brand === "all" || row.brand === brand) &&
      (!cnpj || normalizeCnpj(row.cnpj).includes(cnpj)) &&
      (transaction === "all" || normalizeKey(row.transaction) === transaction) &&
      (status === "all" || normalizeKey(row.status) === status) &&
      (model === "all" || row.model === model) &&
      (sla === "all" || normalizeKey(row.sla) === sla) &&
      (shipmentStatus === "all" || productionShipmentStatus(row) === shipmentStatus) &&
      (shipmentCompletion === "all" || shipmentCompletionStatus(row) === shipmentCompletion) &&
      [...chartFilters].every(([type, value]) => {
        if (type === "entryPeriod") return periodKey(row.entryDate) === value;
        if (type === "departurePeriod") return periodKey(row.departureDate) === value;
        if (type === "activationStatus") return (row.activationStatus || "nao informado") === value;
        return true;
      })
    );
  }

  function sumQuantity(rows) {
    return rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  function groupedQuantities(rows, keyOf) {
    const groups = new Map();
    for (const row of rows) {
      const name = keyOf(row);
      if (!name) continue;
      groups.set(name, (groups.get(name) ?? 0) + row.quantity);
    }
    return [...groups].map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "pt-BR"));
  }

  function operationalStatusQuantities(rows) {
    const labels = new Map([
      ["ativo", "Totens ativos"],
      ["inativo", "Totens inativos"],
      ["cancelado", "Totens cancelados"],
      ["recomissionado", "Totens recomissionados"],
      ["parcialmente inativo", "Totens parcialmente inativos"],
      ["nao informado", "Status não informado"]
    ]);
    const totals = new Map();
    for (const row of rows) {
      const key = row.activationStatus || "nao informado";
      const name = labels.get(key) ?? row.activationStatusLabel;
      const total = totals.get(key) ?? { name, value: 0, filterValue: key };
      total.value += row.quantity;
      totals.set(key, total);
    }
    return [...totals.values()];
  }

  function chartPanel(title, subtitle, items, { format = "count", scrollable = false, order = "value", emptyMessage = "Sem dados para os filtros selecionados.", filterType = "", filterValueOf = item => item.name } = {}) {
    if (!items.length) return `<article class="panel"><div class="panel-head"><div><h2 class="panel-title">${escapeHtml(title)}</h2><p class="panel-subtitle">${escapeHtml(subtitle)}</p></div></div><div class="wow-message">${escapeHtml(emptyMessage)}</div></article>`;
    const sorted = order === "value" ? [...items].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "pt-BR")) : items;
    const maximum = Math.max(...sorted.map(item => item.scaleValue ?? item.value), 1);
    const rows = sorted.map(item => {
      const raw = item.scaleValue ?? item.value;
      const width = Math.min(100, Math.max(1.5, raw / maximum * 100));
      const display = item.display ?? (format === "percent" ? `${decimal.format(item.value)}%` : format === "days" ? `${decimal.format(item.value)} dias` : integer.format(item.value));
      const note = item.note ? `<span class="wow-chart-note">${escapeHtml(item.note)}</span>` : "";
      const filterValue = filterType ? filterValueOf(item) : "";
      const selected = filterType && selectedChartFilter(filterType) === filterValue;
      const content = `<span class="wow-chart-row-head"><span class="wow-chart-name">${escapeHtml(item.name)}</span><span class="wow-chart-value">${escapeHtml(display)}</span></span><span class="wow-chart-track"><span class="wow-chart-fill" style="width:${width.toFixed(1)}%"></span></span>${note}`;
      return filterType
        ? `<button class="wow-chart-row ifood-chart-filter${selected ? " is-selected" : ""}" type="button" data-chart-filter="${escapeHtml(filterType)}" data-filter-value="${escapeHtml(filterValue)}" aria-pressed="${selected}" title="${escapeHtml(`${item.name}: ${display}`)}">${content}</button>`
        : `<div class="wow-chart-row" title="${escapeHtml(`${item.name}: ${display}`)}">${content}</div>`;
    }).join("");
    const listClass = `wow-chart-list${scrollable ? " ifood-trend-list" : ""}`;
    return `<article class="panel"><div class="panel-head"><div><h2 class="panel-title">${escapeHtml(title)}</h2><p class="panel-subtitle">${escapeHtml(subtitle)}</p></div></div><div class="${listClass}">${rows}</div></article>`;
  }

  function groupedByMonth(rows, valueOf, dateOf = row => row.entryDate) {
    const months = new Map();
    for (const row of rows) {
      const date = dateOf(row);
      if (!date) continue;
      const { year, month } = date;
      const key = `${year}-${String(month).padStart(2, "0")}`;
      if (!months.has(key)) months.set(key, { name: `${monthNames[month]} ${year}`, year, month, value: 0 });
      valueOf(months.get(key), row);
    }
    return [...months.values()].sort((a, b) => a.year - b.year || a.month - b.month);
  }

  function verticalBarChart(title, subtitle, items, { columnWidth = 44, labelOf = item => item.name, filterType = "", filterValueOf = item => item.name } = {}) {
    if (!items.length) {
      return `<article class="panel"><div class="panel-head"><div><h2 class="panel-title">${escapeHtml(title)}</h2><p class="panel-subtitle">${escapeHtml(subtitle)}</p></div></div><div class="wow-message">Sem dados para os filtros selecionados.</div></article>`;
    }
    const maximum = Math.max(...items.map(item => item.scaleValue ?? item.value), 1);
    const bars = items.map(item => {
      const height = Math.max(2, (item.scaleValue ?? item.value) / maximum * 100);
      const label = labelOf(item);
      const value = item.display ?? integer.format(item.value);
      const note = item.note ? ` · ${item.note}` : "";
      const filterValue = filterType ? filterValueOf(item) : "";
      const selected = filterType && selectedChartFilter(filterType) === filterValue;
      const content = `<span class="ifood-month-value">${escapeHtml(value)}</span><span class="ifood-month-track"><span class="ifood-month-bar" style="height:${height.toFixed(1)}%"></span></span><span class="ifood-month-label">${escapeHtml(label)}</span>`;
      return filterType
        ? `<button class="ifood-month-item ifood-chart-button${selected ? " is-selected" : ""}" type="button" data-chart-filter="${escapeHtml(filterType)}" data-filter-value="${escapeHtml(filterValue)}" aria-pressed="${selected}" aria-label="Filtrar por ${escapeHtml(label)}" title="${escapeHtml(`${item.name}: ${value}${note}`)}">${content}</button>`
        : `<div class="ifood-month-item" title="${escapeHtml(`${item.name}: ${value}${note}`)}">${content}</div>`;
    }).join("");
    const chartRole = filterType ? "group" : "img";
    return `<article class="panel"><div class="panel-head"><div><h2 class="panel-title">${escapeHtml(title)}</h2><p class="panel-subtitle">${escapeHtml(subtitle)}</p></div></div><div class="ifood-month-chart" style="grid-auto-columns:${columnWidth}px" role="${chartRole}" aria-label="${escapeHtml(title)}">${bars}</div></article>`;
  }

  function verticalMonthChart(title, subtitle, months, filterType = "entryPeriod") {
    return verticalBarChart(title, subtitle, months, {
      filterType,
      filterValueOf: month => periodKey(month),
      labelOf: month => Number.isInteger(month.month) && Number.isInteger(month.year)
        ? `${monthNames[month.month]}/${String(month.year).slice(-2)}`
        : month.name
    });
  }

  function monthQuantityChart(rows) {
    const months = groupedByMonth(rows, (month, row) => { month.value += row.quantity; });
    return verticalMonthChart("Totens por mês e ano", "Quantidade total de totens agrupada pelo mês de entrada e ano.", months);
  }

  function departureQuantityChart(rows) {
    const months = groupedByMonth(
      rows,
      (month, row) => { month.value += row.quantity; },
      row => row.departureDate
    );
    return verticalMonthChart(
      "Totens enviados por mês",
      "Quantidade agrupada pelo mês da Data real da Previsão de saída.",
      months,
      "departurePeriod"
    );
  }

  function productionShipmentStatusChart(rows) {
    const totals = new Map([
      ["Atrasado", 0],
      ["Adiantando", 0],
      ["No prazo", 0]
    ]);
    for (const row of rows) {
      const status = productionShipmentStatus(row);
      if (!status) continue;
      totals.set(status, totals.get(status) + row.quantity);
    }
    const classifiedQuantity = [...totals.values()].reduce((sum, quantity) => sum + quantity, 0);
    const items = [...totals].map(([name, value]) => ({
      name,
      value,
      display: `${integer.format(value)} · ${decimal.format(classifiedQuantity ? value / classifiedQuantity * 100 : 0)}%`
    }));
    return chartPanel(
      "Status de envio da produção",
      "Quantidade e participação no total classificado; comparação entre a previsão de saída e a data real. Sem data real, compara a previsão com hoje.",
      items,
      { order: "chronological", filterType: "shipmentStatus" }
    );
  }

  function annualQuantityChart(rows) {
    const annual = [...groupedQuantities(rows.filter(row => row.entryDate), row => String(row.entryDate.year))]
      .sort((a, b) => Number(a.name) - Number(b.name));
    return chartPanel("Totens por ano", "Soma da quantidade pelo ano de entrada.", annual, { order: "chronological", filterType: "year" });
  }

  function slaMonthlyChart(rows) {
    const months = groupedByMonth(rows, (month, row) => {
      const sla = normalizeKey(row.sla);
      if (sla === "dentro do prazo") month.onTime = (month.onTime ?? 0) + row.quantity;
      else if (sla === "atrasado" || sla === "fora do prazo") month.late = (month.late ?? 0) + row.quantity;
    }).filter(month => (month.onTime ?? 0) + (month.late ?? 0) > 0)
      .map(month => {
        const onTime = month.onTime ?? 0;
        const late = month.late ?? 0;
        const rated = onTime + late;
        const rate = rated ? onTime / rated * 100 : 0;
        return { ...month, value: rate, scaleValue: rate, display: `${decimal.format(rate)}%`, note: `${integer.format(onTime)} dentro do prazo · ${integer.format(late)} atrasados · ${integer.format(rated)} classificados` };
      });
    return verticalMonthChart(
      "Atendimento SLA por mês e ano",
      "SLA Videosoft por mês e ano de entrada; registros sem classificação ficam fora da taxa. Passe o cursor sobre as barras para ver os totais.",
      months,
      "entryPeriod"
    );
  }

  function deliveryLeadTimeChart(rows) {
    const months = groupedByMonth(rows, (month, row) => {
      if (!row.deliveryDate || !row.entryDate) return;
      const days = (row.deliveryDate.timestamp - row.entryDate.timestamp) / 86400000;
      if (days < 0) return;
      month.weightedDays = (month.weightedDays ?? 0) + days * row.quantity;
      month.units = (month.units ?? 0) + row.quantity;
    }).filter(month => month.units > 0)
      .map(month => {
        const average = month.weightedDays / month.units;
        return { ...month, value: average, scaleValue: average, display: `${decimal.format(average)} dias`, note: `${integer.format(month.units)} totens com as duas datas` };
      });
    return verticalMonthChart(
      "Prazo médio até a entrega real",
      "Média mensal entre a entrada do pedido e a data real de entrega executada, ponderada pela quantidade.",
      months
    );
  }

  function countKpi(label, value, note) {
    return `<article class="kpi wow-kpi"><p class="kpi-label"><span class="kpi-dot"></span>${escapeHtml(label)}</p><p class="kpi-value">${escapeHtml(value)}</p><p class="kpi-foot">${escapeHtml(note)}</p></article>`;
  }

  function recommissionedOrdersTable(rows) {
    const orders = rows.filter(row => row.recommissionedSerials.length);
    const subtitle = `${integer.format(orders.length)} pedidos com ${integer.format(orders.reduce((sum, row) => sum + row.recommissionedSerials.length, 0))} seriais recomissionados.`;
    if (!orders.length) {
      return `<article class="panel"><div class="panel-head"><div><h2 class="panel-title">Pedidos recomissionados</h2><p class="panel-subtitle">${escapeHtml(subtitle)}</p></div></div><div class="wow-message">Não há pedidos recomissionados para os filtros selecionados.</div></article>`;
    }
    const tableRows = orders.map(row =>
      `<tr><td>${escapeHtml(row.order)}</td><td>${escapeHtml(row.brand)}</td><td>${escapeHtml(row.recommissionedSerials.join(", "))}</td><td>${escapeHtml(row.status)}</td></tr>`
    ).join("");
    return `<article class="panel"><div class="panel-head"><div><h2 class="panel-title">Pedidos recomissionados</h2><p class="panel-subtitle">${escapeHtml(subtitle)}</p></div></div><div class="ifood-recommissioned-table-wrap"><table class="ifood-recommissioned-table"><thead><tr><th scope="col">Pedido</th><th scope="col">Marca</th><th scope="col">Seriais</th><th scope="col">Status</th></tr></thead><tbody>${tableRows}</tbody></table></div></article>`;
  }

  function orderLookupTable(rows) {
    const orders = rows.map(row => ({
      row,
      newDepartureDate: row.departureDate ? null : parseDate(row.newDepartureDate)
    })).sort((a, b) => {
      const first = a.newDepartureDate?.timestamp;
      const second = b.newDepartureDate?.timestamp;
      if (first == null) return second == null ? 0 : 1;
      if (second == null) return -1;
      return first - second;
    });
    const tableRows = orders.map(({ row, newDepartureDate }) => {
      const newDepartureLabel = row.departureDate ? "-" : formatDate(newDepartureDate) || row.newDepartureDate || "-";
      return `<tr><td>${escapeHtml(row.order)}</td><td>${escapeHtml(row.tradeName || "—")}</td><td>${escapeHtml(row.cnpj || "—")}</td><td>${escapeHtml(row.brand)}</td><td>${escapeHtml(row.model)}</td><td>${integer.format(row.quantity)}</td><td>${escapeHtml(formatDate(row.plannedDepartureDate) || "—")}</td><td>${escapeHtml(formatDate(row.plannedDeliveryDate) || "—")}</td><td>${escapeHtml(newDepartureLabel)}</td></tr>`;
    }).join("");
    const subtitle = `${integer.format(rows.length)} pedidos no recorte selecionado.`;
    return `<article class="panel"><div class="panel-head"><div><h2 class="panel-title">Consulta de pedidos</h2><p class="panel-subtitle">${escapeHtml(subtitle)}</p></div></div><div class="ifood-order-table-wrap"><table class="ifood-order-table"><thead><tr><th scope="col">Pedido</th><th scope="col">Nome fantasia</th><th scope="col">CNPJ</th><th scope="col">Marca</th><th scope="col">Modelo</th><th scope="col">Qtd.</th><th scope="col">Data prevista de saída</th><th scope="col">Data prevista de entrega</th><th scope="col">Nova data de envio</th></tr></thead><tbody>${tableRows}</tbody></table></div></article>`;
  }

  function orderTables(rows) {
    return `<div class="ifood-orders-grid">${recommissionedOrdersTable(rows)}${orderLookupTable(rows)}</div>`;
  }

  function render() {
    const rows = selectedRows();
    const serialCount = rows.reduce((sum, row) => sum + row.recommissionedSerials.length, 0);
    const slaRows = rows.filter(row => {
      const sla = normalizeKey(row.sla);
      return sla === "dentro do prazo" || sla === "atrasado" || sla === "fora do prazo";
    });
    const onTime = slaRows.filter(row => normalizeKey(row.sla) === "dentro do prazo").reduce((sum, row) => sum + row.quantity, 0);
    const slaTotal = sumQuantity(slaRows);
    const delivered = rows.filter(row => row.entryDate && row.deliveryDate && row.deliveryDate.timestamp >= row.entryDate.timestamp);
    const deliveredUnits = sumQuantity(delivered);
    const leadDays = delivered.reduce((sum, row) => sum + (row.deliveryDate.timestamp - row.entryDate.timestamp) / 86400000 * row.quantity, 0);
    const averageLead = deliveredUnits ? leadDays / deliveredUnits : 0;
    const year = document.querySelector("#ifoodYearFilter").value;
    const brand = document.querySelector("#ifoodBrandFilter").value;
    const yearLabel = year === "all" ? "todos os anos" : year;
    const brandLabel = brand === "all" ? "todas as marcas" : brand;
    const activeFilters = [
      ["Transação", "ifoodTransactionFilter"],
      ["Status", "ifoodStatusFilter"],
      ["Modelo", "ifoodModelFilter"],
      ["SLA", "ifoodSlaFilter"],
      ["Status do envio", "ifoodShipmentStatusFilter"],
      ["Envio", "ifoodShipmentCompletionFilter"]
    ].flatMap(([label, id]) => {
      const select = document.querySelector(`#${id}`);
      return select.value === "all" ? [] : [`${label}: ${select.selectedOptions[0].textContent}`];
    });
    const cnpjSearch = normalize(document.querySelector("#ifoodCnpjFilter").value);
    if (normalizeCnpj(cnpjSearch)) activeFilters.push(`CNPJ: ${cnpjSearch}`);
    for (const [type, value] of chartFilters) {
      const label = type === "entryPeriod" ? "Mês de entrada"
        : type === "departurePeriod" ? "Mês de envio"
          : "Situação do totem";
      activeFilters.push(`${label}: ${chartFilterLabel(type, value)}`);
    }

    document.querySelector("#ifoodPeriodNote").textContent =
      `${integer.format(rows.length)} registros · ${integer.format(sumQuantity(rows))} totens · ${yearLabel} · ${brandLabel}${activeFilters.length ? ` · ${activeFilters.join(" · ")}` : ""}`;
    document.querySelector("#ifoodKpis").innerHTML = [
      countKpi("Totens", integer.format(sumQuantity(rows)), "Soma da quantidade na planilha"),
      countKpi("Atendimento SLA", slaTotal ? `${decimal.format(onTime / slaTotal * 100)}%` : "—", `${integer.format(onTime)} dentro do prazo de ${integer.format(slaTotal)} classificados`),
      countKpi("Totens recomissionados", integer.format(serialCount), "Seriais iniciados com R"),
      countKpi("Prazo médio de entrega", deliveredUnits ? `${decimal.format(averageLead)} dias` : "—", `${integer.format(deliveredUnits)} totens com entrada e entrega real`)
    ].join("");

    const brandRows = selectedRows(true);
    const operationalStatus = operationalStatusQuantities(rows);
    const statusAndAnnualCharts = `<div class="ifood-status-chart-grid">${productionShipmentStatusChart(rows)}${annualQuantityChart(rows)}${chartPanel("Totens por status", "Soma da quantidade por status do totem.", groupedQuantities(rows, row => row.status), { filterType: "status", filterValueOf: item => normalizeKey(item.name) })}${chartPanel("Visão de totens por situação", "Soma da coluna Quantidade para cada situação da coluna AE: Totem Ativo / Não Ativo.", operationalStatus, { order: "chronological", filterType: "activationStatus", filterValueOf: item => item.filterValue })}</div>`;
    document.querySelector("#ifoodCharts").innerHTML = [
      monthQuantityChart(rows),
      departureQuantityChart(rows),
      statusAndAnnualCharts,
      chartPanel("Totens por modelo", "Soma da quantidade por modelo de totem.", groupedQuantities(rows, row => row.model), { scrollable: true, filterType: "model" }),
      slaMonthlyChart(rows),
      orderTables(rows),
      deliveryLeadTimeChart(rows),
      verticalBarChart(
        "Totens por marca",
        "Soma da quantidade por marca. Clique em uma barra para filtrar os demais gráficos.",
        groupedQuantities(brandRows, row => row.brand),
        { columnWidth: 88, filterType: "brand" }
      )
    ].join("");
  }

  function populateFilters() {
    const years = [...new Set(records.filter(row => row.entryDate).map(row => row.entryDate.year))].sort((a, b) => a - b);
    const brands = [...new Set(records.map(row => row.brand).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    const filterDefinitions = [
      { id: "ifoodTransactionFilter", label: "Todas as transações", values: records.map(row => row.transaction), keyOf: normalizeKey },
      { id: "ifoodStatusFilter", label: "Todos os status", values: records.map(row => row.status), keyOf: normalizeKey },
      { id: "ifoodModelFilter", label: "Todos os modelos", values: records.map(row => row.model), keyOf: value => value },
      { id: "ifoodSlaFilter", label: "Todos os SLA", values: records.map(row => row.sla || "Não informado"), keyOf: normalizeKey },
      { id: "ifoodShipmentStatusFilter", label: "Todos os status de envio", values: ["Adiantando", "Atrasado", "No prazo"], keyOf: value => value },
      { id: "ifoodShipmentCompletionFilter", label: "Todos", values: ["A Enviar", "Enviado"], keyOf: value => value }
    ];
    document.querySelector("#ifoodYearFilter").innerHTML = `<option value="all">Todos os anos</option>${years.map(year => `<option value="${year}">${year}</option>`).join("")}`;
    document.querySelector("#ifoodBrandFilter").innerHTML = `<option value="all">Todas as marcas</option>${brands.map(brand => `<option value="${escapeHtml(brand)}">${escapeHtml(brand)}</option>`).join("")}`;
    for (const { id, label, values, keyOf } of filterDefinitions) {
      const uniqueOptions = new Map(values.map(value => [keyOf(value), value]));
      const options = [...uniqueOptions].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
      document.querySelector(`#${id}`).innerHTML =
        `<option value="all">${label}</option>${options.map(([key, value]) => `<option value="${escapeHtml(key)}">${escapeHtml(value)}</option>`).join("")}`;
    }
  }

  async function refreshIfoodDashboard() {
    const status = document.querySelector("#ifoodDataStatus");
    const container = document.querySelector("#ifoodCharts");
    status.textContent = "Carregando dados da planilha...";
    status.classList.remove("negative");
    try {
      const response = await fetch(sheetCsvUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`A planilha IFOOD respondeu com ${response.status}`);
      if (!window.Papa) throw new Error("O analisador CSV não está disponível. Verifique a conexão com o serviço de scripts.");
      const parsed = window.Papa.parse(await response.text(), { header: true, skipEmptyLines: "greedy" });
      if (parsed.errors.length) throw new Error(`Erro ao ler o CSV na linha ${parsed.errors[0].row + 2}: ${parsed.errors[0].message}`);
      const loaded = parsed.data
        .filter(row => normalize(row.Pedido) && parseQuantity(row.Quantidade) > 0)
        .map(normalizeRow);
      if (!loaded.length) throw new Error("A planilha não retornou registros com pedido e quantidade.");
      records.splice(0, records.length, ...loaded);
      populateFilters();
      render();
      status.textContent = `${integer.format(records.length)} registros atualizados às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`;
    } catch (error) {
      status.textContent = `Não foi possível carregar a planilha IFOOD: ${error.message}`;
      status.classList.add("negative");
      container.innerHTML = `<article class="panel ifood-load-error">${escapeHtml(error.message)}</article>`;
      console.error("Não foi possível carregar os dados da planilha IFOOD.", error);
      throw error;
    }
  }

  document.querySelector("#ifoodCnpjFilter").addEventListener("input", render);
  document.querySelector("#ifoodYearFilter").addEventListener("change", render);
  document.querySelector("#ifoodBrandFilter").addEventListener("change", render);
  document.querySelector("#ifoodTransactionFilter").addEventListener("change", render);
  document.querySelector("#ifoodStatusFilter").addEventListener("change", render);
  document.querySelector("#ifoodModelFilter").addEventListener("change", render);
  document.querySelector("#ifoodSlaFilter").addEventListener("change", render);
  document.querySelector("#ifoodShipmentStatusFilter").addEventListener("change", render);
  document.querySelector("#ifoodShipmentCompletionFilter").addEventListener("change", render);
  document.querySelector("#ifoodCharts").addEventListener("click", event => {
    const chartItem = event.target.closest("[data-chart-filter]");
    if (chartItem) {
      applyChartFilter(chartItem.dataset.chartFilter, chartItem.dataset.filterValue);
      const replacement = [...document.querySelectorAll("#ifoodCharts [data-chart-filter]")].find(item =>
        item.dataset.chartFilter === chartItem.dataset.chartFilter && item.dataset.filterValue === chartItem.dataset.filterValue);
      replacement?.focus({ preventScroll: true });
    }
  });
  document.querySelector("#ifoodClearFilters").addEventListener("click", () => {
    document.querySelector("#ifoodCnpjFilter").value = "";
    chartFilters.clear();
    for (const id of [
      "ifoodYearFilter",
      "ifoodBrandFilter",
      "ifoodTransactionFilter",
      "ifoodStatusFilter",
      "ifoodModelFilter",
      "ifoodSlaFilter",
      "ifoodShipmentStatusFilter",
      "ifoodShipmentCompletionFilter"
    ]) {
      document.querySelector(`#${id}`).value = "all";
    }
    render();
  });
  window.refreshIfoodDashboard = refreshIfoodDashboard;
  refreshIfoodDashboard().catch(error => console.error("Falha na carga inicial do painel IFOOD.", error));
})();
