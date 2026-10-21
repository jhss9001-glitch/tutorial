(() => {
  'use strict';

  const MEALS = [
    { id: 'breakfast', label: '아침', icon: '🌅' },
    { id: 'lunch', label: '점심', icon: '☀️' },
    { id: 'dinner', label: '저녁', icon: '🌙' },
    { id: 'snack', label: '간식', icon: '🍪' },
  ];
  const MACROS = [
    { key: 'carb', label: '탄수화물', kcalPerG: 4, color: 'var(--carb)', guide: [40, 45] },
    { key: 'protein', label: '단백질', kcalPerG: 4, color: 'var(--protein)', guide: [25, 30] },
    { key: 'fat', label: '지방', kcalPerG: 9, color: 'var(--fat)', guide: [25, 30] },
  ];
  // 하루 목표량(g): 단백질은 체중 × 1.4g/kg, 지방은 고정 범위
  const PROTEIN_PER_KG = 1.4;
  const FAT_RANGE = [45, 55];
  // dv: 식약처 1일 영양성분 기준치, limit: 많이 먹을수록 주의할 성분
  const NUTRIENTS = [
    { key: 'kcal', label: '열량', unit: 'kcal' },
    { key: 'carb', label: '탄수화물', unit: 'g', dv: 324 },
    { key: 'sugar', label: '당류', unit: 'g', dv: 100, sub: true, limit: true },
    { key: 'fiber', label: '식이섬유', unit: 'g', dv: 25, sub: true },
    { key: 'protein', label: '단백질', unit: 'g', dv: 55 },
    { key: 'fat', label: '지방', unit: 'g', dv: 54 },
    { key: 'satfat', label: '포화지방', unit: 'g', dv: 15, sub: true, limit: true },
    { key: 'transfat', label: '트랜스지방', unit: 'g', sub: true, limit: true },
    { key: 'cholesterol', label: '콜레스테롤', unit: 'mg', dv: 300, sub: true, limit: true },
    { key: 'sodium', label: '나트륨', unit: 'mg', dv: 2000, limit: true },
  ];
  const NUTRIENT_KEYS = NUTRIENTS.map(n => n.key);
  const KEYS = { diary: 'dietDiary.v1', custom: 'dietDiary.customFoods', target: 'dietDiary.target', weight: 'dietDiary.weight' };
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  // ---------- 저장소 ----------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 환경 */ }
    },
  };

  // 예전 형식(100g 기준 값을 per100 / 최상위 필드에 저장)을 새 형식(base + nutr)으로 변환
  const pickNutr = src => Object.fromEntries(NUTRIENT_KEYS.map(k => [k, Number(src?.[k]) || 0]));
  function migrateFood(f) {
    if (f.nutr) return f;
    return { id: f.id, name: f.name, cat: f.cat, serving: f.serving, unit: f.unit, base: 100, nutr: pickNutr(f) };
  }
  function migrateEntry(e) {
    if (e.nutr) return e;
    return {
      foodId: e.foodId, name: e.name, cat: e.cat, serving: e.serving, unit: e.unit,
      grams: e.grams, base: 100, nutr: pickNutr(e.per100),
    };
  }
  function migrateDiary(d) {
    Object.values(d).forEach(day => {
      Object.keys(day.meals || {}).forEach(m => { day.meals[m] = day.meals[m].map(migrateEntry); });
    });
    return d;
  }

  let diary = migrateDiary(store.get(KEYS.diary, {}));
  let customFoods = store.get(KEYS.custom, []).map(migrateFood);
  let target = store.get(KEYS.target, 2000);
  let weight = store.get(KEYS.weight, 69);
  let currentDate = toDateStr(new Date());
  let pendingCustomMeal = null; // 직접 등록 후 바로 추가할 식사

  // ---------- 유틸 ----------
  function toDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function shiftDate(s, days) {
    const d = parseDate(s);
    d.setDate(d.getDate() + days);
    return toDateStr(d);
  }
  const round = (n, digits = 0) => {
    const p = 10 ** digits;
    return Math.round(n * p) / p;
  };
  const fmtAmount = (v, unit) => `${(unit === 'g' ? round(v, 1) : round(v)).toLocaleString()}${unit}`;
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  // 초성 검색 (예: ㄷㄱㅅ → 닭가슴살)
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  function toChosung(str) {
    return [...str].map(ch => {
      const code = ch.charCodeAt(0) - 0xac00;
      return code >= 0 && code < 11172 ? CHO[Math.floor(code / 588)] : ch;
    }).join('');
  }

  // ---------- 영양 계산 ----------
  // 영양성분은 기준량(base g) 당 값 → 먹은 양(grams)에 비례해서 계산
  function calc(item, grams) {
    const ratio = grams / (item.base || 100);
    const out = {};
    NUTRIENT_KEYS.forEach(k => { out[k] = (item.nutr[k] || 0) * ratio; });
    return out;
  }
  const entryNutrition = e => calc(e, e.grams);

  function sumEntries(entries) {
    const total = Object.fromEntries(NUTRIENT_KEYS.map(k => [k, 0]));
    entries.forEach(e => {
      const n = entryNutrition(e);
      NUTRIENT_KEYS.forEach(k => { total[k] += n[k]; });
    });
    return total;
  }

  // ---------- 데이터 ----------
  const allFoods = () => [...customFoods, ...window.FOODS];

  function getDay(date = currentDate) {
    return diary[date] || { meals: {}, memo: '' };
  }
  function ensureDay() {
    if (!diary[currentDate]) diary[currentDate] = { meals: {}, memo: '' };
    const day = diary[currentDate];
    MEALS.forEach(m => { day.meals[m.id] ||= []; });
    return day;
  }
  function saveDiary() {
    const day = diary[currentDate];
    if (day && !day.memo && MEALS.every(m => !(day.meals[m.id] || []).length)) {
      delete diary[currentDate];
    }
    store.set(KEYS.diary, diary);
  }
  function dayEntries(date = currentDate) {
    const day = getDay(date);
    return MEALS.flatMap(m => day.meals[m.id] || []);
  }

  function addEntry(mealId, food, grams) {
    const day = ensureDay();
    const serving = food.serving || food.base || 100;
    day.meals[mealId].push({
      foodId: food.id,
      name: food.name,
      cat: food.cat,
      base: food.base || 100,
      serving,
      unit: food.unit,
      grams: grams ?? serving,
      nutr: { ...food.nutr },
    });
    saveDiary();
    renderMeal(mealId);
    renderSummary();
  }

  // ---------- 검색 ----------
  function searchFoods(query) {
    const q = query.replace(/\s+/g, '').toLowerCase();
    if (!q) return [];
    const choOnly = /^[ㄱ-ㅎ]+$/.test(q);
    const scored = [];
    for (const f of allFoods()) {
      const name = f.name.replace(/\s+/g, '').toLowerCase();
      const hay = choOnly ? toChosung(name) : name;
      let idx = hay.indexOf(q);
      if (idx < 0 && !choOnly && f.cat.includes(q)) idx = 100; // 분류명으로도 검색
      if (idx >= 0) scored.push({ f, score: idx * 100 + name.length });
    }
    return scored.sort((a, b) => a.score - b.score).slice(0, 15).map(s => s.f);
  }

  // 식약처 식품영양성분 DB (server.js를 통해 호출)
  const api = {
    enabled: false,
    cache: new Map(),
    async init() {
      if (location.protocol === 'file:') return;
      try {
        const res = await fetch('/api/status');
        this.enabled = (await res.json()).enabled === true;
      } catch { this.enabled = false; }
    },
    async search(q) {
      if (this.cache.has(q)) return this.cache.get(q);
      try {
        const res = await fetch('/api/foods?q=' + encodeURIComponent(q));
        const data = await res.json();
        if (!res.ok) return { error: data.error || '연결 실패' };
        this.cache.set(q, data.items);
        return data.items;
      } catch {
        return { error: '서버에 연결할 수 없어요' };
      }
    },
  };

  function renderApiStatus() {
    const status = $('#apiStatus');
    if (api.enabled) {
      status.textContent = '● 식약처 식품영양성분 DB 연결됨';
      status.className = 'api-status on';
    } else if (location.protocol === 'file:') {
      status.textContent = '○ 기본 음식 데이터만 사용 중 (start.bat으로 실행하면 식약처 DB 검색 가능)';
      status.className = 'api-status';
    } else {
      status.textContent = '○ 식약처 DB 미연결 (.env에 인증키를 넣고 서버를 다시 실행하세요)';
      status.className = 'api-status';
    }
  }

  function setupSearch(section, mealId) {
    const input = $('.search-input', section);
    const list = $('.results', section);
    let items = [];
    let active = -1;
    let timer = null;
    let seq = 0;

    const close = () => { list.classList.remove('open'); active = -1; };
    const options = () => list.querySelectorAll('li[data-idx]');
    const highlight = () => {
      options().forEach((li, i) => li.classList.toggle('active', i === active));
      options()[active]?.scrollIntoView({ block: 'nearest' });
    };
    const choose = i => {
      const item = items[i];
      if (!item) return;
      if (item.custom) {
        openCustomDialog(input.value.trim(), mealId);
      } else {
        addEntry(mealId, item.food);
      }
      input.value = '';
      close();
      input.focus();
    };

    // remote: null(사용 안 함) | 'loading' | 음식 배열 | { error }
    const render = (q, local, remote) => {
      list.replaceChildren();
      items = [];

      const addOption = (item, ...content) => {
        const li = el('li');
        li.setAttribute('role', 'option');
        li.dataset.idx = items.length;
        const i = items.length;
        items.push(item);
        li.append(...content);
        li.addEventListener('mousedown', e => { e.preventDefault(); choose(i); });
        list.append(li);
      };
      const addFood = f => {
        const left = el('span');
        left.append(el('span', 'r-name', f.name), el('span', 'r-cat', f.cat));
        const serving = f.serving || f.base;
        const kcal = round(calc(f, serving).kcal);
        addOption({ food: f }, left, el('span', 'r-meta', `${f.unit || ''} ${serving}g · ${kcal}kcal`));
      };

      local.forEach(addFood);

      if (remote) {
        let label;
        if (remote === 'loading') label = '식약처 DB 검색 중…';
        else if (remote.error) label = `식약처 DB: ${remote.error}`;
        else label = remote.length ? `식약처 식품영양성분 DB · ${remote.length}건` : '식약처 DB · 검색 결과 없음';
        list.append(el('li', 'r-group', label));
        if (Array.isArray(remote)) remote.forEach(addFood);
      }

      addOption({ custom: true }, el('span', 'r-custom', `＋ '${q}' 직접 등록하기`));

      if (active < 0 || active >= items.length) active = items.length > 1 ? 0 : -1;
      highlight();
      list.classList.add('open');
    };

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(timer);
      seq++;
      active = -1;
      if (!q) { list.replaceChildren(); return close(); }

      const local = searchFoods(q);
      const useApi = api.enabled && !/^[ㄱ-ㅎ]+$/.test(q.replace(/\s+/g, ''));
      render(q, local, useApi ? 'loading' : null);
      if (!useApi) return;

      const mySeq = seq;
      timer = setTimeout(async () => {
        const remote = await api.search(q);
        if (mySeq === seq) render(q, local, remote);
      }, 350);
    });

    input.addEventListener('keydown', e => {
      if (!list.classList.contains('open')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); highlight(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); highlight(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') { close(); }
    });
    input.addEventListener('blur', close);
  }

  // ---------- 렌더링: 식사 ----------
  const mealSections = {};

  function buildMeals() {
    const tpl = $('#mealTpl');
    const wrap = $('#meals');
    MEALS.forEach(m => {
      const section = tpl.content.firstElementChild.cloneNode(true);
      section.dataset.meal = m.id;
      $('.meal-icon', section).textContent = m.icon;
      $('.meal-name', section).textContent = m.label;
      setupSearch(section, m.id);
      wrap.append(section);
      mealSections[m.id] = section;
    });
  }

  function fillMacro(node, n) {
    const g = v => `${round(v, 1)}g`;
    node.innerHTML =
      `<span><b class="c">탄</b> ${g(n.carb)} <small>(당 ${g(n.sugar)} · 섬유 ${g(n.fiber)})</small></span>` +
      `<span><b class="p">단</b> ${g(n.protein)}</span>` +
      `<span><b class="f">지</b> ${g(n.fat)} <small>(포화 ${g(n.satfat)} · 트랜스 ${g(n.transfat)} · 콜 ${round(n.cholesterol)}mg)</small></span>`;
  }

  function renderMeal(mealId) {
    const section = mealSections[mealId];
    const entries = getDay().meals[mealId] || [];
    const list = $('.entries', section);
    list.replaceChildren();

    entries.forEach((entry, idx) => {
      const li = el('li', 'entry');

      // 1줄: 이름 · 계산된 열량 · 삭제
      const top = el('div', 'entry-top');
      const name = el('div', 'entry-name', entry.name);
      if (entry.cat) name.append(el('small', null, entry.cat));
      const kcal = el('div', 'entry-kcal');
      const del = el('button', 'entry-del', '×');
      del.setAttribute('aria-label', `${entry.name} 삭제`);
      del.addEventListener('click', () => {
        ensureDay().meals[mealId].splice(idx, 1);
        saveDiary();
        renderMeal(mealId);
        renderSummary();
      });
      top.append(name, kcal, del);

      // 2줄: 영양성분 기준량 / 1회 제공량
      const ref = el('div', 'entry-ref');
      ref.append(
        el('span', 'tag', `기준량 ${entry.base}g당 ${round(entry.nutr.kcal)}kcal`),
        el('span', 'tag', `1회 제공량 ${entry.unit ? entry.unit + ' ' : ''}${entry.serving}g`),
      );

      // 3줄: 먹은 양 입력 + 인분 빠른 선택
      const amount = el('div', 'entry-amount');
      const gramsLabel = el('label', 'entry-grams', '먹은 양');
      const gramsInput = el('input');
      gramsInput.type = 'number';
      gramsInput.min = '0';
      gramsInput.step = 'any';
      gramsInput.value = entry.grams;
      gramsLabel.append(gramsInput, 'g');

      const chips = el('div', 'chips');
      [0.5, 1, 1.5, 2].forEach(mult => {
        const chip = el('button', 'chip', mult === 0.5 ? '½' : String(mult));
        chip.type = 'button';
        chip.title = `${mult}인분 = ${round(entry.serving * mult, 1)}g`;
        chip.addEventListener('click', () => {
          gramsInput.value = round(entry.serving * mult, 1);
          update();
        });
        chips.append(chip);
      });
      chips.append(el('span', 'chip-unit', '인분'));
      const portion = el('span', 'entry-portion');
      amount.append(gramsLabel, chips, portion);

      // 4줄: 세부 영양성분
      const macro = el('div', 'entry-macro');

      const paint = () => {
        const n = entryNutrition(entry);
        kcal.textContent = `${round(n.kcal)} kcal`;
        portion.textContent = `= ${round(entry.grams / entry.serving, 2)}인분`;
        fillMacro(macro, n);
      };
      // 먹은 양 수정 시 실시간 반영 (입력 포커스 유지를 위해 행 전체를 다시 그리지 않음)
      const update = () => {
        entry.grams = Math.max(0, Number(gramsInput.value) || 0);
        paint();
        saveDiary();
        updateMealKcal(mealId);
        renderSummary();
      };
      gramsInput.addEventListener('input', update);
      paint();

      li.append(top, ref, amount, macro);
      list.append(li);
    });

    section.classList.toggle('has-entries', entries.length > 0);
    updateMealKcal(mealId);
  }

  function updateMealKcal(mealId) {
    const total = sumEntries(getDay().meals[mealId] || []);
    $('.meal-kcal', mealSections[mealId]).textContent = `${round(total.kcal)} kcal`;
  }

  // ---------- 렌더링: 요약 ----------
  function renderSummary() {
    const entries = dayEntries();
    const total = sumEntries(entries);

    $('#totalKcal').textContent = round(total.kcal).toLocaleString();

    // 탄단지 열량 비율
    const macroKcal = MACROS.map(m => total[m.key] * m.kcalPerG);
    const macroSum = macroKcal.reduce((a, b) => a + b, 0);
    const pct = macroKcal.map(k => (macroSum ? (k / macroSum) * 100 : 0));

    const donut = $('#donut');
    if (macroSum > 0) {
      let acc = 0;
      const stops = MACROS.map((m, i) => {
        const start = acc;
        acc += pct[i];
        return `${m.color} ${start}% ${acc}%`;
      });
      donut.style.background = `conic-gradient(${stops.join(', ')})`;
    } else {
      donut.style.background = '';
    }

    const legend = $('#legend');
    legend.replaceChildren();
    MACROS.forEach((m, i) => {
      const li = el('li');
      const dot = el('span', 'dot');
      dot.style.background = m.color;

      const name = el('span', 'l-name', m.label);
      name.append(el('small', null, `${round(total[m.key], 1)}g`));

      const val = el('span', 'l-val', `${round(pct[i])}%`);

      let status = '–', cls = '';
      if (macroSum > 0) {
        const [lo, hi] = m.guide;
        if (pct[i] < lo) { status = '부족'; cls = 'low'; }
        else if (pct[i] > hi) { status = '과다'; cls = 'high'; }
        else { status = '적정'; cls = 'ok'; }
      }
      const badge = el('span', `badge ${cls}`, status);
      badge.title = `목표 ${m.guide[0]}–${m.guide[1]}%`;

      li.append(dot, name, val, badge);
      legend.append(li);
    });

    // 목표 열량
    const ratio = target > 0 ? total.kcal / target : 0;
    const bar = $('#progressBar');
    bar.style.width = `${Math.min(ratio, 1) * 100}%`;
    bar.classList.toggle('over', ratio > 1);
    const diff = round(target - total.kcal);
    $('#targetText').textContent = diff >= 0
      ? `목표까지 ${diff.toLocaleString()} kcal 남았어요 (${round(ratio * 100)}%)`
      : `목표보다 ${(-diff).toLocaleString()} kcal 더 먹었어요 (${round(ratio * 100)}%)`;

    renderGoals(total);
    renderNutriTable(total, entries.length);
    renderWeek();
  }

  const proteinGoal = () => round(weight * PROTEIN_PER_KG, 1);

  // 단백질 · 지방 하루 목표량(g) 달성 현황
  function renderGoals(total) {
    const goals = [
      { key: 'protein', label: '단백질', range: [proteinGoal() * 0.9, proteinGoal() * 1.1], show: `${proteinGoal()}g`, max: proteinGoal(),
        note: `체중 ${weight}kg × ${PROTEIN_PER_KG}g` },
      { key: 'fat', label: '지방', range: FAT_RANGE, show: `${FAT_RANGE[0]}–${FAT_RANGE[1]}g`, max: FAT_RANGE[1], note: '고정 범위' },
    ];
    const list = $('#goals');
    list.replaceChildren();
    goals.forEach(g => {
      const eaten = total[g.key];
      const li = el('li');

      const head = el('div', 'goal-head');
      const name = el('span', 'goal-name', g.label);
      name.append(el('small', null, g.note));
      head.append(name, el('span', 'goal-val', `${round(eaten, 1)} / ${g.show}`));

      const meter = el('span', 'meter');
      const fill = el('span', 'meter-fill');
      fill.style.width = `${Math.min(eaten / g.max, 1) * 100}%`;
      meter.append(fill);

      let status = '부족', cls = 'low';
      if (eaten > g.range[1]) { status = '초과'; cls = 'high'; }
      else if (eaten >= g.range[0]) { status = '적정'; cls = 'ok'; }
      if (!eaten) { status = '–'; cls = ''; }
      const row = el('div', 'goal-bar');
      row.append(meter, el('span', `badge ${cls}`, status));

      li.append(head, row);
      list.append(li);
    });
  }

  function renderNutriTable(total, count) {
    const body = $('#nutriBody');
    body.replaceChildren();
    NUTRIENTS.forEach(n => {
      if (n.key === 'kcal') return;
      const tr = el('tr', n.sub ? 'sub' : 'main');
      tr.append(el('th', null, n.label), el('td', 'num', fmtAmount(total[n.key], n.unit)));

      const td = el('td', 'pct');
      const wrap = el('div', 'pct-wrap');
      td.append(wrap);
      // 단백질·지방은 개인 목표량(지방은 상한)을 기준으로 비교
      const dv = n.key === 'protein' ? proteinGoal() : n.key === 'fat' ? FAT_RANGE[1] : n.dv;
      if (dv) {
        const p = (total[n.key] / dv) * 100;
        const meter = el('span', 'meter');
        const fill = el('span', 'meter-fill');
        fill.style.width = `${Math.min(p, 100)}%`;
        meter.append(fill);
        const text = el('span', 'pct-text', `${round(p)}%`);
        if ((n.limit || n.key === 'fat') && p > 100) td.classList.add('over');
        wrap.append(meter, text);
      } else {
        wrap.append(el('span', 'pct-text', '–'));
      }
      tr.append(td);
      body.append(tr);
    });
    $('#countText').textContent = `${count}개 항목`;
  }

  function renderWeek() {
    const wrap = $('#week');
    wrap.replaceChildren();
    const days = Array.from({ length: 7 }, (_, i) => shiftDate(currentDate, i - 6));
    const kcals = days.map(d => sumEntries(dayEntries(d)).kcal);
    const max = Math.max(target, ...kcals, 1);

    days.forEach((d, i) => {
      const btn = el('button', 'week-day' + (d === currentDate ? ' current' : ''));
      btn.title = `${d} · ${round(kcals[i])} kcal`;
      const bar = el('div', 'week-bar' + (kcals[i] > 0 ? ' filled' : ''));
      bar.style.height = `${(kcals[i] / max) * 90}px`;
      const date = parseDate(d);
      btn.append(bar, el('span', 'week-label', `${date.getDate()}(${WEEKDAYS[date.getDay()]})`));
      btn.addEventListener('click', () => goTo(d));
      wrap.append(btn);
    });
  }

  function renderDate() {
    const d = parseDate(currentDate);
    $('#dateText').textContent = `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. (${WEEKDAYS[d.getDay()]})`;
    $('#datePicker').value = currentDate;
    $('#todayBtn').disabled = currentDate === toDateStr(new Date());
  }

  function renderAll() {
    renderDate();
    MEALS.forEach(m => renderMeal(m.id));
    $('#memo').value = getDay().memo || '';
    renderSummary();
  }

  function goTo(date) {
    currentDate = date;
    renderAll();
  }

  // ---------- 직접 등록 ----------
  const dialog = $('#customDialog');
  const form = $('#customForm');

  // 영양성분 입력칸은 NUTRIENTS 목록으로 생성
  NUTRIENTS.forEach(n => {
    const label = el('label', n.sub ? 'sub' : null, `${n.sub ? '└ ' : ''}${n.label} (${n.unit})`);
    const input = el('input');
    input.name = n.key;
    input.type = 'number';
    input.min = '0';
    input.step = 'any';
    if (n.key === 'kcal') input.placeholder = '비우면 자동 계산';
    label.append(input);
    $('#customNutri').append(label);
  });

  function readCustomForm() {
    const f = form.elements;
    const v = k => Number(f[k].value) || 0;
    const base = v('base') || 100;
    const serving = v('serving') || base;
    const nutr = Object.fromEntries(NUTRIENT_KEYS.map(k => [k, v(k)]));
    const autoKcal = f.kcal.value === '';
    if (autoKcal) nutr.kcal = round(nutr.carb * 4 + nutr.protein * 4 + nutr.fat * 9, 1);
    const grams = Number(f.grams.value) || serving;
    return { base, serving, unit: f.unit.value.trim(), nutr, grams, autoKcal };
  }

  function updateCustomCalc() {
    const d = readCustomForm();
    form.elements.grams.placeholder = d.serving;
    const grams = pendingCustomMeal ? d.grams : d.serving;
    const n = calc(d, grams);
    $('#customCalc').textContent =
      `${pendingCustomMeal ? '먹은 양' : '1회 제공량'} ${round(grams, 1)}g → ` +
      `${round(n.kcal)} kcal · 탄 ${round(n.carb, 1)}g · 단 ${round(n.protein, 1)}g · 지 ${round(n.fat, 1)}g` +
      (d.autoKcal ? ' (열량 자동 계산)' : '');
  }

  function openCustomDialog(name = '', mealId = null) {
    form.reset();
    form.elements.name.value = name;
    pendingCustomMeal = mealId;
    $('#eatenField').hidden = !mealId;
    updateCustomCalc();
    dialog.showModal();
    (name ? form.elements.base : form.elements.name).focus();
  }

  form.addEventListener('input', updateCustomCalc);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const d = readCustomForm();
    const food = {
      id: 'c' + Date.now(),
      name: form.elements.name.value.trim(),
      cat: '내 음식',
      base: d.base,
      serving: d.serving,
      unit: d.unit || '1회',
      nutr: d.nutr,
    };
    customFoods.unshift(food);
    store.set(KEYS.custom, customFoods);
    dialog.close();
    if (pendingCustomMeal) addEntry(pendingCustomMeal, food, d.grams);
    pendingCustomMeal = null;
  });
  $('#cancelCustom').addEventListener('click', () => dialog.close());

  // ---------- 내 음식 관리 ----------
  const manageDialog = $('#manageDialog');

  function renderMyFoods() {
    const list = $('#myFoods');
    list.replaceChildren();
    customFoods.forEach(food => {
      const li = el('li');
      const info = el('div', 'my-food-info');
      info.append(el('div', 'my-food-name', food.name));
      const servingKcal = round(calc(food, food.serving).kcal);
      info.append(el('div', 'my-food-meta',
        `기준량 ${food.base}g당 ${round(food.nutr.kcal)}kcal · 1회 제공량 ${food.unit ? food.unit + ' ' : ''}${food.serving}g (${servingKcal}kcal)`));

      const del = el('button', 'ghost-btn danger-btn', '삭제');
      del.type = 'button';
      del.addEventListener('click', () => {
        if (!confirm(`'${food.name}'을(를) 내 음식에서 삭제할까요?`)) return;
        customFoods = customFoods.filter(f => f.id !== food.id);
        store.set(KEYS.custom, customFoods);
        renderMyFoods();
      });

      li.append(info, del);
      list.append(li);
    });
    $('#myFoodsEmpty').hidden = customFoods.length > 0;
  }

  $('#manageCustomBtn').addEventListener('click', () => {
    renderMyFoods();
    manageDialog.showModal();
  });
  $('#closeManage').addEventListener('click', () => manageDialog.close());

  // ---------- 백업 ----------
  $('#exportBtn').addEventListener('click', () => {
    const data = JSON.stringify({ diary, customFoods, target }, null, 2);
    const a = el('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `식단일기_${toDateStr(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#importInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.diary) throw new Error('형식 오류');
      if (!confirm('백업 데이터를 불러올까요? 같은 날짜의 기록은 백업 내용으로 바뀝니다.')) return;
      diary = { ...diary, ...migrateDiary(data.diary) };
      const ids = new Set(customFoods.map(f => f.id));
      customFoods = [...customFoods, ...(data.customFoods || []).map(migrateFood).filter(f => !ids.has(f.id))];
      if (data.target) target = data.target;
      store.set(KEYS.diary, diary);
      store.set(KEYS.custom, customFoods);
      store.set(KEYS.target, target);
      $('#targetInput').value = target;
      renderAll();
    } catch {
      alert('백업 파일을 읽을 수 없어요.');
    }
  });

  // ---------- 이벤트 ----------
  $('#prevDay').addEventListener('click', () => goTo(shiftDate(currentDate, -1)));
  $('#nextDay').addEventListener('click', () => goTo(shiftDate(currentDate, 1)));
  $('#todayBtn').addEventListener('click', () => goTo(toDateStr(new Date())));
  $('#datePicker').addEventListener('change', e => { if (e.target.value) goTo(e.target.value); });
  $('#addCustomBtn').addEventListener('click', () => openCustomDialog());

  $('#memo').addEventListener('input', e => {
    ensureDay().memo = e.target.value;
    saveDiary();
  });

  const targetInput = $('#targetInput');
  targetInput.value = target;
  targetInput.addEventListener('input', () => {
    const v = Number(targetInput.value);
    if (v > 0) {
      target = v;
      store.set(KEYS.target, target);
      renderSummary();
    }
  });

  const weightInput = $('#weightInput');
  weightInput.value = weight;
  weightInput.addEventListener('input', () => {
    const v = Number(weightInput.value);
    if (v > 0) {
      weight = v;
      store.set(KEYS.weight, weight);
      renderSummary();
    }
  });

  buildMeals();
  renderAll();
  renderApiStatus();
  api.init().then(renderApiStatus);
})();
