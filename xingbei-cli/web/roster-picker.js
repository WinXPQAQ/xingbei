export const SEAT_LABELS = ["红一", "蓝一", "蓝二", "红二", "红三", "蓝三"];

export function validateRoster(ids, heroes) {
  const available = new Set(heroes.map(hero => hero.id));
  if (ids.length !== 6 || ids.some(id => !available.has(id)) || new Set(ids).size !== 6) {
    throw new Error("请为六个位置分别选择不同的已实现角色");
  }
  return [...ids];
}

// Shared by all play modes. No roster is committed before the explicit start click.
export function chooseRoster(session, heroes, elements, open, close) {
  return session.wait(resolve => {
    elements.modalTitle.textContent = "指定六人阵容（按逆时针顺序）";
    elements.modalBody.replaceChildren();
    elements.modalActions.replaceChildren();
    const grid = document.createElement("div");
    grid.className = "roster-picker";
    const selects = SEAT_LABELS.map((name, seat) => {
      const row = document.createElement("label");
      const label = document.createElement("span");
      label.textContent = `${seat + 1}号位 · ${name}`;
      const select = document.createElement("select");
      select.dataset.seat = seat; select.setAttribute("aria-label", label.textContent);
      select.add(new Option("请选择角色", ""));
      for (const hero of heroes) select.add(new Option(hero.name, hero.id));
      select.onchange = update;
      row.append(label, select); grid.append(row); return select;
    });
    const start = document.createElement("button");
    start.textContent = "开始对局"; start.disabled = true;
    function update() {
      const ids = selects.map(select => select.value);
      for (const select of selects) for (const option of select.options) {
        option.disabled = !!option.value && option.value !== select.value && ids.includes(option.value);
      }
      try { validateRoster(ids, heroes); start.disabled = false; }
      catch { start.disabled = true; }
    }
    start.onclick = () => { update(); if (!start.disabled) resolve(validateRoster(selects.map(select => select.value), heroes)); };
    elements.modalBody.append(grid); elements.modalActions.append(start); open();
    return close;
  });
}
