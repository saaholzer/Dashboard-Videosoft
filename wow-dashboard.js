(() => {
  const callsSheetCsvUrl = "https://docs.google.com/spreadsheets/d/1RGu5x3CXuAHpUF5fzdOy-njK6GWsDPW2gzmhjp-4No4/export?format=csv&gid=1184166301";
  const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const records = [];
  const filters = {
    year: "#wowYearFilter",
    month: "#wowMonthFilter",
    service: "#wowServiceFilter",
    agent: "#wowAgentFilter"
  };
  const viewTargets = {
    executive: "#wowExecutiveContent",
    sla: "#wowSlaContent",
    finance: "#wowFinanceContent",
    quality: "#wowQualityContent",
    team: "#wowTeamContent",
    assets: "#wowAssetsContent"
  };
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const moneyExact = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const normalize = value => String(value ?? "").trim();
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const normalizedText = value => normalize(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

  function parseNumber(value) {
    const raw = normalize(value).replace(/[^\d,.-]/g, "");
    if (!raw || raw === "-" || raw === ",") return null;
    const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".")
      : /^-?\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, "") : raw;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseHours(value) {
    const parts = normalize(value).split(":");
    if (parts.length !== 3 || parts.some(part => !/^\d+$/.test(part))) return null;
    const [hours, minutes, seconds] = parts.map(Number);
    return hours + minutes / 60 + seconds / 3600;
  }

  function parseDate(value) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(normalize(value));
    if (!match) return null;
    const [, day, month, year] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return { year, month: month - 1, timestamp: Date.UTC(year, month - 1, day) };
  }

  function normalizeRow(row) {
    const opened = parseDate(row["Data de abertura"]);
    const assistance = parseNumber(row["Valor de assistência pago"]);
    const parts = parseNumber(row["Valor de peças"]);
    const freight = parseNumber(row["Valor de frete"]);
    const status = normalize(row["Status do chamado"]);
    const closed = /^(fechado|encerrado|finalizado)/i.test(status);
    return {
      opened,
      ticket: normalize(row.Chamado),
      status,
      isOpen: !closed,
      sla: normalize(row["Dentro prazo / Fora prazo"]),
      client: normalize(row.Cliente) || "Não informado",
      branch: normalize(row.Filial) || "Não informada",
      supplier: normalize(row.Fornecedor) || "Não informado",
      agent: normalize(row.Atendente) || "Não informado",
      category: normalize(row.Categoria) || "Não informada",
      priority: normalize(row.Prioridade) || "Não informada",
      service: normalize(row.Serviço) || "Não informado",
      type: normalize(row["Tipo do chamado"]) || "Não informado",
      cause: normalize(row["Causa do chamado"]) || "Não informada",
      model: normalize(row.Modelo) || "Não informado",
      component: normalize(row.Componente) || "Não informado",
      serial: normalize(row["Número de série"]),
      city: normalize(row["Nome da cidade"]) || "Não informada",
      state: normalize(row["UF da cidade"]) || "Não informada",
      activations: parseNumber(row["Nro Acionamentos Técnico"]) ?? 0,
      assistance: assistance ?? 0,
      parts: parts ?? 0,
      freight: freight ?? 0,
      totalCost: (assistance ?? 0) + (parts ?? 0) + (freight ?? 0),
      agentHours: parseHours(row["Tempo gasto do atendente"]) ?? 0,
      supplierHours: parseHours(row["Tempo gasto do fornecedor"]) ?? 0,
      elapsedHours: parseHours(row["Tempo útil decorrido"])
    };
  }

  function setStatus(message, isError = false) {
    const status = document.querySelector("#wowDataStatus");
    status.textContent = message;
    status.classList.toggle("negative", isError);
  }

  function populateSelect(selector, values, firstLabel, sortFn) {
    const select = document.querySelector(selector);
    const previous = select.value;
    const sorted = [...values].sort(sortFn ?? ((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" })));
    select.innerHTML = `<option value="all">${escapeHtml(firstLabel)}</option>${sorted.map(value =>
      `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    if (sorted.includes(previous)) select.value = previous;
  }

  function populateFilters() {
    populateSelect(filters.year, new Set(records.map(row => String(row.opened.year))), "Todos os anos", (a, b) => Number(b) - Number(a));
    populateSelect(filters.month, new Set(records.map(row => String(row.opened.month))), "Todos os meses", (a, b) => Number(a) - Number(b));
    const monthSelect = document.querySelector(filters.month);
    for (const option of monthSelect.options) {
      if (option.value !== "all") option.textContent = monthNames[Number(option.value)];
    }
    populateSelect(filters.service, new Set(records.map(row => row.service)), "Todos os serviços");
    populateSelect(filters.agent, new Set(records.map(row => row.agent)), "Todos os atendentes");
  }

  function selectedRows() {
    const selected = Object.fromEntries(Object.entries(filters).map(([key, selector]) => [key, document.querySelector(selector).value]));
    return records.filter(row =>
      (selected.year === "all" || String(row.opened.year) === selected.year) &&
      (selected.month === "all" || String(row.opened.month) === selected.month) &&
      (selected.service === "all" || row.service === selected.service) &&
      (selected.agent === "all" || row.agent === selected.agent)
    );
  }

  function group(rows, keyOf, valueOf = () => 0) {
    const groups = new Map();
    for (const row of rows) {
      const key = keyOf(row);
      if (!key) continue;
      let item = groups.get(key);
      if (!item) {
        item = { name: key, count: 0, sum: 0, rows: [] };
        groups.set(key, item);
      }
      item.count++;
      item.sum += valueOf(row);
      item.rows.push(row);
    }
    return [...groups.values()];
  }

  function fmtValue(value, format) {
    if (format === "money") return money.format(value);
    if (format === "exactMoney") return moneyExact.format(value);
    if (format === "percent") return `${number.format(value)}%`;
    if (format === "hours") return `${number.format(value)} h`;
    if (format === "decimal") return number.format(value);
    return integer.format(value);
  }

  function chartPanel(title, subtitle, content, id = "") {
    return `<article class="panel"${id ? ` id="${escapeHtml(id)}"` : ""}><div class="panel-head"><div><h2 class="panel-title">${escapeHtml(title)}</h2><p class="panel-subtitle">${escapeHtml(subtitle)}</p></div></div>${content}</article>`;
  }

  function bars(items, { format = "count", maxRows = 10, tone = "", displayFormat = format, sortByCount = false, scrollable = false } = {}) {
    if (!items.length) return '<div class="wow-message">Sem dados para os filtros selecionados.</div>';
    const visible = [...items].sort((a, b) =>
      (sortByCount ? b.count - a.count : b.value - a.value) || a.name.localeCompare(b.name, "pt-BR")
    ).slice(0, maxRows);
    const maximum = Math.max(...visible.map(item => item.value), 1);
    return `<div class="wow-chart-list${scrollable ? " wow-chart-list-scroll" : ""}">${visible.map(item => {
      const width = Math.min(100, Math.max(1.5, item.value / maximum * 100));
      const detail = item.note ? `<span class="wow-chart-note">${escapeHtml(item.note)}</span>` : "";
      const displayValue = item.displayText ?? fmtValue(item.displayValue ?? item.value, displayFormat);
      return `<div class="wow-chart-row" title="${escapeHtml(`${item.name}: ${displayValue}`)}"><div class="wow-chart-row-head"><span class="wow-chart-name">${escapeHtml(item.name)}</span><span class="wow-chart-value">${escapeHtml(displayValue)}</span></div><div class="wow-chart-track"><div class="wow-chart-fill ${tone}" style="width:${width.toFixed(1)}%"></div></div>${detail}</div>`;
    }).join("")}</div>`;
  }

  function countBars(items, maxRows = 10) {
    return bars(items.map(item => ({ name: item.name, value: item.count, note: item.note })), { maxRows });
  }

  function monthlyChart(rows, valueOf, format, title = "Chamados por mês") {
    const months = group(rows.filter(row => row.opened), row => `${row.opened.year}-${String(row.opened.month + 1).padStart(2, "0")}`);
    const values = months.map(month => ({
      ...month,
      value: month.rows.reduce((sum, row) => sum + valueOf(row), 0)
    })).sort((a, b) => a.name.localeCompare(b.name));
    if (!values.length) return '<div class="wow-message">Não há datas de abertura no recorte.</div>';
    const maximum = Math.max(...values.map(item => item.value), 1);
    return `<div class="wow-month-chart" role="img" aria-label="${escapeHtml(title)}">${values.map(item => {
      const [year, month] = item.name.split("-").map(Number);
      const height = Math.max(2, item.value / maximum * 100);
      return `<div class="wow-month-item" title="${escapeHtml(`${monthNames[month - 1]}/${year}: ${fmtValue(item.value, format)}`)}"><span class="wow-month-value">${escapeHtml(fmtValue(item.value, format))}</span><div class="wow-month-track"><div class="wow-month-bar" style="height:${height.toFixed(1)}%"></div></div><span class="wow-month-label">${monthNames[month - 1]}/${String(year).slice(-2)}</span></div>`;
    }).join("")}</div>`;
  }

  function groupedCount(rows, keyOf, maxRows = 10, options = {}) {
    return bars(group(rows, keyOf).map(item => ({ name: item.name, value: item.count, note: item.note })), { maxRows, ...options });
  }

  function slaRate(items, maxRows = 10, sortByCount = false) {
    const rated = items.map(item => {
      const valid = item.rows.filter(row => row.sla === "Dentro prazo" || row.sla === "Fora prazo");
      const onTime = valid.filter(row => row.sla === "Dentro prazo").length;
      const rate = valid.length ? onTime / valid.length * 100 : 0;
      return { name: item.name, count: item.count, value: rate, ratedCount: valid.length, note: `${integer.format(valid.length)} chamados com SLA · ${integer.format(onTime)} dentro do prazo` };
    }).filter(item => item.ratedCount > 0);
    return bars(rated, { format: "percent", maxRows, tone: "", sortByCount });
  }

  function slaSummary(rows) {
    const within = rows.filter(row => row.sla === "Dentro prazo").length;
    const late = rows.filter(row => row.sla === "Fora prazo").length;
    const rated = within + late;
    const rate = rated ? within / rated * 100 : 0;
    const items = [
      { name: "Dentro do prazo", value: rated ? within / rated * 100 : 0, count: within, tone: "" },
      { name: "Fora do prazo", value: rated ? late / rated * 100 : 0, count: late, tone: "late" }
    ];
    return `<div class="wow-chart-list">${items.map(item => `<div class="wow-chart-row"><div class="wow-chart-row-head"><span class="wow-chart-name">${item.name}</span><span class="wow-chart-value">${integer.format(item.count)} · ${number.format(item.value)}%</span></div><div class="wow-chart-track"><div class="wow-chart-fill ${item.tone}" style="width:${item.value.toFixed(1)}%"></div></div></div>`).join("")}<p class="wow-chart-note">SLA informado em ${integer.format(rated)} de ${integer.format(rows.length)} chamados · cumprimento de ${number.format(rate)}%.</p></div>`;
  }

  function statusChart(rows, openOnly = false) {
    const selected = openOnly ? rows.filter(row => row.isOpen) : rows;
    return groupedCount(selected, row => row.status || "Não informado", 10);
  }

  function renderKpis(rows) {
    const inTime = rows.filter(row => row.sla === "Dentro prazo").length;
    const late = rows.filter(row => row.sla === "Fora prazo").length;
    const rated = inTime + late;
    const cost = rows.reduce((sum, row) => sum + row.totalCost, 0);
    const open = rows.filter(row => row.isOpen).length;
    const items = [
      ["Chamados", integer.format(rows.length), "no recorte filtrado"],
      ["SLA dentro do prazo", rated ? `${number.format(inTime / rated * 100)}%` : "—", `${integer.format(inTime)} dentro · ${integer.format(late)} fora do prazo`],
      ["Custo total", moneyExact.format(cost), "assistência + peças + fretes"],
      ["Custo médio / chamado", moneyExact.format(rows.length ? cost / rows.length : 0), "custo do período dividido pelos chamados"],
      ["Backlog atual", integer.format(open), "status não encerrados no arquivo"]
    ];
    document.querySelector("#wowKpis").innerHTML = items.map(([label, value, foot]) =>
      `<article class="kpi wow-kpi"><p class="kpi-label"><span class="kpi-dot"></span>${label}</p><p class="kpi-value">${value}</p><p class="kpi-foot">${foot}</p></article>`).join("");
    const years = [...new Set(rows.map(row => row.opened.year))].sort((a, b) => a - b);
    const period = years.length ? `${years[0]}${years.length > 1 ? `–${years[years.length - 1]}` : ""}` : "sem período";
    document.querySelector("#wowPeriodNote").textContent = `${integer.format(rows.length)} chamados · ${period}`;
  }

  function renderExecutive(rows) {
    const costs = [
      { name: "Assistência", value: rows.reduce((sum, row) => sum + row.assistance, 0) },
      { name: "Peças", value: rows.reduce((sum, row) => sum + row.parts, 0) },
      { name: "Fretes", value: rows.reduce((sum, row) => sum + row.freight, 0) }
    ];
    document.querySelector(viewTargets.executive).innerHTML = `<div class="wow-chart-grid">
      ${chartPanel("Volume mensal de chamados", "Chamados agrupados pela data de abertura.", monthlyChart(rows, () => 1, "count"))}
      ${chartPanel("Cumprimento de SLA", "Percentual calculado somente sobre chamados classificados como dentro ou fora do prazo.", slaSummary(rows))}
      ${chartPanel("Custos por componente", "Valores informados na base: assistência, peças e frete.", bars(costs, { format: "money", maxRows: 3 }))}
      ${chartPanel("Backlog por status", "Status que não indicam fechamento ou encerramento.", statusChart(rows, true))}
    </div>`;
  }

  function renderSla(rows) {
    const clientsByVolume = group(rows, row => row.client)
      .map(client => {
        const rated = client.rows.filter(row => row.sla === "Dentro prazo" || row.sla === "Fora prazo");
        const within = rated.filter(row => row.sla === "Dentro prazo").length;
        const rate = rated.length ? within / rated.length * 100 : null;
        return {
          name: client.name,
          value: client.count,
          displayValue: rate ?? 0,
          displayText: rate == null ? "Sem SLA" : fmtValue(rate, "percent"),
          note: `${integer.format(rated.length)} chamados com SLA · ${rated.length ? `${fmtValue(rate, "percent")} dentro do prazo` : "sem classificação de SLA"}`
        };
      })
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "pt-BR"))
      .slice(0, 10);
    const dimensions = [
      chartPanel("SLA por cliente", "10 clientes com mais chamados, ordenados do maior para o menor; o indicador mostra a % de SLA.", bars(clientsByVolume, { format: "count", displayFormat: "percent", maxRows: 10 })),
      ...[
        { label: "Prioridade", keyOf: row => row.priority, sortByCount: true },
        { label: "Serviço", keyOf: row => row.service, sortByCount: true },
        { label: "Atendente", keyOf: row => row.agent, sortByCount: true }
      ].map(({ label, keyOf, sortByCount = false }) => {
        const chartRows = sortByCount ? rows : rows.filter(row => row.sla === "Dentro prazo" || row.sla === "Fora prazo");
        return chartPanel(`SLA por ${label.toLocaleLowerCase("pt-BR")}`, "Cumprimento (%) entre chamados com classificação de prazo; até 10 grupos.", slaRate(group(chartRows, keyOf), 10, sortByCount));
      })
    ];
    document.querySelector(viewTargets.sla).innerHTML = `<div class="wow-chart-grid">${dimensions.join("")}</div>`;
  }

  function renderFinance(rows) {
    const costBySupplier = group(rows.filter(row => row.supplier !== "Não informado"), row => row.supplier, row => row.totalCost)
      .map(item => ({ name: item.name, value: item.sum, note: `${integer.format(item.count)} chamados` }));
    const costs = [
      { name: "Assistência", value: rows.reduce((sum, row) => sum + row.assistance, 0) },
      { name: "Peças", value: rows.reduce((sum, row) => sum + row.parts, 0) },
      { name: "Frete", value: rows.reduce((sum, row) => sum + row.freight, 0) }
    ];
    const byService = group(rows, row => row.service, row => row.totalCost).map(item => ({
      name: item.name, value: item.sum, note: `${integer.format(item.count)} chamados`
    }));
    document.querySelector(viewTargets.finance).innerHTML = `<div class="wow-chart-grid">
      ${chartPanel("Custo total por mês", "Soma de assistência, peças e fretes por mês de abertura.", monthlyChart(rows, row => row.totalCost, "money"))}
      ${chartPanel("Composição do custo", "Valores acumulados no recorte selecionado.", bars(costs, { format: "money", maxRows: 3 }))}
      ${chartPanel("Custos por serviço", "Principais serviços por valor total.", bars(byService, { format: "money", maxRows: 10 }))}
      ${chartPanel("Custos por fornecedor", "Principais fornecedores por custo registrado.", bars(costBySupplier, { format: "money", maxRows: 10 }))}
    </div>`;
  }

  function renderQuality(rows) {
    const serialCounts = group(rows.filter(row => row.serial), row => row.serial);
    const recurring = serialCounts.filter(item => item.count > 1);
    const recurringTickets = recurring.reduce((sum, item) => sum + item.count, 0);
    const multiActivation = rows.filter(row => row.activations > 1).length;
    const inappropriate = rows.filter(row => normalizedText(row.service).includes("indevid") ||
      normalizedText(row.type).includes("chamado indevido") || normalizedText(row.category).includes("chamado indevido")).length;
    const recurrenceInfo = `<p class="wow-callout">${integer.format(recurring.length)} números de série aparecem em mais de um chamado no recorte (${integer.format(recurringTickets)} chamados associados). Isso sinaliza recorrência potencial, não reabertura confirmada. Há ${integer.format(multiActivation)} chamados com mais de um acionamento técnico; a base não tem campo explícito de reabertura e a causa do chamado está vazia.</p>`;
    const recurrentModels = group(rows.filter(row => row.serial), row => row.serial)
      .filter(item => item.count > 1)
      .flatMap(item => item.rows)
      .reduce((map, row) => map.set(row.model, (map.get(row.model) ?? 0) + 1), new Map());
    const modelItems = [...recurrentModels].map(([name, count]) => ({ name, count }));
    const failures = group(rows.filter(row => /incidente|hardware|software|falha/i.test(`${row.type} ${row.service} ${row.category}`)), row => row.type);
    document.querySelector(viewTargets.quality).innerHTML = `${recurrenceInfo}<div class="wow-chart-grid">
      ${chartPanel("Acionamentos técnicos", "Chamados com mais de um acionamento registrado.", countBars(group(rows.filter(row => row.activations > 1), row => row.agent).sort((a, b) => b.count - a.count), 10))}
      ${chartPanel("Chamados indevidos", "Identificados pelo serviço, tipo ou categoria que menciona indevido.", `<div class="wow-chart-list"><div class="wow-chart-row-head"><span class="wow-chart-name">Chamados indevidos</span><span class="wow-chart-value">${integer.format(inappropriate)}</span></div><p class="wow-chart-note">De ${integer.format(rows.length)} chamados filtrados · ${number.format(rows.length ? inappropriate / rows.length * 100 : 0)}%.</p></div>`)}
      ${chartPanel("Falhas por tipo", "Incidentes, hardware, software e falhas identificados nos campos de classificação.", countBars(failures, 10))}
      ${chartPanel("Reincidência potencial por modelo", "Modelos associados a números de série que aparecem em mais de um chamado.", countBars(modelItems, 10))}
    </div>`;
  }

  function renderTeam(rows) {
    const byAgent = group(rows, row => row.agent);
    const hoursByAgent = group(rows, row => row.agent, row => row.agentHours);
    const efficiency = byAgent.map(item => {
      const hours = hoursByAgent.find(candidate => candidate.name === item.name)?.sum ?? 0;
      return { name: item.name, value: hours ? item.count / hours : 0, note: `${integer.format(item.count)} chamados · ${number.format(hours)} h registradas` };
    });
    const supplierHours = group(rows, row => row.supplier, row => row.supplierHours)
      .filter(item => item.sum > 0).map(item => ({ name: item.name, value: item.sum, note: `${integer.format(item.count)} chamados` }));
    document.querySelector(viewTargets.team).innerHTML = `<div class="wow-chart-grid">
      ${chartPanel("Chamados por atendente", "Distribuição de chamados atribuídos à equipe.", countBars(byAgent, 12))}
      ${chartPanel("Horas registradas por atendente", "Soma do tempo gasto pelo atendente.", bars(hoursByAgent.map(item => ({ name: item.name, value: item.sum, note: `${integer.format(item.count)} chamados` })), { format: "hours", maxRows: 12 }))}
      ${chartPanel("Chamados por hora registrada", "Indicador de volume dividido pelas horas informadas; não representa avaliação individual.", bars(efficiency, { format: "decimal", maxRows: 12 }))}
      ${chartPanel("Horas de fornecedores", "Tempo gasto pelo fornecedor conforme registrado na base.", bars(supplierHours, { format: "hours", maxRows: 10 }))}
    </div>`;
  }

  function renderAssets(rows) {
    const dimensions = [
      ["Clientes", row => row.client],
      ["Filiais", row => row.branch],
      ["Modelos de equipamento", row => row.model],
      ["Componentes", row => row.component, rows => rows.filter(row => {
        const component = normalizedText(row.component);
        return !component.includes("nao se aplica") && component !== "nao informado" && component !== "fora de linha";
      })],
      ["Estados (UF)", row => row.state, rows => rows.filter(row => {
        const state = normalizedText(row.state);
        return state !== "nao informado" && state !== "nao informada";
      })],
      ["Cidades", row => row.city, rows => rows.filter(row => {
        const city = normalizedText(row.city);
        return city !== "nao informado" && city !== "nao informada";
      })]
    ];
    document.querySelector(viewTargets.assets).innerHTML = `<div class="wow-chart-grid">${dimensions.map(([title, keyOf, selectRows]) => {
      const chartRows = selectRows ? selectRows(rows) : rows;
      const isStateChart = title === "Estados (UF)";
      const isCityChart = title === "Cidades";
      const maxRows = isStateChart ? Infinity : isCityChart ? 50 : 10;
      return chartPanel(`Chamados por ${title.toLocaleLowerCase("pt-BR")}`, "Distribuição dos chamados no recorte selecionado.", groupedCount(chartRows, keyOf, maxRows, { scrollable: isStateChart || isCityChart }));
    }
    ).join("")}</div>`;
  }

  function render() {
    if (!records.length) return;
    const rows = selectedRows();
    renderKpis(rows);
    renderExecutive(rows);
    renderSla(rows);
    renderFinance(rows);
    renderQuality(rows);
    renderTeam(rows);
    renderAssets(rows);
  }

  function selectView(view) {
    for (const button of document.querySelectorAll(".wow-view-tab")) {
      const selected = button.dataset.wowView === view;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      document.querySelector(`#${button.getAttribute("aria-controls")}`).hidden = !selected;
    }
    const showOperationalFilters = view !== "dre";
    document.querySelector("#wowOperationsFilters").hidden = !showOperationalFilters;
    document.querySelector("#wowKpis").hidden = !showOperationalFilters;
  }

  function initialize() {
    for (const selector of Object.values(filters)) document.querySelector(selector).addEventListener("change", render);
    document.querySelector("#wowClearFilters").addEventListener("click", () => {
      for (const selector of Object.values(filters)) document.querySelector(selector).value = "all";
      render();
    });
    document.querySelector(".wow-view-tabs").addEventListener("click", event => {
      const button = event.target.closest(".wow-view-tab");
      if (button) selectView(button.dataset.wowView);
    });
    document.querySelector(".wow-view-tabs").addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...document.querySelectorAll(".wow-view-tab")];
      const current = buttons.findIndex(button => button.getAttribute("aria-selected") === "true");
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].click();
      buttons[next].focus();
    });
    selectView("dre");
  }

  function refresh() {
    records.length = 0;
    setStatus("Carregando banco de dados de chamados...");
    return new Promise((resolve, reject) => {
      Papa.parse(callsSheetCsvUrl, {
        download: true,
        worker: true,
        header: true,
        delimiter: "",
        skipEmptyLines: true,
        chunkSize: 1024 * 1024,
        chunk(result, parser) {
          const quoteError = result.errors.find(error => error.type === "Quotes");
          if (quoteError) {
            parser.abort();
            reject(new Error(`CSV inválido próximo à linha ${quoteError.row + 1}.`));
            return;
          }
          for (const row of result.data) {
            const normalized = normalizeRow(row);
            if (normalized.ticket && normalized.opened) records.push(normalized);
          }
          document.querySelector("#wowPeriodNote").textContent = `${integer.format(records.length)} chamados carregados...`;
        },
        error(error) {
          setStatus(`Não foi possível carregar a aba Banco de dados chamados: ${error.message}`, true);
          reject(error);
        },
        complete() {
          if (!records.length) {
            const error = new Error("O CSV foi carregado, mas não contém chamados com número e data de abertura válidos.");
            setStatus(error.message, true);
            reject(error);
            return;
          }
          populateFilters();
          render();
          setStatus(`Banco de dados atualizado · ${integer.format(records.length)} chamados · ${new Date().toLocaleString("pt-BR")}.`);
          resolve();
        }
      });
    });
  }

  window.wowDashboard = { initialize, refresh, render };
  initialize();
  refresh().catch(error => console.error("Não foi possível carregar o banco de dados de chamados do Wow Service.", error));
})();
