(() => {
  const sheetCsvUrl = "https://docs.google.com/spreadsheets/d/1M2VJ62UeSu4UHrqBj9PSUKx4FrcVELnfG5QUCSCAAiw/export?format=csv&gid=0";
  const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  const records = [];
  const normalize = value => String(value ?? "").trim();
  const normalizeKey = value => normalize(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);

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

  function parseCancelledQuantity(value, quantity) {
    const text = normalize(value);
    if (!text || /^#(?:REF!|N\/A|VALUE!)/i.test(text)) return 0;
    const entries = text.split(/[,;\r\n]+/).map(entry => entry.trim()).filter(entry => entry && !entry.startsWith("#"));
    if (!entries.length) return 0;
    if (entries.length === 1 && /^(?:sim|yes|true|cancelado|cancelada)$/i.test(entries[0])) return quantity;
    return Math.min(entries.length, quantity);
  }

  function normalizeRow(row) {
    const entryDate = parseDate(row.Entrada);
    const deliveryDate = parseDate(row["Data Real de Entrega totem (executada)"]);
    const serials = normalize(row["Num Série do Totem"]).split(/[,;\r\n]+/).map(serial => serial.trim()).filter(Boolean);
    const quantity = parseQuantity(row.Quantidade);
    return {
      entryDate,
      deliveryDate,
      quantity,
      model: normalize(row["Modelo do totem"]) || "Não informado",
      status: normalize(row["Status do totem"]) || "Não informado",
      activationStatus: normalizeKey(row["Totem Ativo / Não Ativo"]),
      cancelledQuantity: parseCancelledQuantity(row.Cancelados, quantity),
      brand: normalize(row.Marcas) || "Não informado",
      sla: normalize(row["Atendimento SLA Videosoft"]),
      recommissionedSerials: serials.filter(serial => /^R/i.test(serial))
    };
  }

  function selectedRows(ignoreBrand = false) {
    const year = document.querySelector("#ifoodYearFilter").value;
    const brand = document.querySelector("#ifoodBrandFilter").value;
    return records.filter(row =>
      (year === "all" || String(row.entryDate?.year) === year) &&
      (ignoreBrand || brand === "all" || row.brand === brand)
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
    const totals = { "Totens ativos": 0, "Totens inativos": 0, "Totens cancelados": 0 };
    for (const row of rows) {
      const cancelled = row.cancelledQuantity;
      const remaining = Math.max(0, row.quantity - cancelled);
      totals["Totens cancelados"] += cancelled;
      if (["ativo", "ativa", "ativos", "ativas", "sim"].includes(row.activationStatus)) {
        totals["Totens ativos"] += remaining;
      } else if (["nao ativo", "nao ativa", "nao ativos", "nao ativas", "inativo", "inativa", "inativos", "inativas", "nao", "0", "false"].includes(row.activationStatus)) {
        totals["Totens inativos"] += remaining;
      }
    }
    return Object.entries(totals).map(([name, value]) => ({ name, value })).filter(item => item.value > 0);
  }

  function chartPanel(title, subtitle, items, { format = "count", scrollable = false, order = "value", emptyMessage = "Sem dados para os filtros selecionados." } = {}) {
    if (!items.length) return `<article class="panel"><div class="panel-head"><div><h2 class="panel-title">${escapeHtml(title)}</h2><p class="panel-subtitle">${escapeHtml(subtitle)}</p></div></div><div class="wow-message">${escapeHtml(emptyMessage)}</div></article>`;
    const sorted = order === "value" ? [...items].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "pt-BR")) : items;
    const maximum = Math.max(...sorted.map(item => item.scaleValue ?? item.value), 1);
    const rows = sorted.map(item => {
      const raw = item.scaleValue ?? item.value;
      const width = Math.min(100, Math.max(1.5, raw / maximum * 100));
      const display = item.display ?? (format === "percent" ? `${decimal.format(item.value)}%` : format === "days" ? `${decimal.format(item.value)} dias` : integer.format(item.value));
      const note = item.note ? `<span class="wow-chart-note">${escapeHtml(item.note)}</span>` : "";
      return `<div class="wow-chart-row" title="${escapeHtml(`${item.name}: ${display}`)}"><div class="wow-chart-row-head"><span class="wow-chart-name">${escapeHtml(item.name)}</span><span class="wow-chart-value">${escapeHtml(display)}</span></div><div class="wow-chart-track"><div class="wow-chart-fill" style="width:${width.toFixed(1)}%"></div></div>${note}</div>`;
    }).join("");
    const listClass = `wow-chart-list${scrollable ? " ifood-trend-list" : ""}`;
    return `<article class="panel"><div class="panel-head"><div><h2 class="panel-title">${escapeHtml(title)}</h2><p class="panel-subtitle">${escapeHtml(subtitle)}</p></div></div><div class="${listClass}">${rows}</div></article>`;
  }

  function groupedByMonth(rows, valueOf) {
    const months = new Map();
    for (const row of rows) {
      if (!row.entryDate) continue;
      const { year, month } = row.entryDate;
      const key = `${year}-${String(month).padStart(2, "0")}`;
      if (!months.has(key)) months.set(key, { name: `${monthNames[month]} ${year}`, year, month, value: 0 });
      valueOf(months.get(key), row);
    }
    return [...months.values()].sort((a, b) => a.year - b.year || a.month - b.month);
  }

  function monthQuantityChart(rows) {
    const months = groupedByMonth(rows, (month, row) => { month.value += row.quantity; });
    return chartPanel("Totens por mês e ano", "Quantidade total de totens agrupada pelo mês de entrada e ano.", months, { scrollable: true, order: "chronological" });
  }

  function annualQuantityChart(rows) {
    const annual = [...groupedQuantities(rows.filter(row => row.entryDate), row => String(row.entryDate.year))]
      .sort((a, b) => Number(a.name) - Number(b.name));
    return chartPanel("Totens por ano", "Soma da quantidade pelo ano de entrada.", annual, { order: "chronological" });
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
        return { name: month.name, value: rate, scaleValue: rate, display: `${decimal.format(rate)}%`, note: `${integer.format(onTime)} dentro do prazo · ${integer.format(late)} atrasados · ${integer.format(rated)} classificados` };
      });
    return chartPanel("Atendimento SLA por mês e ano", "SLA Videosoft por mês e ano de entrada; registros sem classificação ficam fora da taxa.", months, { format: "percent", scrollable: true, order: "chronological" });
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
        return { name: month.name, value: average, scaleValue: average, display: `${decimal.format(average)} dias`, note: `${integer.format(month.units)} totens com as duas datas` };
      });
    return chartPanel("Prazo médio até a entrega real", "Média mensal entre a entrada do pedido e a data real de entrega executada, ponderada pela quantidade.", months, { format: "days", scrollable: true, order: "chronological" });
  }

  function countKpi(label, value, note) {
    return `<article class="kpi wow-kpi"><p class="kpi-label"><span class="kpi-dot"></span>${escapeHtml(label)}</p><p class="kpi-value">${escapeHtml(value)}</p><p class="kpi-foot">${escapeHtml(note)}</p></article>`;
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

    document.querySelector("#ifoodPeriodNote").textContent = `${integer.format(rows.length)} registros · ${integer.format(sumQuantity(rows))} totens · ${yearLabel} · ${brandLabel}`;
    document.querySelector("#ifoodKpis").innerHTML = [
      countKpi("Totens", integer.format(sumQuantity(rows)), "Soma da quantidade na planilha"),
      countKpi("Atendimento SLA", slaTotal ? `${decimal.format(onTime / slaTotal * 100)}%` : "—", `${integer.format(onTime)} dentro do prazo de ${integer.format(slaTotal)} classificados`),
      countKpi("Totens recomissionados", integer.format(serialCount), "Seriais iniciados com R"),
      countKpi("Prazo médio de entrega", deliveredUnits ? `${decimal.format(averageLead)} dias` : "—", `${integer.format(deliveredUnits)} totens com entrada e entrega real`)
    ].join("");

    const brandRows = selectedRows(true);
    const recomRows = serialCount
      ? [{ name: "Seriais iniciados com R", value: serialCount, note: "Quantidade de seriais identificados como recomissionados" }]
      : [];
    document.querySelector("#ifoodCharts").innerHTML = [
      monthQuantityChart(rows),
      annualQuantityChart(rows),
      chartPanel("Totens por modelo", "Soma da quantidade por modelo de totem.", groupedQuantities(rows, row => row.model), { scrollable: true }),
      chartPanel("Totens por status", "Soma da quantidade por status do totem.", groupedQuantities(rows, row => row.status)),
      chartPanel("Visão de totens ativos, inativos e cancelados", "Ativos e inativos pela coluna “Totem Ativo / Não Ativo”; cancelados pelos seriais na coluna “Cancelados”.", operationalStatusQuantities(rows), { emptyMessage: "A planilha ainda não informa esses status no recorte selecionado." }),
      slaMonthlyChart(rows),
      chartPanel("Totens recomissionados", "Seriais cujo valor começa com a letra R, conforme solicitado.", recomRows),
      deliveryLeadTimeChart(rows),
      chartPanel("Totens por marca", "Soma da quantidade por marca; o filtro de marca aplica-se aos demais gráficos.", groupedQuantities(brandRows, row => row.brand), { scrollable: true })
    ].join("");
  }

  function populateFilters() {
    const years = [...new Set(records.filter(row => row.entryDate).map(row => row.entryDate.year))].sort((a, b) => a - b);
    const brands = [...new Set(records.map(row => row.brand).filter(brand => brand && brand !== "Não informado"))]
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    document.querySelector("#ifoodYearFilter").innerHTML = `<option value="all">Todos os anos</option>${years.map(year => `<option value="${year}">${year}</option>`).join("")}`;
    document.querySelector("#ifoodBrandFilter").innerHTML = `<option value="all">Todas as marcas</option>${brands.map(brand => `<option value="${escapeHtml(brand)}">${escapeHtml(brand)}</option>`).join("")}`;
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

  document.querySelector("#ifoodYearFilter").addEventListener("change", render);
  document.querySelector("#ifoodBrandFilter").addEventListener("change", render);
  window.refreshIfoodDashboard = refreshIfoodDashboard;
  refreshIfoodDashboard().catch(error => console.error("Falha na carga inicial do painel IFOOD.", error));
})();
