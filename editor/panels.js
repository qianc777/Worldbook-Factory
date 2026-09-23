export const TOOLS_PREFERENCE_KEY = 'worldbook-factory.tools-collapsed';

// This controls presentation only: keep the original inputs and their values in place.
export function createToolPanels({ shell, toggle, panels, brand, compactBook, storage }) {
  let collapsed = false;
  try { collapsed = storage?.getItem(TOOLS_PREFERENCE_KEY) === 'true'; } catch { /* Optional preference. */ }

  function setCollapsed(value, { persist = true } = {}) {
    collapsed = Boolean(value);
    shell.classList.toggle('tools-collapsed', collapsed);
    panels.forEach(panel => { panel.hidden = collapsed; });
    brand.hidden = collapsed;
    compactBook.hidden = !collapsed;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.querySelector('span').textContent = collapsed ? '展开工具' : '收起上方';
    toggle.title = collapsed ? '展开选书、书名、搜索和筛选工具' : '收起上方工具，为条目列表腾出空间';
    if (persist) {
      try { storage?.setItem(TOOLS_PREFERENCE_KEY, String(collapsed)); } catch { /* Folding still works without storage. */ }
    }
  }

  toggle.addEventListener('click', () => setCollapsed(!collapsed));
  setCollapsed(collapsed, { persist: false });
  return Object.freeze({ isCollapsed: () => collapsed, setCollapsed, reveal: () => setCollapsed(false) });
}
