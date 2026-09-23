const indexOf = entry => Number.isFinite(Number(entry.displayIndex)) ? Number(entry.displayIndex) : 0;

export function displayOrder(book) {
  return Object.entries(book.entries).sort((a, b) => indexOf(a[1]) - indexOf(b[1])).map(([id]) => id);
}

// Reordering only changes displayIndex. UID, insertion priority and other fields stay intact.
export function moveEntries(book, ids, destination) {
  const original = displayOrder(book);
  const selected = new Set(ids.map(String));
  if (![...selected].every(id => Object.hasOwn(book.entries, id))) throw new Error('移动的条目已不存在。');
  if (!selected.size) return { changed: false, count: 0, ids: original };
  let next = [...original];
  const moving = original.filter(id => selected.has(id));
  const remaining = original.filter(id => !selected.has(id));
  if (destination === 'up') {
    for (let i = 1; i < next.length; i++) {
      if (selected.has(next[i]) && !selected.has(next[i - 1])) [next[i - 1], next[i]] = [next[i], next[i - 1]];
    }
  } else if (destination === 'down') {
    for (let i = next.length - 2; i >= 0; i--) {
      if (selected.has(next[i]) && !selected.has(next[i + 1])) [next[i], next[i + 1]] = [next[i + 1], next[i]];
    }
  } else if (destination === 'top' || destination === 'bottom') {
    next = destination === 'top' ? [...moving, ...remaining] : [...remaining, ...moving];
  } else if (Number.isInteger(destination?.position)) {
    const index = destination.position - 1;
    if (index < 0 || index > remaining.length) throw new Error(`位置应在 1 到 ${remaining.length + 1} 之间。`);
    next = [...remaining.slice(0, index), ...moving, ...remaining.slice(index)];
  } else if (destination && ['before', 'after'].includes(destination.placement)) {
    const target = String(destination.targetId);
    if (selected.has(target)) return { changed: false, count: selected.size, ids: original };
    const anchor = remaining.indexOf(target);
    if (anchor === -1) throw new Error('目标条目已不存在。');
    const index = anchor + (destination.placement === 'after' ? 1 : 0);
    next = [...remaining.slice(0, index), ...moving, ...remaining.slice(index)];
  } else {
    throw new Error('无效的移动位置。');
  }
  const changed = original.some((id, index) => next[index] !== id);
  if (changed) next.forEach((id, index) => { book.entries[id].displayIndex = index; });
  return { changed, count: selected.size, ids: next };
}
