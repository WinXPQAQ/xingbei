export const SEAT_LABELS = ["红一", "蓝一", "蓝二", "红二", "红三", "蓝三"];

export function validateRoster(ids, heroes) {
  const available = new Set(heroes.map(hero => hero.id));
  if (ids.length !== 6 || ids.some(id => !available.has(id)) || new Set(ids).size !== 6) {
    throw new Error("请为六个位置分别选择不同的已实现角色");
  }
  return [...ids];
}

// Shared by all play modes. No roster is committed before the explicit start click.
export function chooseRoster(session, heroes, elements, open, close, { chooseSeat = false, teamControl = false, onSeat = () => {} } = {}) {
  heroes = heroes.filter(hero => hero.id !== "magicArcherEX");
  return session.wait(resolve => {
    elements.modalTitle.textContent = teamControl ? "选择位置与阵容：同阵营三人由你控制" : "指定六人阵容（按逆时针顺序）";
    elements.modalBody.replaceChildren();
    elements.modalActions.replaceChildren();
    const seatChoice = document.createElement("select");
    seatChoice.id = "human-seat"; seatChoice.setAttribute("aria-label", "我的位置");
    SEAT_LABELS.forEach((name, seat) => seatChoice.add(new Option(`${seat + 1}号位 · ${name}`, String(seat))));
    if (chooseSeat) {
      const label = document.createElement("label"); label.className = "roster-seat";
      label.append("我的位置 ", seatChoice); elements.modalBody.append(label);
    }
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
      const random = document.createElement("button"); random.textContent = "随机";
      random.setAttribute("aria-label", `随机${name}角色`);
      random.onclick = () => {
        const available = heroes.filter(hero => !selects.some(other => other !== select && other.value === hero.id));
        select.value = available[Math.floor(Math.random() * available.length)].id;
        update();
      };
      row.append(label, select, random); grid.append(row); return select;
    });
    const start = document.createElement("button");
    start.textContent = "开始对局"; start.disabled = true;
    function update() {
      const ids = selects.map(select => select.value);
      for (let i = 0; i < selects.length; i++) {
        const mine = chooseSeat && i === Number(seatChoice.value);
        const row = selects[i].closest('label');
        row.classList.toggle('roster-self', mine);
        row.querySelector('button').hidden = mine;
        row.querySelector('span').textContent = `${i + 1}号位 · ${SEAT_LABELS[i]}${mine ? ' · 我的角色' : ''}`;
        if (teamControl && SEAT_LABELS[i][0] === SEAT_LABELS[Number(seatChoice.value)][0]) {
          row.classList.add('roster-self');
          row.querySelector('span').textContent += ' · 由你控制';
        }
      }
      for (const select of selects) for (const option of select.options) {
        option.disabled = !!option.value && option.value !== select.value && ids.includes(option.value);
      }
      try { validateRoster(ids, heroes); start.disabled = false; }
      catch { start.disabled = true; }
    }
    start.onclick = () => {
      update();
      if (!start.disabled) { onSeat(chooseSeat ? Number(seatChoice.value) : 0); resolve(validateRoster(selects.map(select => select.value), heroes)); }
    };
    const randomAll = document.createElement("button"); randomAll.textContent = chooseSeat ? "随机其他5人" : "随机全部角色";
    randomAll.onclick = () => {
      const ownSeat = chooseSeat ? Number(seatChoice.value) : -1;
      const pool = heroes.filter(hero => hero.id !== selects[ownSeat]?.value);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      let next = 0;
      selects.forEach((select, i) => { if (i !== ownSeat) select.value = pool[next++].id; }); update();
    };
    seatChoice.onchange = () => { selects[Number(seatChoice.value)].value = ''; update(); };
    update();
    elements.modalBody.append(grid); elements.modalActions.append(randomAll, start); open();
    return close;
  });
}
