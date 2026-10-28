const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

// Each selection keeps its predicate, independent of the currently visible groups.
export function createChartFilters(rootSelector, onChange, hostSelector = '.filters') {
  const root = document.querySelector(rootSelector);
  const selected = new Map();
  const actions = new Map();
  let serial = 0;
  let toolbar;
  function scopeOf(element, action) {
    return action.scope || element.closest('[data-filter-scope]')?.dataset.filterScope || 'Gráfico';
  }
  function refresh() {
    onChange();
  }
  function activate(element) {
    const action = actions.get(element.dataset.crossFilter);
    if (!action) return;
    const scope = scopeOf(element, action);
    if (selected.get(scope)?.label === action.label) selected.delete(scope);
    else selected.set(scope, action);
    refresh();
    const replacement = [...root.querySelectorAll('[data-cross-filter]')].find(node => {
      const candidate = actions.get(node.dataset.crossFilter);
      return node.dataset.crossOwner === rootSelector && candidate?.label === action.label && scopeOf(node, candidate) === scope;
    });
    replacement?.focus({ preventScroll: true });
  }
  root.addEventListener('click', event => {
    const item = event.target.closest('[data-cross-filter]');
    if (item?.dataset.crossOwner === rootSelector && root.contains(item)) activate(item);
    const remove = event.target.closest('[data-remove-chart-filter]');
    if (remove && toolbar?.contains(remove)) {
      if (remove.dataset.removeChartFilter === '*') selected.clear();
      else selected.delete(remove.dataset.removeChartFilter);
      refresh();
    }
  });
  root.addEventListener('keydown', event => {
    const item = event.target.closest('[data-cross-filter]');
    if (item?.dataset.crossOwner === rootSelector && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      activate(item);
    }
  });
  return {
    begin() { actions.clear(); serial = 0; },
    attrs(scope, label, test, domain = '') {
      if (!test) return '';
      const id = String(++serial);
      actions.set(id, { scope, label: String(label), test, domain });
      return `data-cross-filter="${id}" data-cross-owner="${escapeHtml(rootSelector)}" role="button" tabindex="0" aria-label="Filtrar: ${escapeHtml(label)}"`;
    },
    filter(rows, domain = '') {
      return rows.filter(row => [...selected.values()].every(action =>
        (action.domain && action.domain !== domain) || action.test(row)));
    },
    clear() { selected.clear(); },
    finish() {
      for (const element of root.querySelectorAll('[data-cross-filter]')) {
        if (element.dataset.crossOwner !== rootSelector) continue;
        const action = actions.get(element.dataset.crossFilter);
        if (!action) continue;
        const active = selected.get(scopeOf(element, action))?.label === action.label;
        element.setAttribute('aria-pressed', String(active));
      }
      const host = root.querySelector(hostSelector);
      if (!host) return;
      if (!toolbar) {
        toolbar = document.createElement('div');
        toolbar.className = 'chart-filter-toolbar';
        toolbar.setAttribute('aria-live', 'polite');
        host.append(toolbar);
      }
      toolbar.innerHTML = `<span>Clique nas barras ou segmentos para filtrar.</span>${[...selected].map(([scope, action]) =>
        `<button type="button" data-remove-chart-filter="${escapeHtml(scope)}" title="Remover filtro">${escapeHtml(scope)}: ${escapeHtml(action.label)} ×</button>`
      ).join('')}${selected.size ? '<button type="button" data-remove-chart-filter="*">Limpar filtros dos gráficos</button>' : ''}`;
    }
  };
}
