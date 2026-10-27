(() => {
  const spreadsheetId = "1gFOAWUq7Uw-RW-61P7T0A9oaIjNCL0nAkdagfBTn4lE";
  const baseSheet = { sheet: "ECOKIOSK", gid: "1218615768" };
  const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const fullMonthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  const sectorDefinitions = [
    { key: "cnc", name: "CNC", sheet: "HISTÓRICO CNC", gid: "1221788096", quantity: 3, scheduled: 0, start: 9, finish: 10, archived: 18, id: 15, activeSheet: "CNC", activeGid: "461523207", activeStatus: 7, activeFinish: 10, activeId: 15 },
    { key: "lixa", name: "LIXA", sheet: "HISTÓRICO LIXA", gid: "705357344", quantity: 3, scheduled: 0, start: 6, finish: 7, archived: 16, id: 13, activeSheet: "LIXA", activeGid: "1094277720", activeStatus: 4, activeFinish: null, activeId: 12 },
    { key: "cola", name: "COLA", sheet: "HISTÓRICO COLA", gid: "780685755", quantity: 3, scheduled: 0, start: 7, finish: 8, archived: 16, id: 13, activeSheet: "COLA", activeGid: "998130850", activeStatus: 5, activeFinish: 8, activeId: 13 },
    { key: "envelopamento", name: "ENVELOPAMENTO", sheet: "HISTÓRICO ENVELOPAMENTO", gid: "15858055", quantity: 3, scheduled: 0, start: 7, finish: 8, archived: 16, id: 13, activeSheet: "ENVELOPAMENTO", activeGid: "2060531318", activeStatus: 5, activeFinish: 8, activeId: 13 },
    { key: "refilamento", name: "REFILAMENTO", sheet: "HISTÓRICO REFILAMENTO", gid: "1268475360", quantity: 3, scheduled: 0, start: 7, finish: 8, archived: 16, id: 13, activeSheet: "REFILAMENTO", activeGid: "276802719", activeStatus: 5, activeFinish: 8, activeId: 13 },
    { key: "montagem", name: "MONTAGEM", sheet: "HISTÓRICO MONTAGEM", gid: "1972163336", quantity: 3, scheduled: 0, start: 10, finish: 11, archived: 18, id: 15, activeSheet: "MONTAGEM", activeGid: "1813589897", activeStatus: 6, activeFinish: 11, activeId: 15 },
    { key: "3d", name: "3D", sheet: "HISTÓRICO IMPRESSÃO 3D", gid: "285059890", quantity: 3, scheduled: 0, start: 7, finish: 8, archived: 15, id: 12, activeSheet: "IMPRESSÃO 3D", activeGid: "570888942", activeStatus: 5, activeFinish: 8, activeId: 12 }
  ];
  const reworkDefinition = { key: "rework", name: "RETRABALHOS", sheet: "HISTÓRICO RETRABALHO", gid: "1762520358" };
  const integerFormat = value => integer.format(value);
  const normalize = value => String(value ?? "").trim();
  const normalizeStatus = value => normalize(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ");
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const data = new Map();
  let activeView = "overview";

  function parseDate(value) {
    const text = normalize(value);
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
    if (!match) return null;
    const [, dayText, monthText, yearText, hourText = "0", minuteText = "0", secondText = "0"] = match;
    const year = Number(yearText);
    const month = Number(monthText) - 1;
    const day = Number(dayText);
    const timestamp = Date.UTC(year, month, day, Number(hourText), Number(minuteText), Number(secondText));
    const date = new Date(timestamp);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
    return { year, month, day, timestamp };
  }

  function parseQuantity(value) {
    const text = normalize(value).replace(/\s/g, "");
    if (!text) return 0;
    const normalized = text.includes(",") && text.includes(".")
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(",", ".");
    const quantity = Number(normalized);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  }

  function csvUrl(gid) {
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
  }

  function normalizeBaseRows(rows) {
    return rows
      .filter(row => normalize(row[13]))
      .map(row => ({
        scheduledDate: parseDate(row[1]),
        client: normalize(row[4]) || "Cliente não informado",
        quantity: parseQuantity(row[5]),
        structure: normalize(row[6]) || "Estrutura não informada",
        productionStatus: normalize(row[9]) || "Status não informado",
        productionArea: normalize(row[7]) || "Área não informada",
        id: normalize(row[13])
      }));
  }

  function normalizeSectorRows(rows, definition) {
    return rows
      .filter(row => normalize(row[definition.id]))
      .map(row => ({
        scheduledDate: parseDate(row[definition.scheduled]),
        startDate: parseDate(row[definition.start]),
        finishDate: parseDate(row[definition.finish]),
        archivedDate: parseDate(row[definition.archived]),
        quantity: parseQuantity(row[definition.quantity]),
        id: normalize(row[definition.id])
      }));
  }

  function normalizeActiveRows(rows, definition) {
    return rows
      .filter(row => /^PRD-/i.test(normalize(row[definition.activeId])) &&
        normalize(row[definition.activeStatus]) &&
        (definition.activeFinish === null || !normalize(row[definition.activeFinish])))
      .map(row => ({
        status: normalize(row[definition.activeStatus]),
        quantity: parseQuantity(row[definition.quantity]),
        id: normalize(row[definition.activeId])
      }));
  }

  function normalizeReworkRows(rows) {
    return rows
      .filter(row => normalize(row[1]) && parseDate(row[0]))
      .map(row => ({
        date: parseDate(row[0]),
        id: normalize(row[1]),
        cycle: normalize(row[2]),
        origin: normalize(row[5]) || "Origem não informada",
        destination: normalize(row[6]) || "Destino não informado"
      }));
  }

  function selectedDates(rows, dateOf = row => row.scheduledDate) {
    const year = document.querySelector("#ecokioskYearFilter").value;
    const month = document.querySelector("#ecokioskMonthFilter").value;
    return rows.filter(row => {
      const date = dateOf(row);
      if (!date) return year === "all" && month === "all";
      return (year === "all" || String(date.year) === year) &&
        (month === "all" || String(date.month) === month);
    });
  }

  function chartPanel(title, subtitle, items, { scrollable = false, order = "value", format = "count", limit } = {}) {
    const sorted = [...items];
    if (order === "value") sorted.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "pt-BR"));
    const visible = limit ? sorted.slice(0, limit) : sorted;
    if (!visible.length) {
      return `<article class="panel"><div class="panel-head"><div><h2 class="panel-title">${escapeHtml(title)}</h2><p class="panel-subtitle">${escapeHtml(subtitle)}</p></div></div><div class="wow-message">Sem dados para o período selecionado.</div></article>`;
    }
    const maximum = Math.max(...visible.map(item => item.value), 1);
    const rows = visible.map(item => {
      const width = Math.min(100, Math.max(1.5, item.value / maximum * 100));
      const display = format === "count" ? integerFormat(item.value) : item.display;
      const note = item.note ? `<span class="wow-chart-note">${escapeHtml(item.note)}</span>` : "";
      return `<div class="wow-chart-row" title="${escapeHtml(`${item.name}: ${display}`)}"><div class="wow-chart-row-head"><span class="wow-chart-name">${escapeHtml(item.name)}</span><span class="wow-chart-value">${escapeHtml(display)}</span></div><div class="wow-chart-track"><div class="wow-chart-fill" style="width:${width.toFixed(1)}%"></div></div>${note}</div>`;
    }).join("");
    const listClass = `wow-chart-list${scrollable ? " wow-chart-list-scroll" : ""}`;
    return `<article class="panel"><div class="panel-head"><div><h2 class="panel-title">${escapeHtml(title)}</h2><p class="panel-subtitle">${escapeHtml(subtitle)}</p></div></div><div class="${listClass}">${rows}</div></article>`;
  }

  function monthlyGroups(rows, dateOf, valueOf) {
    const months = new Map();
    for (const row of rows) {
      const date = dateOf(row);
      if (!date) continue;
      const key = `${date.year}-${String(date.month).padStart(2, "0")}`;
      const group = months.get(key) ?? { name: `${monthNames[date.month]} ${date.year}`, value: 0, records: 0, key };
      group.value += valueOf(row);
      group.records += 1;
      months.set(key, group);
    }
    return [...months.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  function monthlyQuantity(rows, dateOf, quantityOf, recordLabel = "registros", singularRecordLabel = "registro") {
    return monthlyGroups(rows, dateOf, quantityOf).map(group => ({
      ...group,
      note: `${integerFormat(group.records)} ${group.records === 1 ? singularRecordLabel : recordLabel}`
    }));
  }

  function normalizedName(value, type) {
    let name = normalize(value);
    if (type === "structure") {
      name = name.replace(/^\s*\d{3,}\s*(?:[-–—]\s*|\s+)/, "");
    } else {
      name = name.replace(/\([^)]*\)/g, " ");
      name = name.replace(/\bATENDER\s+PEDIDOS?\b.*$/i, "ATENDER PEDIDO");
    }
    const key = name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
    return key.split(" ").includes("pulmao") ? "pulmao" : key;
  }

  function nameSimilarity(left, right) {
    const a = left.replace(/\s/g, "");
    const b = right.replace(/\s/g, "");
    if (a.length < 8 || b.length < 8) return 0;
    if (a === b) return 1;
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let row = 1; row <= a.length; row += 1) {
      let diagonal = previous[0];
      previous[0] = row;
      for (let column = 1; column <= b.length; column += 1) {
        const above = previous[column];
        previous[column] = Math.min(
          previous[column] + 1,
          previous[column - 1] + 1,
          diagonal + (a[row - 1] === b[column - 1] ? 0 : 1)
        );
        diagonal = above;
      }
    }
    return 1 - previous[b.length] / Math.max(a.length, b.length);
  }

  function groupQuantity(rows, keyOf, type) {
    const labels = new Map();
    for (const row of rows) {
      const sourceName = keyOf(row);
      const key = normalizedName(sourceName, type);
      if (!key) continue;
      const item = labels.get(key) ?? { key, name: key === "pulmao" ? "Pulmão" : type === "structure"
        ? normalize(sourceName).replace(/^\s*\d{3,}\s*(?:[-–—]\s*|\s+)/, "").replace(/^["']|["']$/g, "")
        : normalize(sourceName).replace(/\([^)]*\)/g, " ").trim(), value: 0, records: 0 };
      item.value += row.quantity;
      item.records += 1;
      labels.set(key, item);
    }

    const groups = [];
    for (const item of [...labels.values()].sort((a, b) => b.records - a.records || a.name.localeCompare(b.name, "pt-BR"))) {
      const group = groups.find(candidate =>
        candidate.keys.some(key => nameSimilarity(key, item.key) >= 0.92)
      );
      if (group) {
        group.value += item.value;
        group.records += item.records;
        group.keys.push(item.key);
      } else {
        groups.push({ ...item, keys: [item.key] });
      }
    }
    return groups.map(({ keys, ...group }) => ({
      ...group,
      note: `${integerFormat(group.records)} ${group.records === 1 ? "registro" : "registros"}`
    }));
  }

  function averageDurationByMonth(rows) {
    const groups = new Map();
    for (const row of rows) {
      if (!row.startDate || !row.finishDate || row.finishDate.timestamp <= row.startDate.timestamp) continue;
      const key = `${row.finishDate.year}-${String(row.finishDate.month).padStart(2, "0")}`;
      const group = groups.get(key) ?? { name: `${monthNames[row.finishDate.month]} ${row.finishDate.year}`, totalHours: 0, records: 0, key };
      group.totalHours += (row.finishDate.timestamp - row.startDate.timestamp) / 3600000;
      group.records += 1;
      groups.set(key, group);
    }
    return [...groups.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(group => {
        const average = group.totalHours / group.records;
        const hours = Math.floor(average);
        const minutes = Math.round((average - hours) * 60);
        return {
          name: group.name,
          value: average,
          display: `${hours}h ${minutes}min`,
          note: `${integerFormat(group.records)} ${group.records === 1 ? "registro" : "registros"}`
        };
      });
  }

  function groupRework(rows, keyOf) {
    const groups = new Map();
    for (const row of rows) {
      const name = keyOf(row);
      const group = groups.get(name) ?? { name, value: 0, productions: new Set() };
      group.value += 1;
      group.productions.add(row.id);
      groups.set(name, group);
    }
    return [...groups.values()].map(({ productions, ...group }) => ({
      ...group,
      note: `${integerFormat(productions.size)} ${productions.size === 1 ? "produção afetada" : "produções afetadas"}`
    }));
  }

  function renderOverview() {
    const status = document.querySelector("#ecokioskStatusFilter").value;
    const rows = selectedDates(data.get(baseSheet.sheet) ?? []).filter(row =>
      status === "all" || normalizeStatus(row.productionStatus) === status
    );
    const charts = [
      chartPanel(
        "QUANTIDADE POR MÊS",
        "Soma da quantidade prevista na coluna F por DATA PROGRAMADO.",
        monthlyQuantity(rows, row => row.scheduledDate, row => row.quantity, "registros programados", "registro programado"),
        { order: "chronological" }
      ),
      chartPanel(
        "STATUS PRODUÇÃO",
        "Soma da coluna F agrupada pelo status da coluna J.",
        groupQuantity(rows, row => row.productionStatus)
      ),
      chartPanel(
        "QUANTIDADE POR STATUS/ÁREA",
        "Soma da quantidade por status/área indicada na coluna H da aba OFICIAL.",
        groupQuantity(rows, row => row.productionArea),
        { scrollable: true }
      ),
      chartPanel(
        "VOLUME POR ESTRUTURA",
        "Top 10 · soma da coluna F, agrupando códigos e nomes de estrutura semelhantes.",
        groupQuantity(rows, row => row.structure, "structure"),
        { scrollable: true, limit: 10 }
      ),
      chartPanel(
        "VOLUME POR CLIENTE",
        "Top 10 · soma da coluna F com nomes de clientes semelhantes agrupados.",
        groupQuantity(rows, row => row.client, "client"),
        { scrollable: true, limit: 10 }
      )
    ];
    document.querySelector("#ecokioskOverviewCharts").innerHTML = charts.join("");
  }

  function renderSectorView(definition) {
    const rows = selectedDates(data.get(definition.sheet) ?? [], row => row.archivedDate);
    const completed = rows.filter(row => row.archivedDate);
    const completedQuantity = completed.reduce((sum, row) => sum + row.quantity, 0);
    const subtitle = `${integerFormat(completedQuantity)} unidades finalizadas · ${integerFormat(completed.length)} registros`;
    const activeRows = data.get(`active:${definition.key}`) ?? [];
    const activeQuantity = activeRows.reduce((sum, row) => sum + row.quantity, 0);
    const charts = [
      chartPanel(
        "PROCESSOS EM ANDAMENTO",
        `${integerFormat(activeQuantity)} unidades em ${integerFormat(activeRows.length)} processos na aba ${definition.activeSheet}.`,
        groupQuantity(activeRows, row => row.status),
        { scrollable: true }
      ),
      chartPanel(
        "QUANTIDADE CONCLUÍDA POR MÊS",
        `${definition.name} · agrupado pelo mês de ARQUIVADO EM. ${subtitle}.`,
        monthlyQuantity(completed, row => row.archivedDate, row => row.quantity, "registros finalizados", "registro finalizado"),
        { order: "chronological" }
      ),
      chartPanel(
        "REGISTROS CONCLUÍDOS POR MÊS",
        `${definition.name} · quantidade de operações agrupada pelo mês de ARQUIVADO EM.`,
        monthlyQuantity(completed, row => row.archivedDate, () => 1, "operações", "operação"),
        { order: "chronological" }
      ),
      chartPanel(
        "TEMPO MÉDIO DA ETAPA POR MÊS",
        "Média entre INÍCIO e FIM por operação arquivada, agrupada pelo mês de ARQUIVADO EM.",
        averageDurationByMonth(completed.map(row => ({ ...row, finishDate: row.finishDate ?? row.archivedDate }))),
        { order: "chronological", format: "custom" }
      )
    ];
    document.querySelector(`#ecokioskSectorCharts-${definition.key}`).innerHTML = charts.join("");
  }

  function renderReworkView() {
    const rows = selectedDates(data.get(reworkDefinition.sheet) ?? [], row => row.date);
    const charts = [
      chartPanel(
        "RETRABALHOS POR DESTINO",
        `${integerFormat(rows.length)} eventos · ${integerFormat(new Set(rows.map(row => row.id)).size)} produções afetadas.`,
        groupRework(rows, row => row.destination),
        { scrollable: true }
      ),
      chartPanel(
        "RETRABALHOS POR ORIGEM",
        "Quantidade de eventos registrada na aba HISTÓRICO RETRABALHO.",
        groupRework(rows, row => row.origin),
        { scrollable: true }
      ),
      chartPanel(
        "RETRABALHOS POR MÊS",
        "Quantidade de eventos agrupada pelo mês da data/hora do registro.",
        monthlyQuantity(rows, row => row.date, () => 1, "eventos", "evento"),
        { order: "chronological" }
      )
    ];
    document.querySelector("#ecokioskReworkCharts").innerHTML = charts.join("");
  }

  function renderActiveView() {
    if (activeView === "overview") {
      renderOverview();
      return;
    }
    if (activeView === reworkDefinition.key) {
      renderReworkView();
      return;
    }
    const definition = sectorDefinitions.find(sector => sector.key === activeView);
    if (definition) renderSectorView(definition);
  }

  function render() {
    const year = document.querySelector("#ecokioskYearFilter").value;
    const month = document.querySelector("#ecokioskMonthFilter").value;
    const monthLabel = month === "all" ? "todos os meses" : fullMonthNames[Number(month)];
    const selectedRecordCount = sectorDefinitions.reduce((sum, definition) =>
      sum + selectedDates(data.get(definition.sheet) ?? [], row => row.archivedDate).length, 0);
    document.querySelector("#ecokioskPeriodNote").textContent =
      `${integerFormat(selectedRecordCount)} registros nos históricos · ${monthLabel} · ${year === "all" ? "todos os anos" : year} selecionado`;
    renderActiveView();
    document.querySelector("#ecokioskDataNote").textContent =
      "A visão geral usa DATA PROGRAMADO. Nas abas dos setores, quantidades e operações finalizadas são agrupadas pela data ARQUIVADO EM; o tempo médio considera INÍCIO e FIM, usando ARQUIVADO EM como conclusão quando FIM não estiver disponível. Os filtros de setor acompanham ARQUIVADO EM. Em retrabalhos, o período usa a data/hora do evento.";
  }

  function selectView(view) {
    const tab = document.querySelector(`#ecokiosk-tab-${view}`);
    if (!tab) return;
    activeView = view;
    for (const button of document.querySelectorAll(".ecokiosk-view-tab")) {
      const selected = button === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    const overview = view === "overview";
    const rework = view === reworkDefinition.key;
    document.querySelector("#ecokioskStatusFilterContainer").hidden = !overview;
    document.querySelector("#ecokiosk-view-overview").hidden = !overview;
    for (const definition of sectorDefinitions) {
      document.querySelector(`#ecokiosk-view-${definition.key}`).hidden = view !== definition.key;
    }
    document.querySelector("#ecokiosk-view-rework").hidden = !rework;
    renderActiveView();
  }

  function handleTabKeydown(event) {
    const tabs = [...document.querySelectorAll(".ecokiosk-view-tab")];
    const currentIndex = tabs.indexOf(event.target);
    if (currentIndex < 0) return;
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    selectView(nextTab.dataset.ecokioskView);
    nextTab.focus();
  }

  function populateFilters() {
    const dates = [
      ...(data.get(baseSheet.sheet) ?? []).map(row => row.scheduledDate),
      ...sectorDefinitions.flatMap(definition => (data.get(definition.sheet) ?? []).flatMap(row => [row.scheduledDate, row.archivedDate])),
      ...(data.get(reworkDefinition.sheet) ?? []).map(row => row.date)
    ].filter(Boolean);
    const years = [...new Set(dates.map(date => date.year))].sort((a, b) => a - b);
    document.querySelector("#ecokioskYearFilter").innerHTML =
      `<option value="all">Todos os anos</option>${years.map(year => `<option value="${year}">${year}</option>`).join("")}`;
    document.querySelector("#ecokioskMonthFilter").innerHTML =
      `<option value="all">Todos os meses</option>${fullMonthNames.map((month, index) => `<option value="${index}">${month}</option>`).join("")}`;
    const statuses = new Map();
    for (const row of data.get(baseSheet.sheet) ?? []) {
      const key = normalizeStatus(row.productionStatus);
      if (key && key !== "status nao informado" && !statuses.has(key)) {
        statuses.set(key, row.productionStatus);
      }
    }
    document.querySelector("#ecokioskStatusFilter").innerHTML =
      `<option value="all">Todos os status</option>${[...statuses].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
        .map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join("")}`;
  }

  async function fetchSheet(sheet) {
    const response = await fetch(csvUrl(sheet.gid), { cache: "no-store" });
    if (!response.ok) throw new Error(`A aba ${sheet.sheet} respondeu com ${response.status}`);
    const parsed = window.Papa.parse(await response.text(), { header: false, skipEmptyLines: "greedy" });
    if (parsed.errors.length) {
      const firstError = parsed.errors[0];
      throw new Error(`Erro ao ler a aba ${sheet.sheet} na linha ${firstError.row + 1}: ${firstError.message}`);
    }
    return parsed.data.slice(1);
  }

  async function refreshEcokioskDashboard() {
    const status = document.querySelector("#ecokioskDataStatus");
    const container = document.querySelector("#ecokioskOverviewCharts");
    status.textContent = "Carregando planilha e históricos dos setores...";
    status.classList.remove("negative");
    try {
      if (!window.Papa) throw new Error("O analisador CSV não está disponível. Verifique a conexão com o serviço de scripts.");
      const activeSheets = sectorDefinitions.map(definition => ({
        sheet: definition.activeSheet,
        gid: definition.activeGid,
        definition
      }));
      const sheets = [baseSheet, ...sectorDefinitions, ...activeSheets, reworkDefinition];
      const results = await Promise.all(sheets.map(async sheet => [sheet.sheet, await fetchSheet(sheet)]));
      for (const [sheetName, rows] of results) {
        const definition = sectorDefinitions.find(sector => sector.sheet === sheetName);
        const activeDefinition = sectorDefinitions.find(sector => sector.activeSheet === sheetName);
        if (sheetName === baseSheet.sheet) data.set(sheetName, normalizeBaseRows(rows));
        else if (definition) data.set(sheetName, normalizeSectorRows(rows, definition));
        else if (activeDefinition) data.set(`active:${activeDefinition.key}`, normalizeActiveRows(rows, activeDefinition));
        else data.set(sheetName, normalizeReworkRows(rows));
      }
      populateFilters();
      render();
      const totalRecords = sectorDefinitions.reduce((sum, definition) => sum + (data.get(definition.sheet)?.length ?? 0), 0);
      const activeProcesses = sectorDefinitions.reduce((sum, definition) => sum + (data.get(`active:${definition.key}`)?.length ?? 0), 0);
      const totalRework = data.get(reworkDefinition.sheet)?.length ?? 0;
      status.textContent = `${integerFormat(totalRecords)} registros históricos, ${integerFormat(activeProcesses)} processos em andamento e ${integerFormat(totalRework)} eventos de retrabalho atualizados às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`;
    } catch (error) {
      status.textContent = `Não foi possível carregar os dados ECOKIOSK: ${error.message}`;
      status.classList.add("negative");
      container.innerHTML = `<article class="panel ecokiosk-load-error">${escapeHtml(error.message)}</article>`;
      console.error("Não foi possível carregar os dados da planilha ECOKIOSK.", error);
      throw error;
    }
  }

  document.querySelector("#ecokioskYearFilter").addEventListener("change", render);
  document.querySelector("#ecokioskMonthFilter").addEventListener("change", render);
  document.querySelector("#ecokioskStatusFilter").addEventListener("change", render);
  document.querySelector("#ecokioskViewTabs").addEventListener("click", event => {
    const tab = event.target.closest(".ecokiosk-view-tab");
    if (tab) selectView(tab.dataset.ecokioskView);
  });
  document.querySelector("#ecokioskViewTabs").addEventListener("keydown", handleTabKeydown);
  window.refreshEcokioskDashboard = refreshEcokioskDashboard;
  refreshEcokioskDashboard().catch(error => console.error("Falha na carga inicial do painel ECOKIOSK.", error));
})();
