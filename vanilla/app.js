/* =========================================================
 * 다국어 복약지도 가이드 - 동작 스크립트
 * ========================================================= */
(function () {
  'use strict';

  const { DRUGS, UNITS, TIMINGS, GENERAL, UI } = window.RX_DATA;
  const LANGS = ['en', 'zh', 'ja'];
  const LOCALE = { ko: 'ko-KR', en: 'en-US', zh: 'zh-CN', ja: 'ja-JP' };
  const LANG_NAME = { en: 'English', zh: '中文', ja: '日本語' };

  const $ = (sel) => document.querySelector(sel);
  const el = {
    search: $('#drugSearch'), results: $('#drugResults'), selected: $('#selectedDrug'),
    customToggle: $('#customToggle'), customFields: $('#customFields'),
    customName: $('#customName'), customRoute: $('#customRoute'),
    qty: $('#qty'), unit: $('#unit'), freq: $('#freq'), timing: $('#timing'),
    days: $('#days'), interval: $('#interval'), maxDaily: $('#maxDaily'),
    fQty: $('#fQty'), fTiming: $('#fTiming'), fInterval: $('#fInterval'), fMax: $('#fMax'),
    previewKo: $('#previewKo'), general: $('#generalList'),
    addBtn: $('#addBtn'), cancelEditBtn: $('#cancelEditBtn'),
    list: $('#rxList'), listCount: $('#listCount'), clearBtn: $('#clearBtn'),
    tabs: document.querySelectorAll('.tabs button'), showKo: $('#showKo'),
    output: $('#output'), speakBtn: $('#speakBtn'), copyBtn: $('#copyBtn'), printBtn: $('#printBtn'),
    pharmacy: $('#pharmacyName'), toast: $('#toast')
  };

  const state = {
    drug: null,        // 선택된 DRUGS 항목
    custom: false,     // 직접 입력 모드
    list: [],          // 조제 목록
    editIndex: null,   // 수정 중인 항목 인덱스
    lang: 'en',
    showKo: true,
    activeIdx: -1      // 검색 결과 키보드 선택 위치
  };

  /* ---------------- 저장소 (실패해도 동작하도록) ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 무시 */ } }
  };

  /* ---------------- 유틸 ---------------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s·\-()/]/g, '');
  const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.toast.classList.remove('show'), 1800);
  }

  function option(value, text) {
    const o = document.createElement('option');
    o.value = value; o.textContent = text;
    return o;
  }

  /* ---------------- 폼 초기화 ---------------- */
  function buildForm() {
    Object.entries(UNITS).forEach(([k, u]) => el.unit.appendChild(option(k, u.label)));
    for (let n = 1; n <= 6; n++) el.freq.appendChild(option(String(n), `1일 ${n}회`));
    el.freq.appendChild(option('prn', '필요시 (증상이 있을 때)'));
    Object.entries(TIMINGS).forEach(([k, t]) => el.timing.appendChild(option(k, t.label)));
    el.days.appendChild(option('', '지정 안 함'));
    [1, 2, 3, 4, 5, 6, 7, 10, 14, 28, 30].forEach((d) => el.days.appendChild(option(d, `${d}일`)));
    el.interval.appendChild(option('', '지정 안 함'));
    [4, 6, 8, 12].forEach((h) => el.interval.appendChild(option(h, `${h}시간`)));
    el.maxDaily.appendChild(option('', '지정 안 함'));
    for (let n = 1; n <= 8; n++) el.maxDaily.appendChild(option(n, `${n}회`));

    el.general.innerHTML = Object.entries(GENERAL).map(([k, g]) =>
      `<label class="check"><input type="checkbox" value="${k}"><span>${esc(g.ko)}</span></label>`
    ).join('');

    resetForm();
  }

  function resetForm() {
    applyDefaults({ unit: 'tab', qty: 1, freq: '3', timing: 'after_30', days: '', interval: 4, max: '' }, []);
  }

  function applyDefaults(def, general) {
    el.unit.value = def.unit || 'tab';
    el.qty.value = def.qty || 1;
    el.freq.value = def.freq || '3';
    el.timing.value = def.timing || 'after_30';
    el.days.value = def.days != null ? String(def.days) : '';
    el.interval.value = def.interval != null ? String(def.interval) : '';
    el.maxDaily.value = def.max != null ? String(def.max) : '';
    el.general.querySelectorAll('input').forEach((c) => { c.checked = general.includes(c.value); });
    updateVisibility();
  }

  function currentRoute() {
    if (state.drug) return state.drug.route;
    if (state.custom) return el.customRoute.value;
    return 'oral';
  }

  function updateVisibility() {
    const route = currentRoute();
    const prn = el.freq.value === 'prn';
    el.fQty.hidden = route === 'topical';
    el.fTiming.hidden = route !== 'oral' || prn;
    el.fInterval.hidden = route !== 'oral' || !prn;
    el.fMax.hidden = !prn;
    if (route === 'eye') el.unit.value = 'drop';
    el.unit.disabled = route === 'eye';
    updatePreview();
  }

  /* ---------------- 검색 ---------------- */
  function searchDrugs(q) {
    const nq = norm(q);
    if (!nq) return DRUGS;
    return DRUGS.filter((d) => {
      const hay = [d.brand, d.brandEn, d.cat, d.ing.ko, d.ing.en, d.ing.zh, d.ing.ja, ...(d.aliases || [])];
      return hay.some((h) => norm(h).includes(nq));
    });
  }

  function renderResults() {
    const items = searchDrugs(el.search.value);
    state.activeIdx = -1;
    if (!items.length) {
      el.results.innerHTML = '<li class="empty">검색 결과가 없습니다. 아래 “직접 입력”을 이용하세요.</li>';
    } else {
      el.results.innerHTML = items.map((d) => `
        <li role="option" data-id="${d.id}">
          <div class="r-main"><strong>${esc(d.brand)}</strong><span class="badge">${esc(d.cat)}</span></div>
          <div class="r-sub">${esc(d.ing.ko)} · ${esc(d.ing.en)}</div>
        </li>`).join('');
    }
    el.results.hidden = false;
  }

  function moveActive(step) {
    const opts = el.results.querySelectorAll('li[data-id]');
    if (!opts.length) return;
    state.activeIdx = (state.activeIdx + step + opts.length) % opts.length;
    opts.forEach((o, i) => o.classList.toggle('active', i === state.activeIdx));
    opts[state.activeIdx].scrollIntoView({ block: 'nearest' });
  }

  function selectDrug(id) {
    const d = DRUGS.find((x) => x.id === id);
    if (!d) return;
    state.drug = d;
    state.custom = false;
    el.customFields.hidden = true;
    el.customToggle.textContent = '+ 목록에 없는 약 직접 입력';
    el.search.value = '';
    el.results.hidden = true;
    renderSelected();
    applyDefaults(d.def, d.general || []);
  }

  function renderSelected() {
    const d = state.drug;
    if (!d) { el.selected.hidden = true; el.selected.innerHTML = ''; return; }
    const warnHtml = d.warn.length
      ? `<ul>${d.warn.map((w) => `<li>${esc(w.ko)}</li>`).join('')}</ul>` : '';
    el.selected.innerHTML = `
      <div class="sd-head">
        <div>
          <strong>${esc(d.brand)}</strong>
          <span class="badge">${esc(d.cat)}</span>
          <div class="sd-ing">${esc(d.ing.ko)} · ${esc(d.ing.en)}</div>
        </div>
        <button type="button" class="icon-btn" id="clearDrug" aria-label="선택 해제">✕</button>
      </div>
      <div class="sd-use"><b>효능</b> ${esc(d.use.ko)}</div>
      ${warnHtml ? `<div class="sd-warn"><b>약품별 주의사항 (자동 포함)</b>${warnHtml}</div>` : ''}`;
    el.selected.hidden = false;
    $('#clearDrug').addEventListener('click', () => { state.drug = null; renderSelected(); resetForm(); });
  }

  /* ---------------- 문장 생성 ---------------- */
  function qtyText(q, unitKey, lang) {
    const u = UNITS[unitKey];
    if (q === 0.5 && u.half) return u.half[lang];
    const n = fmtNum(q);
    if (lang === 'en') return `${n} ${q <= 1 ? u.en[0] : u.en[1]}`;
    return `${n}${u[lang]}`;
  }

  function freqText(n, lang) {
    if (lang === 'ko') return `1일 ${n}회`;
    if (lang === 'zh') return `每日${n}次`;
    if (lang === 'ja') return `1日${n}回`;
    return n === 1 ? 'once a day' : n === 2 ? 'twice a day' : `${n} times a day`;
  }

  function timingText(key, n, lang) {
    const t = TIMINGS[key];
    if (lang === 'en' && n === 1 && t.en1) return t.en1;
    return t[lang];
  }

  const S = {
    oral: {
      ko: (f, q, t, d) => `${f}, 1회 ${q}씩 ${t} ${d ? `${d}일간 ` : ''}복용하세요.`,
      en: (f, q, t, d) => `Take ${q} ${f}, ${t}${d ? `, for ${d} ${d > 1 ? 'days' : 'day'}` : ''}.`,
      zh: (f, q, t, d) => `${f}，每次${q}，${t}服用${d ? `，连续服用${d}天` : ''}。`,
      ja: (f, q, t, d) => `${f}、1回${q}を${t}${d ? `、${d}日間` : ''}服用してください。`
    },
    oralPrn: {
      ko: (q) => `증상이 있을 때 1회 ${q}씩 복용하세요.`,
      en: (q) => `Take ${q} when needed (when you have symptoms).`,
      zh: (q) => `有症状时服用，每次${q}。`,
      ja: (q) => `症状がある時に1回${q}を服用してください。`
    },
    eye: {
      ko: (f, q) => `${f}, 1회 ${q}씩 눈에 점안하세요.`,
      en: (f, q) => `Put ${q} in the affected eye(s) ${f}.`,
      zh: (f, q) => `${f}，每次${q}，滴入患眼。`,
      ja: (f, q) => `${f}、1回${q}を点眼してください。`
    },
    eyePrn: {
      ko: (q) => `필요할 때 1회 ${q}씩 눈에 점안하세요.`,
      en: (q) => `Put ${q} in the affected eye(s) when needed.`,
      zh: (q) => `需要时滴入患眼，每次${q}。`,
      ja: (q) => `必要な時に1回${q}を点眼してください。`
    },
    topical: {
      ko: (f) => `${f}, 환부에 적당량을 얇게 바르세요.`,
      en: (f) => `Apply a thin layer to the affected area ${f}.`,
      zh: (f) => `${f}，取适量薄涂于患处。`,
      ja: (f) => `${f}、適量を患部に薄く塗ってください。`
    },
    topicalPrn: {
      ko: () => '필요할 때 환부에 적당량을 얇게 바르세요.',
      en: () => 'Apply a thin layer to the affected area when needed.',
      zh: () => '需要时取适量薄涂于患处。',
      ja: () => '必要な時に適量を患部に薄く塗ってください。'
    },
    interval: {
      ko: (h) => `복용 간격은 최소 ${h}시간 이상 두세요.`,
      en: (h) => `Wait at least ${h} hours between doses.`,
      zh: (h) => `两次服药至少间隔${h}小时。`,
      ja: (h) => `服用間隔は${h}時間以上あけてください。`
    },
    max: {
      ko: (m) => `하루 ${m}회를 넘기지 마세요.`,
      en: (m) => (m === 1 ? 'Do not use more than once a day.' : `Do not use more than ${m} times a day.`),
      zh: (m) => `每日不超过${m}次。`,
      ja: (m) => `1日${m}回までにしてください。`
    },
    supply: {
      ko: (d) => `${d}일분입니다.`,
      en: (d) => `This is a ${d}-day supply.`,
      zh: (d) => `本次为${d}天的用量。`,
      ja: (d) => `${d}日分です。`
    },
    useFor: {
      ko: (d) => `${d}일간 사용하세요.`,
      en: (d) => `Use for ${d} ${d > 1 ? 'days' : 'day'}.`,
      zh: (d) => `连续使用${d}天。`,
      ja: (d) => `${d}日間使用してください。`
    }
  };

  function directions(it, lang) {
    const out = [];
    const prn = it.freq === 'prn';
    const n = prn ? 0 : Number(it.freq);
    const q = qtyText(it.qty, it.unit, lang);

    if (it.route === 'oral') {
      if (prn) {
        out.push(S.oralPrn[lang](q));
        if (it.interval) out.push(S.interval[lang](it.interval));
      } else {
        out.push(S.oral[lang](freqText(n, lang), q, timingText(it.timing, n, lang), it.days));
      }
    } else if (it.route === 'eye') {
      out.push(prn ? S.eyePrn[lang](q) : S.eye[lang](freqText(n, lang), q));
    } else {
      out.push(prn ? S.topicalPrn[lang]() : S.topical[lang](freqText(n, lang)));
    }

    if (prn && it.max) out.push(S.max[lang](it.max));
    if (it.days && (prn || it.route !== 'oral')) {
      out.push(prn && it.route === 'oral' ? S.supply[lang](it.days) : S.useFor[lang](it.days));
    }
    return out;
  }

  function cautions(it, lang) {
    const d = it.drugId ? DRUGS.find((x) => x.id === it.drugId) : null;
    const list = d ? d.warn.map((w) => ({ t: w[lang], ko: w.ko })) : [];
    it.general.forEach((g) => list.push({ t: GENERAL[g][lang], ko: GENERAL[g].ko }));
    return list;
  }

  /* ---------------- 구어체 복약지도 스크립트 ---------------- */
  const KO_NATIVE = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];
  const ORD = {
    ko: ['첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'],
    en: ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'],
    zh: ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  };
  const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

  // 한국어 구어: "한 알", "두 포", "반 알"
  function koSpokenQty(q, unitKey) {
    if (unitKey === 'ml') return `${fmtNum(q)}mL`;
    const word = { tab: '알', cap: '캡슐', pkt: '포', drop: '방울' }[unitKey];
    if (q === 0.5) return `반 ${word}`;
    if (Number.isInteger(q) && q <= 10) return `${KO_NATIVE[q]} ${word}`;
    return `${fmtNum(q)}${word}`;
  }

  function spokenFreq(n, lang) {
    if (lang === 'ko') return `하루 ${KO_NATIVE[n] || n} 번`;
    if (lang === 'zh') return `一天${n}次`;
    if (lang === 'ja') return `1日${n}回`;
    return freqText(n, 'en');
  }

  const SP = {
    open: {
      ko: (oral) => `안녕하세요. 약 ${oral ? '드시는' : '사용하시는'} 방법을 설명해 드릴게요.`,
      en: (oral) => `Hello. Let me explain how to ${oral ? 'take' : 'use'} your medicine.`,
      zh: (oral) => `您好，我来跟您说明一下这些药怎么${oral ? '吃' : '用'}。`,
      ja: (oral) => `こんにちは。お薬の${oral ? '飲み方' : '使い方'}をご説明しますね。`
    },
    count: {
      ko: (n) => `오늘 드리는 약은 모두 ${n}가지입니다.`,
      en: (n) => `You have ${n} medicines today.`,
      zh: (n) => `今天一共有${n}种药。`,
      ja: (n) => `今日のお薬は全部で${n}種類です。`
    },
    intro: {
      ko: (i, n, name) => (n === 1 ? `이 약은 ${name}입니다.` : `${ORD.ko[i] || i + 1} 번째 약은 ${name}입니다.`),
      en: (i, n, name) => (n === 1 ? `This medicine is ${name}.` : `The ${ORD.en[i] || `number ${i + 1}`} medicine is ${name}.`),
      zh: (i, n, name) => (n === 1 ? `这个药是${name}。` : `第${ORD.zh[i] || i + 1}种药是${name}。`),
      ja: (i, n, name) => (n === 1 ? `こちらのお薬は${name}です。` : `${i < 9 ? `${i + 1}つ目` : `${i + 1}番目`}のお薬は${name}です。`)
    },
    purpose: {
      ko: (u) => `${u}에 쓰는 약이에요.`,
      en: (u) => `It's for ${lcFirst(u)}.`,
      zh: (u) => `主要用于${u}。`,
      ja: (u) => `${u}のお薬です。`
    },
    oral: {
      ko: (f, q, tk) => `${f}, 한 번에 ${q}씩 ${TIMINGS[tk].ko} 드세요.`,
      en: (f, q, tk, n) => `Please take ${q} ${f}, ${timingText(tk, n, 'en')}.`,
      zh: (f, q, tk) => (tk === 'anytime' ? `${f}，每次${q}，什么时间吃都可以。` : `${f}，每次${q}，${TIMINGS[tk].zh}吃。`),
      ja: (f, q, tk) => `${f}、1回${q}ずつ、${TIMINGS[tk].ja}飲んでください。`
    },
    oralPrn: {
      ko: (q) => `증상이 있을 때만 한 번에 ${q}씩 드세요.`,
      en: (q) => `Please take ${q} only when you have symptoms.`,
      zh: (q) => `有症状的时候再吃，每次${q}。`,
      ja: (q) => `症状がある時だけ、1回${q}飲んでください。`
    },
    eye: {
      ko: (f, q) => `${f}, 한 번에 ${q}씩 눈에 넣어 주세요.`,
      en: (f, q) => `Please put ${q} in your eye(s) ${f}.`,
      zh: (f, q) => `${f}，每次${q}，滴在眼睛里。`,
      ja: (f, q) => `${f}、1回${q}ずつ点眼してください。`
    },
    eyePrn: {
      ko: (q) => `필요할 때 한 번에 ${q}씩 눈에 넣어 주세요.`,
      en: (q) => `Please put ${q} in your eye(s) whenever you need to.`,
      zh: (q) => `需要的时候滴，每次${q}。`,
      ja: (q) => `必要な時に1回${q}ずつ点眼してください。`
    },
    topical: {
      ko: (f) => `${f}, 아픈 부위에 얇게 발라 주세요.`,
      en: (f) => `Please apply a thin layer to the affected area ${f}.`,
      zh: (f) => `${f}，在患处薄薄地涂一层。`,
      ja: (f) => `${f}、患部に薄く塗ってください。`
    },
    topicalPrn: {
      ko: () => '필요할 때 아픈 부위에 얇게 발라 주세요.',
      en: () => 'Please apply a thin layer to the affected area whenever you need to.',
      zh: () => '需要的时候在患处薄薄地涂一层。',
      ja: () => '必要な時に患部に薄く塗ってください。'
    },
    interval: {
      ko: (h) => `한 번 드시면 다음 복용까지 최소 ${h}시간은 간격을 두세요.`,
      en: (h) => `Wait at least ${h} hours before taking another dose.`,
      zh: (h) => `两次之间至少要隔${h}个小时。`,
      ja: (h) => `次に飲むまで${h}時間以上あけてください。`
    },
    max: {
      ko: (m, oral) => `하루에 ${KO_NATIVE[m] || m} 번까지만 ${oral ? '드세요' : '사용하세요'}.`,
      en: (m, oral) => `Please ${oral ? 'take' : 'use'} it no more than ${m === 1 ? 'once' : `${m} times`} a day.`,
      zh: (m, oral) => `一天最多${oral ? '吃' : '用'}${m}次。`,
      ja: (m) => `1日${m}回までにしてください。`
    },
    supply: {
      ko: (d) => `${d}일분 드렸어요.`,
      en: (d) => `I've given you enough for ${d} ${d > 1 ? 'days' : 'day'}.`,
      zh: (d) => `这里是${d}天的量。`,
      ja: (d) => `${d}日分お出ししています。`
    },
    useFor: {
      ko: (d) => `${d}일 동안 사용하세요.`,
      en: (d) => `Please use it for ${d} ${d > 1 ? 'days' : 'day'}.`,
      zh: (d) => `请连续用${d}天。`,
      ja: (d) => `${d}日間使ってください。`
    },
    cautionIntro: {
      ko: '그리고 주의하실 점이 있어요.',
      en: 'Also, please keep these points in mind.',
      zh: '另外，有几点需要注意。',
      ja: 'それから、注意していただきたいことがあります。'
    },
    close: {
      ko: ['궁금한 점 있으시면 편하게 물어보세요.', '몸조리 잘 하시고, 빨리 나으세요.'],
      en: ['If you have any questions, feel free to ask me.', 'Take care, and I hope you feel better soon.'],
      zh: ['如果有什么不清楚的，请随时问我。', '请多保重，祝您早日康复！'],
      ja: ['ご不明な点があれば、お気軽にお尋ねください。', 'どうぞお大事になさってください。']
    }
  };

  function spokenDirections(it, lang) {
    const out = [];
    const prn = it.freq === 'prn';
    const n = prn ? 0 : Number(it.freq);
    const q = lang === 'ko' ? koSpokenQty(it.qty, it.unit) : qtyText(it.qty, it.unit, lang);
    const f = prn ? '' : spokenFreq(n, lang);

    if (it.route === 'oral') {
      if (prn) {
        out.push(SP.oralPrn[lang](q));
        if (it.interval) out.push(SP.interval[lang](it.interval));
      } else {
        out.push(SP.oral[lang](f, q, it.timing, n));
      }
    } else if (it.route === 'eye') {
      out.push(prn ? SP.eyePrn[lang](q) : SP.eye[lang](f, q));
    } else {
      out.push(prn ? SP.topicalPrn[lang]() : SP.topical[lang](f));
    }
    if (prn && it.max) out.push(SP.max[lang](it.max, it.route === 'oral'));
    if (it.days) out.push(it.route === 'oral' ? SP.supply[lang](it.days) : SP.useFor[lang](it.days));
    return out;
  }

  // 블록 단위 스크립트: [{ label, lines: [문장] }]
  function buildScript(lang) {
    const total = state.list.length;
    const allOral = state.list.every((it) => it.route === 'oral');
    const blocks = [];

    const opening = [SP.open[lang](allOral)];
    if (total > 1) opening.push(SP.count[lang](total));
    blocks.push({ label: '시작 인사', lines: opening });

    state.list.forEach((it, i) => {
      const d = it.drugId ? DRUGS.find((x) => x.id === it.drugId) : null;
      const name = d ? d.ing[lang] : it.customName;
      const lines = [SP.intro[lang](i, total, name)];
      if (d) lines.push(SP.purpose[lang](d.use[lang]));
      lines.push(...spokenDirections(it, lang));
      const cs = cautions(it, lang);
      if (cs.length) {
        lines.push(SP.cautionIntro[lang]);
        cs.forEach((c) => lines.push(c.t));
      }
      blocks.push({ label: `${i + 1}. ${itemTitle(it)}`, lines });
    });

    blocks.push({ label: '마무리', lines: SP.close[lang].slice() });
    return blocks;
  }

  /* ---------------- 현재 입력값 → 항목 ---------------- */
  function readForm() {
    const route = currentRoute();
    const qty = Math.max(0.5, Number(el.qty.value) || 1);
    return {
      drugId: state.drug ? state.drug.id : null,
      customName: state.custom ? el.customName.value.trim() : '',
      route,
      qty,
      unit: route === 'eye' ? 'drop' : el.unit.value,
      freq: el.freq.value,
      timing: el.timing.value,
      days: el.days.value ? Number(el.days.value) : null,
      interval: el.interval.value ? Number(el.interval.value) : null,
      max: el.maxDaily.value ? Number(el.maxDaily.value) : null,
      general: [...el.general.querySelectorAll('input:checked')].map((c) => c.value)
    };
  }

  function updatePreview() {
    const it = readForm();
    el.previewKo.textContent = '미리보기: ' + directions(it, 'ko').join(' ');
  }

  /* ---------------- 조제 목록 ---------------- */
  function itemTitle(it) {
    if (it.drugId) return DRUGS.find((x) => x.id === it.drugId).brand;
    return it.customName;
  }

  function addItem() {
    if (!state.drug && !state.custom) { toast('먼저 약을 선택하세요.'); el.search.focus(); return; }
    if (state.custom && !el.customName.value.trim()) { toast('약 이름을 입력하세요.'); el.customName.focus(); return; }

    const it = readForm();
    if (state.editIndex !== null) {
      state.list[state.editIndex] = it;
      toast('수정되었습니다.');
    } else {
      state.list.push(it);
      toast('목록에 추가되었습니다.');
    }
    endEdit();
    clearSelection();
    renderList();
    renderOutput();
  }

  function clearSelection() {
    state.drug = null;
    state.custom = false;
    el.customFields.hidden = true;
    el.customName.value = '';
    el.customToggle.textContent = '+ 목록에 없는 약 직접 입력';
    renderSelected();
    resetForm();
  }

  function startEdit(i) {
    const it = state.list[i];
    state.editIndex = i;
    if (it.drugId) {
      state.drug = DRUGS.find((x) => x.id === it.drugId);
      state.custom = false;
      el.customFields.hidden = true;
      renderSelected();
    } else {
      state.drug = null;
      state.custom = true;
      el.customFields.hidden = false;
      el.customName.value = it.customName;
      el.customRoute.value = it.route;
      renderSelected();
    }
    applyDefaults({
      unit: it.unit, qty: it.qty, freq: it.freq, timing: it.timing,
      days: it.days ?? '', interval: it.interval ?? '', max: it.max ?? ''
    }, it.general);
    el.addBtn.textContent = '수정 완료';
    el.cancelEditBtn.hidden = false;
    renderList();
    el.search.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function endEdit() {
    state.editIndex = null;
    el.addBtn.textContent = '목록에 추가';
    el.cancelEditBtn.hidden = true;
  }

  function renderList() {
    el.listCount.textContent = state.list.length;
    el.clearBtn.hidden = !state.list.length;
    if (!state.list.length) {
      el.list.innerHTML = '<li class="empty">아직 추가된 약이 없습니다.</li>';
      return;
    }
    el.list.innerHTML = state.list.map((it, i) => `
      <li class="${state.editIndex === i ? 'editing' : ''}">
        <div class="rx-info">
          <strong>${i + 1}. ${esc(itemTitle(it))}</strong>
          <span>${esc(directions(it, 'ko').join(' '))}</span>
        </div>
        <div class="rx-actions">
          <button type="button" data-act="up" data-i="${i}" aria-label="위로" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" data-act="edit" data-i="${i}">수정</button>
          <button type="button" data-act="del" data-i="${i}" class="danger">삭제</button>
        </div>
      </li>`).join('');
  }

  /* ---------------- 출력 ---------------- */
  function today(lang) {
    return new Date().toLocaleDateString(LOCALE[lang], { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function koLine(text) {
    return state.showKo ? `<span class="ko" lang="ko">${esc(text)}</span>` : '';
  }

  function renderGuide(lang) {
    const pharmacy = el.pharmacy.value.trim();
    const items = state.list.map((it, i) => {
      const d = it.drugId ? DRUGS.find((x) => x.id === it.drugId) : null;
      const name = d ? d.ing[lang] : it.customName;
      const sub = d ? `${d.brand} · ${d.brandEn}` : '';
      const dirs = directions(it, lang);
      const dirsKo = directions(it, 'ko');
      const cs = cautions(it, lang);
      return `
        <li class="g-item">
          <div class="g-name">
            <span class="g-idx">${i + 1}</span>
            <div>
              <strong>${esc(name)}</strong>
              ${sub ? `<small>${esc(UI.product[lang])}: ${esc(sub)}</small>` : ''}
              ${d ? koLine(d.ing.ko) : ''}
            </div>
          </div>
          <dl>
            ${d ? `<dt>${UI.purpose[lang]}</dt><dd><p>${esc(d.use[lang])}${koLine(d.use.ko)}</p></dd>` : ''}
            <dt>${UI.howto[lang]}</dt>
            <dd class="g-how">${dirs.map((s, k) => `<p>${esc(s)}${koLine(dirsKo[k])}</p>`).join('')}</dd>
            ${cs.length ? `<dt>${UI.caution[lang]}</dt>
            <dd><ul class="g-caution">${cs.map((c) => `<li>${esc(c.t)}${koLine(c.ko)}</li>`).join('')}</ul></dd>` : ''}
          </dl>
        </li>`;
    }).join('');

    return `
      <article class="guide" lang="${lang}">
        <header class="g-head">
          <h3>${UI.title[lang]}${state.showKo ? ` <span class="ko-inline">${UI.title.ko}</span>` : ''}</h3>
          <div class="g-meta">${pharmacy ? `${esc(UI.pharmacy[lang])}: ${esc(pharmacy)} · ` : ''}${today(lang)}</div>
        </header>
        <ol class="g-items">${items}</ol>
        <footer class="g-foot">${UI.footer[lang]}</footer>
      </article>`;
  }

  function renderOutput() {
    el.tabs.forEach((b) => b.setAttribute('aria-selected', b.dataset.lang === state.lang));
    if (!state.list.length) {
      el.output.innerHTML = `
        <div class="placeholder">
          <p><strong>왼쪽에서 약을 선택하고 [목록에 추가]를 누르세요.</strong></p>
          <p>추가한 약들이 선택한 언어의 복약 안내문으로 여기에 표시됩니다.</p>
        </div>`;
      return;
    }
    const langs = state.lang === 'all' ? LANGS : [state.lang];
    el.output.innerHTML = langs.map((l) =>
      `<div class="lang-group">${renderGuide(l)}${renderScript(l)}</div>`
    ).join('');
  }

  function renderScript(lang) {
    const blocks = buildScript(lang);
    const blocksKo = buildScript('ko');
    return `
      <section class="script" lang="${lang}" aria-label="복약지도 스크립트">
        <header class="s-head">
          <h3>복약지도 스크립트 <span class="badge">${LANG_NAME[lang]}</span></h3>
          <p>환자에게 그대로 읽어 주세요. ▶ 버튼을 누르면 해당 문장을 음성으로 들려줍니다.</p>
        </header>
        ${blocks.map((b, bi) => `
          <div class="s-block">
            <div class="s-label">${esc(b.label)}</div>
            ${b.lines.map((t, li) => `
              <p class="s-line">
                <button type="button" class="play" data-lang="${lang}" data-b="${bi}" data-l="${li}" aria-label="이 문장 듣기">▶</button>
                <span class="s-text">${esc(t)}${koLine(blocksKo[bi].lines[li])}</span>
              </p>`).join('')}
          </div>`).join('')}
      </section>`;
  }

  /* ---------------- 텍스트(복사·음성)용 ---------------- */
  function plainText(lang, withKo) {
    const lines = [];
    const pharmacy = el.pharmacy.value.trim();
    lines.push(`[${UI.title[lang]}]`);
    lines.push(`${pharmacy ? `${UI.pharmacy[lang]}: ${pharmacy} / ` : ''}${today(lang)}`);
    state.list.forEach((it, i) => {
      const d = it.drugId ? DRUGS.find((x) => x.id === it.drugId) : null;
      lines.push('');
      lines.push(`${i + 1}. ${d ? d.ing[lang] : it.customName}${d ? ` (${d.brandEn})` : ''}`);
      if (d) lines.push(`- ${UI.purpose[lang]}: ${d.use[lang]}`);
      lines.push(`- ${UI.howto[lang]}: ${directions(it, lang).join(' ')}`);
      if (withKo) lines.push(`  (${directions(it, 'ko').join(' ')})`);
      const cs = cautions(it, lang);
      if (cs.length) {
        lines.push(`- ${UI.caution[lang]}:`);
        cs.forEach((c) => lines.push(`  • ${c.t}`));
      }
    });
    lines.push('');
    lines.push(UI.footer[lang]);
    return lines.join('\n');
  }

  // 음성 읽기: [{ lang, text }] 순서대로 재생
  function speakQueue(parts) {
    if (!('speechSynthesis' in window)) { toast('이 브라우저는 음성 읽기를 지원하지 않습니다.'); return; }
    const synth = window.speechSynthesis;
    synth.cancel();
    const voices = synth.getVoices();
    parts.forEach((p, idx) => {
      const u = new SpeechSynthesisUtterance(p.text);
      u.lang = LOCALE[p.lang];
      const v = voices.find((x) => x.lang.replace('_', '-').toLowerCase().startsWith(p.lang));
      if (v) u.voice = v;
      u.rate = 0.9;
      if (idx === parts.length - 1) u.onend = u.onerror = () => { el.speakBtn.textContent = '전체 읽어주기'; };
      synth.speak(u);
    });
    el.speakBtn.textContent = '읽기 중지';
    const langs = [...new Set(parts.map((p) => p.lang))];
    const missing = langs.filter((l) => !voices.some((x) => x.lang.toLowerCase().startsWith(l)));
    if (voices.length && missing.length) toast(`${missing.map((l) => LANG_NAME[l]).join(', ')} 음성이 설치되어 있지 않을 수 있습니다.`);
  }

  // [전체 읽어주기]: 선택한 언어의 스크립트 전체를 읽음
  function speak() {
    if (!state.list.length) { toast('먼저 약을 목록에 추가하세요.'); return; }
    if ('speechSynthesis' in window && speechSynthesis.speaking) {
      speechSynthesis.cancel(); el.speakBtn.textContent = '전체 읽어주기'; return;
    }
    const langs = state.lang === 'all' ? LANGS : [state.lang];
    const parts = [];
    langs.forEach((lang) => buildScript(lang).forEach((b) => b.lines.forEach((t) => parts.push({ lang, text: t }))));
    speakQueue(parts);
  }

  async function copyText() {
    if (!state.list.length) { toast('먼저 약을 목록에 추가하세요.'); return; }
    const langs = state.lang === 'all' ? LANGS : [state.lang];
    const text = langs.map((l) => plainText(l, state.showKo)).join('\n\n--------------------\n\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (err) { /* 무시 */ }
      ta.remove();
    }
    toast('클립보드에 복사되었습니다.');
  }

  /* ---------------- 이벤트 ---------------- */
  function bind() {
    el.search.addEventListener('input', renderResults);
    el.search.addEventListener('focus', renderResults);
    el.search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
      else if (e.key === 'Enter') {
        const opts = el.results.querySelectorAll('li[data-id]');
        const target = opts[state.activeIdx >= 0 ? state.activeIdx : 0];
        if (target) { e.preventDefault(); selectDrug(target.dataset.id); }
      } else if (e.key === 'Escape') { el.results.hidden = true; }
    });
    el.results.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li[data-id]');
      if (li) { e.preventDefault(); selectDrug(li.dataset.id); }
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-wrap')) el.results.hidden = true;
    });

    el.customToggle.addEventListener('click', () => {
      state.custom = !state.custom;
      el.customFields.hidden = !state.custom;
      el.customToggle.textContent = state.custom ? '− 직접 입력 취소' : '+ 목록에 없는 약 직접 입력';
      if (state.custom) {
        state.drug = null;
        renderSelected();
        resetForm();
        el.customName.focus();
      }
      updateVisibility();
    });
    el.customRoute.addEventListener('change', updateVisibility);

    [el.qty, el.unit, el.timing, el.days, el.interval, el.maxDaily].forEach((x) => x.addEventListener('change', updatePreview));
    el.qty.addEventListener('input', updatePreview);
    el.freq.addEventListener('change', updateVisibility);

    el.addBtn.addEventListener('click', addItem);
    el.cancelEditBtn.addEventListener('click', () => { endEdit(); clearSelection(); renderList(); });

    el.list.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const i = Number(b.dataset.i);
      if (b.dataset.act === 'del') {
        state.list.splice(i, 1);
        if (state.editIndex === i) { endEdit(); clearSelection(); }
        else if (state.editIndex !== null && state.editIndex > i) state.editIndex--;
      } else if (b.dataset.act === 'up' && i > 0) {
        [state.list[i - 1], state.list[i]] = [state.list[i], state.list[i - 1]];
        if (state.editIndex === i) state.editIndex = i - 1;
        else if (state.editIndex === i - 1) state.editIndex = i;
      } else if (b.dataset.act === 'edit') {
        startEdit(i);
        return;
      }
      renderList();
      renderOutput();
    });

    // 실수 방지: 한 번 누르면 확인 상태, 3초 안에 다시 누르면 비움
    el.clearBtn.addEventListener('click', () => {
      if (!state.list.length) return;
      if (!el.clearBtn.dataset.armed) {
        el.clearBtn.dataset.armed = '1';
        el.clearBtn.textContent = '한 번 더 누르면 모두 비웁니다';
        clearTimeout(el.clearBtn._t);
        el.clearBtn._t = setTimeout(() => {
          delete el.clearBtn.dataset.armed;
          el.clearBtn.textContent = '전체 비우기';
        }, 3000);
        return;
      }
      clearTimeout(el.clearBtn._t);
      delete el.clearBtn.dataset.armed;
      el.clearBtn.textContent = '전체 비우기';
      state.list = [];
      endEdit();
      clearSelection();
      renderList();
      renderOutput();
    });

    el.tabs.forEach((b) => b.addEventListener('click', () => {
      state.lang = b.dataset.lang;
      store.set('rx.lang', state.lang);
      if (window.speechSynthesis && speechSynthesis.speaking) { speechSynthesis.cancel(); el.speakBtn.textContent = '전체 읽어주기'; }
      renderOutput();
    }));

    el.showKo.addEventListener('change', () => {
      state.showKo = el.showKo.checked;
      store.set('rx.showKo', state.showKo);
      renderOutput();
    });

    el.pharmacy.addEventListener('input', () => {
      store.set('rx.pharmacy', el.pharmacy.value);
      renderOutput();
    });

    el.speakBtn.addEventListener('click', speak);
    el.output.addEventListener('click', (e) => {
      const b = e.target.closest('button.play');
      if (!b) return;
      const line = buildScript(b.dataset.lang)[Number(b.dataset.b)].lines[Number(b.dataset.l)];
      speakQueue([{ lang: b.dataset.lang, text: line }]);
    });
    el.copyBtn.addEventListener('click', copyText);
    el.printBtn.addEventListener('click', () => {
      if (!state.list.length) { toast('먼저 약을 목록에 추가하세요.'); return; }
      window.print();
    });

    // 일부 브라우저는 음성 목록을 비동기로 불러옴
    if ('speechSynthesis' in window) speechSynthesis.getVoices();
  }

  /* ---------------- 시작 ---------------- */
  // 공유 링크(다른 페이지 안에 삽입된 상태)에서는 인쇄 창을 열 수 없으므로 인쇄 버튼을 숨김
  let framed = true;
  try { framed = window.self !== window.top; } catch (e) { /* 교차 출처 프레임 */ }
  if (framed) el.printBtn.hidden = true;

  state.lang = store.get('rx.lang', 'en');
  state.showKo = store.get('rx.showKo', true);
  el.showKo.checked = state.showKo;
  el.pharmacy.value = store.get('rx.pharmacy', '');

  buildForm();
  bind();
  renderList();
  renderOutput();
})();
