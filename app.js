/* 心嘉大王 — 纯前端背单词应用（离线可用） */
(() => {
  'use strict';

  /* ---------------- data ---------------- */
  const DATA = window.IELTS || { chapters: [], words: [] };
  const WORDS = DATA.words;
  const CHS = DATA.chapters;
  const BYID = new Map(WORDS.map(w => [w.id, w]));
  const CH_BY_I = new Map(CHS.map(c => [c.i, c]));

  const DAY = 864e5;
  const MIN10 = 6e5;
  const BOX_DAYS = [0, MIN10 / DAY, 1, 2, 4, 7, 15, 30, 60]; // 索引=box，单位天

  /* ---------------- state ---------------- */
  const KEY = 'ielts-zhan-v1';
  const DEFAULTS = () => ({
    v: 1,
    set: { dailyNew: 20, dailyReview: 200, autoAudio: true, spell: false },
    prog: {},
    log: {}
  });

  let S = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return DEFAULTS();
      const s = JSON.parse(raw);
      const d = DEFAULTS();
      s.set = Object.assign(d.set, s.set || {});
      s.prog = s.prog || {};
      s.log = s.log || {};
      return s;
    } catch (e) { return DEFAULTS(); }
  }
  /* ---------------- 同步（本机服务端 progress.json） ---------------- */
  const SYNC = {
    state: 'local', timer: 0, busy: false,
    // 只有经本机服务（127.0.0.1 / 局域网 IP）打开时才有 /api/ 同步接口；公网静态版本没有
    remote: /^(127\.0\.0\.1|localhost|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname)
  };

  const syncText = () => !SYNC.remote ? '本机浏览器 · 不同步'
    : SYNC.state === 'on' ? '已同步' : SYNC.state === 'off' ? '离线 · 只存本机' : '未同步';

  function refreshSyncUI() {
    const el = document.getElementById('syncState');
    if (el) el.textContent = syncText();
  }

  function mergeState(a, b) {
    a = a || {}; b = b || {};
    const out = DEFAULTS();
    out.prog = Object.assign({}, a.prog || {});
    for (const k in (b.prog || {})) {
      const x = out.prog[k];
      const y = b.prog[k] || {};
      if (!x || (y.last || 0) >= (x.last || 0)) out.prog[k] = y;
    }
    const la = a.log || {}, lb = b.log || {};
    const keys = {};
    Object.keys(la).forEach(k => (keys[k] = 1));
    Object.keys(lb).forEach(k => (keys[k] = 1));
    Object.keys(keys).forEach(k => {
      const x = la[k] || {}, y = lb[k] || {};
      out.log[k] = {
        n: Math.max(x.n || 0, y.n || 0),
        r: Math.max(x.r || 0, y.r || 0),
        c: Math.max(x.c || 0, y.c || 0),
        w: Math.max(x.w || 0, y.w || 0)
      };
    });
    const newer = (b._savedAt || 0) > (a._savedAt || 0) ? b : a;
    out.set = Object.assign({}, DEFAULTS().set, newer.set || {});
    out._savedAt = Math.max(a._savedAt || 0, b._savedAt || 0);
    return out;
  }

  function pushRemote() {
    if (!SYNC.remote) return;
    if (SYNC.busy) return;
    SYNC.busy = true;
    fetch('./api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: S, savedAt: S._savedAt || Date.now() })
    }).then(r => r.ok ? r.json() : null).then(d => {
      SYNC.state = d && d.ok ? 'on' : 'off';
    }).catch(() => { SYNC.state = 'off'; })
      .then(() => { SYNC.busy = false; refreshSyncUI(); });
  }

  function pullRemote(notify) {
    if (!SYNC.remote) { SYNC.state = 'off'; refreshSyncUI(); return; }
    fetch('./api/state', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d || !d.ok) { SYNC.state = 'off'; refreshSyncUI(); if (notify) toast('连不上同步服务（用 http 打开才能同步）'); return; }
        SYNC.state = 'on';
        const remote = d.state;
        if (remote) {
          const merged = mergeState(S, remote);
          if (JSON.stringify(merged) !== JSON.stringify(S)) {
            S = merged;
            try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { }
            if (!sess) render();
          }
        }
        refreshSyncUI();
        pushRemote();
        if (notify) toast('同步完成');
      })
      .catch(() => {
        SYNC.state = 'off'; refreshSyncUI();
        if (notify) toast('连不上同步服务（用 http 打开才能同步）');
      });
  }

  let saveTimer = 0;
  function save() {
    S._savedAt = now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { }
    }, 120);
    clearTimeout(SYNC.timer);
    SYNC.timer = setTimeout(pushRemote, 1500);
  }

  const P = id => (S.prog[id] = S.prog[id] || { b: 0, due: 0, r: 0, w: 0, last: 0, fav: 0 });
  const now = () => Date.now();
  const dayKey = (t = Date.now()) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const today = () => (S.log[dayKey()] = S.log[dayKey()] || { n: 0, r: 0, c: 0, w: 0 });

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- word helpers ---------------- */
  function dueWords() {
    const t = now();
    return WORDS.filter(w => {
      const p = S.prog[w.id];
      return p && p.b > 0 && p.due <= t;
    }).sort((a, b) => S.prog[a.id].due - S.prog[b.id].due);
  }
  function freshWords() {
    return WORDS.filter(w => !S.prog[w.id] || !S.prog[w.id].b);
  }
  function learnedCount() {
    let n = 0;
    for (const k in S.prog) if (S.prog[k].b > 0) n++;
    return n;
  }
  const isMastered = p => p && p.b >= 6;

  function streak() {
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const k = dayKey(Date.now() - i * DAY);
      const l = S.log[k];
      if (l && (l.n + l.r) > 0) n++;
      else if (i > 0) break;
      else if (!l) break;
    }
    return n;
  }

  function highlight(ex, word) {
    if (!ex) return '';
    const w = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const base = w.split(' ')[0];
    try {
      const re = new RegExp(`(${base}[a-z]{0,3})`, 'ig');
      return esc(ex).replace(re, '<b>$1</b>');
    } catch (e) { return esc(ex); }
  }

  /* ---------------- speech ---------------- */
  let voices = [];
  function loadVoices() { try { voices = speechSynthesis.getVoices(); } catch (e) { } }
  if ('speechSynthesis' in window) {
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  let speakTimer = 0;

  function makeUtterance(text) {
    const u = new SpeechSynthesisUtterance(String(text).replace(/-/g, ' '));
    const en = voices.filter(v => /^en/i.test(v.lang));
    const best = en.find(v => /en-GB/i.test(v.lang) && /(Google|Natural|Sonia|Daniel|Serena)/i.test(v.name))
      || en.find(v => /en-GB/i.test(v.lang))
      || en.find(v => /en-US/i.test(v.lang))
      || en[0];
    if (best) { u.voice = best; u.lang = best.lang; } else u.lang = 'en-GB';
    u.rate = 0.88; u.pitch = 1;
    return u;
  }

  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    const t = String(text);
    const fire = () => {
      try {
        speechSynthesis.resume();
        speechSynthesis.speak(makeUtterance(t));
      } catch (e) { }
    };
    clearTimeout(speakTimer);
    let busy = false;
    try { busy = speechSynthesis.speaking || speechSynthesis.pending; } catch (e) { }
    if (busy) {
      // Chrome 里 cancel() 后立刻 speak() 会卡住/延迟，隔一帧再读
      try { speechSynthesis.cancel(); } catch (e) { }
      speakTimer = setTimeout(fire, 40);
    } else {
      fire();
    }
  }

  /* 第一次点击先把 TTS 引擎唤醒，避免第一次发音等半秒 */
  let ttsWarm = false;
  function warmupTTS() {
    if (ttsWarm || !('speechSynthesis' in window)) return;
    ttsWarm = true;
    try {
      loadVoices();
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    } catch (e) { }
  }

  /* ---------------- session ---------------- */
  let sess = null;

  function startSession(more) {
    const t = today();
    const goalNew = more ? S.set.dailyNew : Math.max(0, S.set.dailyNew - t.n);
    const news = freshWords().slice(0, goalNew).map(w => ({ id: w.id, type: 'new' }));
    const dues = dueWords().slice(0, Math.max(0, S.set.dailyReview - t.r)).map(w => ({ id: w.id, type: 'rev' }));
    if (!news.length && !dues.length) {
      sess = null;
      render();
      toast(t.n >= S.set.dailyNew ? '今日任务已完成，点「再学一组」继续 🎉' : '词库新词已全部学完 🎉');
      return;
    }
    sess = {
      items: news.concat(dues),
      teachIdx: 0,
      revealed: false,
      queue: [],
      qi: 0,
      q: null,
      stats: { new: 0, rev: 0, ok: 0, no: 0 },
      t0: now()
    };
    // quiz queue: all new words + all due words, shuffled
    sess.queue = sess.items.map(i => ({ id: i.id, type: i.type, retry: 0 }));
    shuffle(sess.queue);
    location.hash = '#/study';
    if (teachList().length === 0) beginQuiz();
    else render();
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const teachList = () => sess ? sess.items.filter(i => i.type === 'new') : [];
  const teachCur = () => { const l = teachList(); return l[sess.teachIdx] || null; };

  function grade(g) {
    const cur = teachCur();
    if (!cur) return;
    const p = P(cur.id);
    const t = now();
    if (g === 1) { p.b = 1; p.due = t + MIN10; p.w++; }
    else if (g === 2) { p.b = 2; p.due = t + DAY; }
    else { p.b = 3; p.due = t + 2 * DAY; }
    p.last = t;
    sess.stats.new++;
    const l = today(); l.n++;
    save();
    sess.teachIdx++;
    sess.revealed = false;
    if (sess.teachIdx >= teachList().length) beginQuiz();
    render();
  }

  function beginQuiz() {
    sess.qi = 0;
    nextQuestion();
    render();
  }

  function nextQuestion() {
    while (sess.qi < sess.queue.length) {
      const item = sess.queue[sess.qi];
      const w = BYID.get(item.id);
      if (!w) { sess.qi++; continue; }
      const useSpell = S.set.spell && Math.random() < 0.35 && item.retry === 0;
      sess.q = makeQuestion(w, item, useSpell);
      return;
    }
    finishSession();
  }

  function makeQuestion(w, item, spell) {
    const q = { item, w, spell: !!spell, answered: false, ok: false, choice: -1, input: '' };
    if (spell) {
      q.prompt = { pos: w.pos, meaning: w.m };
    } else {
      const opts = pickOptions(w);
      q.options = opts.options;
      q.correct = opts.correct;
    }
    return q;
  }

  function pickOptions(w) {
    const seen = new Set([w.m]);
    const sameCh = WORDS.filter(x => x.ch === w.ch && x.id !== w.id);
    const pool = [];
    const push = x => { if (!seen.has(x.m)) { seen.add(x.m); pool.push(x); } };
    sameCh.filter(x => x.pos === w.pos).forEach(push);
    if (pool.length < 3) sameCh.forEach(push);
    if (pool.length < 3) WORDS.filter(x => x.id !== w.id).forEach(push);
    shuffle(pool);
    const opts = pool.slice(0, 3).map(x => x.m);
    opts.push(w.m);
    shuffle(opts);
    return { options: opts, correct: opts.indexOf(w.m) };
  }

  function answer(i) {
    const q = sess.q;
    if (!q || q.answered) return;
    q.answered = true;
    q.choice = i;
    q.ok = i === q.correct;
    const p = P(q.w.id);
    const t = now();
    const l = today();
    if (q.item.type === 'rev' && q.item.retry === 0) { l.r++; sess.stats.rev++; }
    if (q.ok) {
      p.b = Math.min(8, Math.max(p.b, 1) + 1);
      p.due = t + BOX_DAYS[p.b] * DAY;
      p.r++;
      sess.stats.ok++; l.c++;
    } else {
      p.b = 1; p.due = t + MIN10; p.w++;
      sess.stats.no++; l.w++;
      // requeue once
      if (!q.item.retry) sess.queue.push({ id: q.w.id, type: q.item.type, retry: 1 });
    }
    p.last = t;
    save();
    render();
    if (q.ok) setTimeout(() => { if (sess && sess.q === q) advanceQ(); }, 780);
    if (S.set.autoAudio && q.spell) speak(q.w.w);   // 拼写模式答完才读，避免泄题
  }

  function spellingSubmit() {
    const q = sess.q;
    if (!q || q.answered) return;
    const inp = document.getElementById('spellIn');
    const val = (inp ? inp.value : '').trim().toLowerCase().replace(/\s+/g, ' ');
    const targets = [q.w.w].concat(q.w.alts || []).map(s => s.toLowerCase().replace(/\s+/g, ' '));
    q.input = val;
    q.answered = true;
    q.ok = targets.includes(val);
    const p = P(q.w.id);
    const t = now();
    const l = today();
    if (q.item.type === 'rev' && q.item.retry === 0) { l.r++; sess.stats.rev++; }
    if (q.ok) {
      p.b = Math.min(8, Math.max(p.b, 1) + 1); p.due = t + BOX_DAYS[p.b] * DAY; p.r++;
      sess.stats.ok++; l.c++;
    } else {
      p.b = 1; p.due = t + MIN10; p.w++;
      sess.stats.no++; l.w++;
      if (!q.item.retry) sess.queue.push({ id: q.w.id, type: q.item.type, retry: 1 });
    }
    p.last = t;
    save();
    render();
    if (q.ok) setTimeout(() => { if (sess && sess.q === q) advanceQ(); }, 900);
  }

  function advanceQ() {
    if (!sess) return;
    if (!sess.q || !sess.q.answered) return;
    sess.qi++;
    nextQuestion();
    render();
  }

  function finishSession() {
    if (!sess) return;
    sess.q = null;
    startExtra();
    render();
  }

  /* ---------- 结束后巩固：默写 + 例句选择 ---------- */
  function startExtra() {
    const ids = [], seen = new Set();
    sess.items.forEach(i => { if (!seen.has(i.id)) { seen.add(i.id); ids.push(i.id); } });
    sess.stats.dictOk = 0; sess.stats.dictNo = 0;
    sess.stats.clozeOk = 0; sess.stats.clozeNo = 0;
    sess.extra = { phase: 1, list: shuffle(ids), idx: 0, item: null, skipped: 0 };
    extraStep();
  }

  function extraStep() {
    const x = sess && sess.extra;
    if (!x) return;
    for (let guard = 0; guard < 500; guard++) {
      if (x.idx >= x.list.length) {
        if (x.phase === 1) { x.phase = 2; x.idx = 0; continue; }
        sess.extra = null;
        sess.done = true;
        return;
      }
      const w = BYID.get(x.list[x.idx]);
      if (!w) { x.idx++; continue; }
      if (x.phase === 1) {
        x.item = { w, input: '', answered: false, ok: false };
        return;
      }
      const sentence = blankExample(w);
      if (!sentence) { x.idx++; continue; }
      const o = clozeOptions(w);
      x.item = { w, sentence, options: o.options, correct: o.correct, answered: false, ok: false, choice: -1 };
      return;
    }
    sess.extra = null;
    sess.done = true;
  }

  function blankExample(w) {
    if (!w.ex) return '';
    const forms = [w.w].concat(w.alts || []).filter(Boolean)
      .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .sort((a, b) => b.length - a.length);
    if (!forms.length) return '';
    const re = new RegExp('\\b(' + forms.join('|') + ')\\b', 'gi');
    const out = w.ex.replace(re, '______');
    return out === w.ex ? '' : out;
  }

  function clozeOptions(w) {
    const seen = new Set([w.w.toLowerCase()]);
    const pool = [];
    const push = x => { const k = x.w.toLowerCase(); if (!seen.has(k)) { seen.add(k); pool.push(x.w); } };
    WORDS.filter(x => x.ch === w.ch && x.pos === w.pos).forEach(push);
    if (pool.length < 3) WORDS.filter(x => x.ch === w.ch).forEach(push);
    if (pool.length < 3) WORDS.filter(x => x.id !== w.id).forEach(push);
    shuffle(pool);
    const opts = pool.slice(0, 3).concat([w.w]);
    shuffle(opts);
    return { options: opts, correct: opts.indexOf(w.w) };
  }

  function dictSubmit() {
    const x = sess && sess.extra;
    if (!x || x.phase !== 1 || !x.item || x.item.answered) return;
    const inp = document.getElementById('dictIn');
    const raw = (inp ? inp.value : '').trim().toLowerCase().replace(/\s+/g, ' ');
    const w = x.item.w;
    const targets = [w.w].concat(w.alts || []).map(s => s.toLowerCase().replace(/\s+/g, ' '));
    x.item.input = raw;
    x.item.answered = true;
    x.item.ok = targets.includes(raw);
    const p = P(w.id), t = now(), l = today();
    if (x.item.ok) {
      p.r++; sess.stats.dictOk++; sess.stats.ok++; l.c++;
    } else {
      p.w++; p.b = 1; p.due = t + MIN10;
      sess.stats.dictNo++; sess.stats.no++; l.w++;
    }
    p.last = t;
    save();
    render();
  }

  function clozeAnswer(i) {
    const x = sess && sess.extra;
    if (!x || x.phase !== 2 || !x.item || x.item.answered) return;
    x.item.answered = true;
    x.item.choice = i;
    x.item.ok = i === x.item.correct;
    const p = P(x.item.w.id), t = now(), l = today();
    if (x.item.ok) {
      p.r++; sess.stats.clozeOk++; sess.stats.ok++; l.c++;
    } else {
      p.w++; p.b = 1; p.due = t + MIN10;
      sess.stats.clozeNo++; sess.stats.no++; l.w++;
    }
    p.last = t;
    save();
    if (S.set.autoAudio) speak(x.item.w.w);
    render();
    if (x.item.ok) setTimeout(() => { if (sess && sess.extra === x && x.item && x.item.answered) extraNext(); }, 900);
  }

  function extraNext() {
    const x = sess && sess.extra;
    if (!x || !x.item || !x.item.answered) return;
    x.idx++;
    extraStep();
    render();
  }

  /* ---------------- rendering ---------------- */
  const app = document.getElementById('app');
  const navEl = document.getElementById('nav');

  function render() {
    const hash = location.hash || '#/home';
    const parts = hash.replace(/^#\/?/, '').split('/');
    const page = parts[0] || 'home';
    document.body.classList.toggle('hide-nav', page === 'study');
    navEl.querySelectorAll('a').forEach(a => {
      const t = a.dataset.tab;
      a.classList.toggle('on', t === page || (page === 'ch' && t === 'book') || (page === 'list' && t === 'book'));
    });
    if (page === 'home') app.innerHTML = viewHome();
    else if (page === 'study') app.innerHTML = viewStudy();
    else if (page === 'book') app.innerHTML = viewBook();
    else if (page === 'ch') app.innerHTML = viewChapter(+parts[1]);
    else if (page === 'me') app.innerHTML = viewMe();
    else if (page === 'list') app.innerHTML = viewList(parts[1] || 'fav');
    else app.innerHTML = viewHome();
    window.scrollTo(0, 0);
    const inp = document.getElementById('searchIn');
    if (inp) inp.focus({ preventScroll: true });
    if (page === 'study' && sess && sess.q && !sess.q.answered && sess.q.spell) {
      const sp = document.getElementById('spellIn');
      if (sp) sp.focus({ preventScroll: true });
    }
    if (page === 'study' && sess && sess.extra && sess.extra.phase === 1 && sess.extra.item && !sess.extra.item.answered) {
      const di = document.getElementById('dictIn');
      if (di) di.focus({ preventScroll: true });
    }
  }

  function topBar(title, sub, right) {
    return `<div class="top"><div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${right || ''}</div>`;
  }

  /* ---------- home ---------- */
  function viewHome() {
    const t = today();
    const goal = S.set.dailyNew;
    const newDone = Math.min(t.n, goal);
    const totalDone = t.n + t.r;
    const pct = Math.min(100, Math.round((newDone / Math.max(1, goal)) * 100));
    const dueN = dueWords().length;
    const learned = learnedCount();
    const d = new Date();
    const week = '日一二三四五六'[d.getDay()];
    const dateStr = `${d.getMonth() + 1}月${d.getDate()}日 周${week}`;
    const st = streak();

    const R = 48, C = 2 * Math.PI * R, off = C * (1 - pct / 100);

    return `
    ${topBar('今日', dateStr, `<div class="streak">🔥 ${st} 天</div>`)}

    <div class="card hero">
      <div class="ring-wrap">
        <svg width="112" height="112" viewBox="0 0 112 112">
          <circle cx="56" cy="56" r="${R}" fill="none" stroke="#eef0f4" stroke-width="10"/>
          <circle cx="56" cy="56" r="${R}" fill="none" stroke="url(#g1)" stroke-width="10"
            stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
          <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#10a765"/>
          </linearGradient></defs>
        </svg>
        <div class="ring-center"><b>${newDone}/${goal}</b><span>今日新词</span></div>
      </div>
      <div class="hero-info">
        <div class="line"><span>复习待办</span><b>${dueN} 个</b></div>
        <div class="line"><span>累计学过</span><b>${learned} / ${WORDS.length}</b></div>
        <div class="line"><span>今日学习</span><b>${totalDone} 个</b></div>
      </div>
    </div>

    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn-primary" data-act="start">${newDone >= goal && dueN === 0 ? '今日已完成 · 再学一组' : '开始学习'}</button>
    </div>
    <div class="btn-row" style="margin-top:10px">
      <button class="btn btn-ghost btn-sm" style="flex:1" data-act="start-more">多学 10 个</button>
      <button class="btn btn-ghost btn-sm" style="flex:1" data-act="go" data-to="#/me">学习设置</button>
    </div>

    <div class="section-title">我的词本</div>
    <div class="tiles">
      <a class="tile" href="#/list/fav"><div class="tico">⭐</div><div><div class="t1">生词本</div><div class="t2">${favList().length} 个单词</div></div></a>
      <a class="tile" href="#/list/wrong"><div class="tico" style="background:#fdeaea">🔁</div><div><div class="t1">错词本</div><div class="t2">${wrongList().length} 个待巩固</div></div></a>
      <a class="tile" href="#/book"><div class="tico" style="background:#eef4ff">📚</div><div><div class="t1">22 章词库</div><div class="t2">${WORDS.length} 词</div></div></a>
      <a class="tile" href="#/list/mastered"><div class="tico" style="background:#fff7e6">🏆</div><div><div class="t1">已掌握</div><div class="t2">${masteredCount()} 个单词</div></div></a>
    </div>

    <div class="section-title">最近 30 天打卡</div>
    <div class="card">
      <div class="heat">${heatCells()}</div>
      <div class="heat-legend">少 <i style="width:10px;height:10px;border-radius:3px;background:#eef0f4;display:inline-block"></i>
        <i style="width:10px;height:10px;border-radius:3px;background:#cdf0dd;display:inline-block"></i>
        <i style="width:10px;height:10px;border-radius:3px;background:#7fdbaa;display:inline-block"></i>
        <i style="width:10px;height:10px;border-radius:3px;background:#2fc07d;display:inline-block"></i>
        <i style="width:10px;height:10px;border-radius:3px;background:#0f8a55;display:inline-block"></i> 多</div>
    </div>
    <div style="height:6px"></div>`;
  }

  function favList() { return WORDS.filter(w => S.prog[w.id] && S.prog[w.id].fav); }
  function wrongList() { return WORDS.filter(w => { const p = S.prog[w.id]; return p && p.w > 0 && p.b < 5; }); }
  function masteredCount() { let n = 0; for (const k in S.prog) if (S.prog[k].b >= 6) n++; return n; }

  function heatCells() {
    let out = '';
    for (let i = 29; i >= 0; i--) {
      const k = dayKey(Date.now() - i * DAY);
      const l = S.log[k];
      const c = l ? l.n + l.r : 0;
      const lv = c === 0 ? 0 : c < 15 ? 1 : c < 40 ? 2 : c < 80 ? 3 : 4;
      out += `<i class="${lv ? 'l' + lv : ''}" title="${k} · ${c} 词"></i>`;
    }
    return out;
  }

  /* ---------- study ---------- */
  function viewStudy() {
    if (!sess) {
      return `${topBar('学习', '', '')}
      <div class="card empty">还没有开始学习<br><br>
      <button class="btn btn-primary" data-act="start">开始一组</button></div>`;
    }
    if (sess.done) return viewDone();

    const tch = teachCur();
    if (tch) return viewTeach(tch);
    if (sess.q) return viewQuestion(sess.q);
    if (sess.extra) return viewExtra();

    return `${topBar('学习', '', '')}
    <div class="card empty">这一组已经练完了<br><br>
    <button class="btn btn-primary" data-act="start">再来一组</button>
    <div style="height:10px"></div>
    <button class="btn btn-ghost btn-sm" data-act="home" style="width:100%">回首页</button></div>`;
  }

  function studyHeader(done, total) {
    const pct = total ? Math.min(100, (done / total) * 100) : 0;
    return `<div class="study-bar">
      <button class="close" data-act="exit">✕</button>
      <div class="prog"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="cnt">${done}/${total}</div>
    </div>`;
  }

  function viewTeach(item) {
    const w = BYID.get(item.id);
    const shows = teachList().length;
    const total = Math.max(1, shows + sess.queue.length);
    const done = sess.teachIdx + Math.max(0, sess.qi);
    const alts = (w.alts || []).filter(Boolean);

    const head = studyHeader(Math.min(done, total), total);

    const body = `
    <div class="wcard">
      <div><span class="pos">${esc(w.pos || 'word')}</span></div>
      <div class="word" data-act="speak" data-w="${esc(w.w)}">${esc(w.w)}</div>
      ${alts.length ? `<div class="alts">${alts.map(esc).join(' / ')}</div>` : ''}
      <div><span class="speak" data-act="speak" data-w="${esc(w.w)}">🔊 英式发音</span></div>

      ${sess.revealed ? `
        <div class="meaning">${esc(w.m)}</div>
        ${w.ex ? `<div class="ex">${highlight(w.ex, w.w)}</div>` : ''}
        ${w.x && w.x !== '-' ? `<div class="extra"><b>拓展</b>　${esc(w.x)}</div>` : ''}
      ` : `
        <div class="reveal-hint" data-act="reveal">先想一想它的意思<br><b>轻点卡片查看释义</b></div>
      `}

      ${sess.revealed ? `<div class="grade">
        <button class="g1" data-act="grade" data-g="1">不认识</button>
        <button class="g2" data-act="grade" data-g="2">有点印象</button>
        <button class="g3" data-act="grade" data-g="3">认识</button>
      </div>` : `<button class="btn btn-primary" style="margin-top:auto" data-act="reveal">查看释义</button>`}
    </div>`;

    // 卡片一出现就发音（同步调用，保住浏览器的「用户手势」许可）
    if (S.set.autoAudio && sess.lastSpeak !== item.id) {
      sess.lastSpeak = item.id;
      speak(w.w);
    }
    return head + body;
  }

  function viewQuestion(q) {
    const w = q.w;
    const teachTotal = teachList().length;
    const total = Math.max(teachTotal + sess.queue.length, 1);
    const done = Math.min(teachTotal + Math.min(sess.qi, sess.queue.length), total);
    const head = studyHeader(done, total);
    const isNew = q.item.type === 'new';

    if (q.spell) {
      return head + `<div class="wcard">
        <div class="q-head"><span class="tag">看中文 · 拼单词 ${isNew ? '· 新词' : ''}</span>
          <span class="tag">${esc(w.pos || '')}</span></div>
        <div class="q-mean">${esc(w.m)}</div>
        <input id="spellIn" class="spell-input ${q.answered ? (q.ok ? 'good' : 'bad') : ''}"
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
          placeholder="输入英文单词" value="${esc(q.input || '')}" ${q.answered ? 'disabled' : ''}
          onkeydown="if(event.key==='Enter'){event.preventDefault();document.querySelector('[data-act=spellSubmit]').click()}"/>
        ${q.answered ? feedbackBlock(q, w) : `<button class="btn btn-primary" style="margin-top:16px" data-act="spellSubmit">提交</button>`}
      </div>`;
    }

    return head + `<div class="wcard">
      <div class="q-head"><span class="tag">${isNew ? '新词测试' : '复习'}</span>
        <span class="tag">${esc(w.pos || '')}</span></div>
      <div class="q-word" data-act="speak" data-w="${esc(w.w)}">${esc(w.w)} 🔊</div>
      <div class="opts">
        ${q.options.map((o, i) => {
          let cls = 'opt';
          if (q.answered) {
            if (i === q.correct) cls += ' right';
            else if (i === q.choice) cls += ' wrong';
            else cls += ' dim';
          }
          return `<button class="${cls}" data-act="opt" data-i="${i}">
            <span class="k">${'ABCD'[i]}</span><span>${esc(o)}</span></button>`;
        }).join('')}
      </div>
      ${q.answered ? feedbackBlock(q, w) : ''}
    </div>`;
  }

  function feedbackBlock(q, w) {
    const ok = q.ok;
    return `<div class="fb ${ok ? 'ok' : 'no'}">
      <div>${ok ? '✓ 正确' : '✕ 答错了'}</div>
      <div class="w" style="margin-top:6px">${esc(w.w)} <span style="font-size:12px;color:var(--ink-3);font-family:inherit">${esc(w.pos || '')}</span></div>
      <div class="m">${esc(w.m)}</div>
      ${w.ex ? `<div class="e">${highlight(w.ex, w.w)}</div>` : ''}
      ${w.x && w.x !== '-' ? `<div class="e"><b>拓展</b> ${esc(w.x)}</div>` : ''}
      <button class="btn ${ok ? 'btn-ghost' : 'btn-dark'}" style="margin-top:12px;height:46px" data-act="nextQ">下一题 →</button>
    </div>`;
  }

  function extraBar(x) {
    const per = Math.max(1, x.list.length);
    const done = x.phase === 1 ? x.idx : per + x.idx;
    const pct = Math.min(100, (done / (per * 2)) * 100);
    return `<div class="study-bar">
      <button class="close" data-act="exit">✕</button>
      <div class="prog"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="cnt">${x.phase === 1 ? '默写' : '例句'} ${Math.min(x.idx + 1, per)}/${per}</div>
    </div>
    <div class="extra-tip">本组单词背完了 · 默写 + 例句巩固一遍 <span class="extra-skip" data-act="skipExtra">跳过</span></div>`;
  }

  function viewExtra() {
    const x = sess.extra;
    const it = x.item;
    if (!it) return extraBar(x);
    const w = it.w;

    if (x.phase === 1) {
      return extraBar(x) + `<div class="wcard">
        <div class="q-head"><span class="tag">默写 · 看中文写单词</span><span class="tag">${esc(w.pos || '')}</span></div>
        <div class="q-mean">${esc(w.m)}</div>
        <input id="dictIn" class="spell-input ${it.answered ? (it.ok ? 'good' : 'bad') : ''}"
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
          value="${esc(it.input || '')}" ${it.answered ? 'readonly' : ''} placeholder="在这里打出整个单词"
          onkeydown="if(event.key==='Enter'){var b=document.querySelector('[data-act=dictSubmit]')||document.querySelector('[data-act=dictNext]');if(b)b.click();}">
        ${it.answered ? `<div class="fb ${it.ok ? 'ok' : 'no'}">
          <div>${it.ok ? '✓ 拼写正确' : '✕ 拼错了'}</div>
          <div class="w" style="margin-top:6px">${esc(w.w)} <span style="font-size:12px;color:var(--ink-3);font-family:inherit">${esc(w.pos || '')}</span></div>
          ${w.ex ? `<div class="e">${highlight(w.ex, w.w)}</div>` : ''}
          <button class="btn ${it.ok ? 'btn-ghost' : 'btn-dark'}" style="margin-top:12px;height:46px" data-act="dictNext">继续 →</button>
        </div>` : `<button class="btn btn-primary" style="margin-top:auto" data-act="dictSubmit">确认</button>`}
      </div>`;
    }

    return extraBar(x) + `<div class="wcard">
      <div class="q-head"><span class="tag">例句 · 选出正确的词</span><span class="tag">${esc(w.pos || '')}</span></div>
      <div class="cloze-ex">${esc(it.sentence)}</div>
      <div class="cloze-hint">${esc(w.m)}</div>
      <div class="opts">${it.options.map((o, i) => {
        let cls = 'opt';
        if (it.answered) {
          if (i === it.correct) cls += ' good';
          else if (i === it.choice) cls += ' bad';
          cls += ' dim';
        }
        return `<button class="${cls}" data-act="copt" data-i="${i}">
          <span class="k">${'ABCD'[i]}</span><span>${esc(o)}</span></button>`;
      }).join('')}</div>
      ${it.answered ? `<div class="fb ${it.ok ? 'ok' : 'no'}">
        <div>${it.ok ? '✓ 正确' : '✕ 答错了'}</div>
        <div class="w" style="margin-top:6px">${esc(w.w)} <span style="font-size:12px;color:var(--ink-3);font-family:inherit">${esc(w.pos || '')}</span></div>
        <div class="e">${highlight(w.ex, w.w)}</div>
        <button class="btn ${it.ok ? 'btn-ghost' : 'btn-dark'}" style="margin-top:12px;height:46px" data-act="cnext">继续 →</button>
      </div>` : ''}
    </div>`;
  }

  function viewDone() {
    const s = sess.stats;
    const total = s.new + s.rev;
    const acc = s.ok + s.no ? Math.round((s.ok / (s.ok + s.no)) * 100) : 0;
    const mins = Math.max(1, Math.round((now() - sess.t0) / 6e4));
    return `${studyHeader(1, 1)}
    <div class="card done">
      <div class="big">🎉</div>
      <h2>今天的单词已斩完</h2>
      <p>用时 ${mins} 分钟 · 正确率 ${acc}%</p>
      ${(s.dictOk + s.dictNo + s.clozeOk + s.clozeNo) ? `<p class="extra-sum">默写 ${s.dictOk}/${s.dictOk + s.dictNo} · 例句 ${s.clozeOk}/${s.clozeOk + s.clozeNo}</p>` : ''}
      <div class="grid3">
        <div><b>${s.new}</b><span>新学单词</span></div>
        <div><b>${total}</b><span>共学习</span></div>
        <div><b>${s.ok + s.no}</b><span>作答次数</span></div>
      </div>
      <button class="btn btn-primary" data-act="home">回到首页</button>
      <div class="btn-row"><button class="btn btn-ghost btn-sm" style="flex:1" data-act="again">再学一组</button>
      <button class="btn btn-ghost btn-sm" style="flex:1" data-act="reviewNow">只看复习</button></div>
    </div>`;
  }

  /* ---------- book ---------- */
  function viewBook() {
    const learned = learnedCount();
    return `${topBar('词库', `共 ${CHS.length} 章 · ${WORDS.length} 词`, `<div class="streak">${learned} 已学</div>`)}
    <div class="search">🔍<input id="searchIn" placeholder="搜索单词或中文释义" oninput="window.__search(this.value)"></div>
    <div id="searchOut"></div>
    <div class="chapters" id="chapList">
      ${CHS.map(c => {
        const ws = WORDS.filter(w => w.ch === c.i);
        const done = ws.filter(w => S.prog[w.id] && S.prog[w.id].b > 0).length;
        const pct = Math.round((done / Math.max(1, ws.length)) * 100);
        return `<a class="chap" href="#/ch/${c.i}">
          <div class="num">${String(c.i).padStart(2, '0')}</div>
          <div class="mid">
            <div class="nm">${esc(c.name)}<span class="chip">${ws.length} 词</span></div>
            <div class="bar"><i style="width:${pct}%"></i></div>
            <div class="meta">${c.groups} 组 · 已学 ${done}</div>
          </div>
          <div class="pv">${pct}%</div>
        </a>`;
      }).join('')}
    </div>
    <div style="height:6px"></div>`;
  }

  function viewChapter(i) {
    const c = CH_BY_I.get(i);
    if (!c) return viewBook();
    const ws = WORDS.filter(w => w.ch === i);
    return `${topBar(`${String(i).padStart(2, '0')} ${c.name}`, `${ws.length} 词 · ${c.groups} 个分组`, `<button class="icon-btn" data-act="back">←</button>`)}
    <div class="seg" id="chapSeg">
      <button class="on" data-act="filter" data-f="all">全部</button>
      <button data-act="filter" data-f="todo">未学</button>
      <button data-act="filter" data-f="doing">学习中</button>
      <button data-act="filter" data-f="master">已掌握</button>
    </div>
    <div id="wsList">${wordRows(ws)}</div>
    <div style="height:6px"></div>`;
  }

  function wordRows(ws) {
    if (!ws.length) return `<div class="empty">没有单词</div>`;
    return `<div class="wlist">${ws.map(w => {
      const p = S.prog[w.id] || { b: 0, fav: 0 };
      const dots = [1, 2, 3, 4, 5].map(k => `<i class="${p.b >= k ? 'on' : ''} ${p.fav ? 'fav' : ''}"></i>`).join('');
      return `<div class="wrow" data-act="open" data-id="${w.id}">
        <div class="l"><div class="w">${esc(w.w)} ${p.fav ? '⭐' : ''}</div><div class="m">${esc(w.pos)} ${esc(w.m)}</div></div>
        ${!p.b ? '<span class="chip new">未学</span>' : `<div class="dots">${dots}</div>`}
      </div>`;
    }).join('')}</div>`;
  }

  window.__search = function (q) {
    const out = document.getElementById('searchOut');
    const list = document.getElementById('chapList');
    if (!out) return;
    const s = (q || '').trim().toLowerCase();
    if (!s) { out.innerHTML = ''; if (list) list.style.display = ''; return; }
    if (list) list.style.display = 'none';
    const hits = WORDS.filter(w =>
      w.w.toLowerCase().includes(s) ||
      (w.alts || []).some(a => a.toLowerCase().includes(s)) ||
      (w.m || '').includes(s)
    ).slice(0, 60);
    out.innerHTML = hits.length
      ? `<div class="section-title">搜索到 ${hits.length} 个</div>` + wordRows(hits)
      : `<div class="empty">没有找到「${esc(q)}」</div>`;
  };

  function filterChapter(f, btn) {
    const i = +location.hash.split('/')[2];
    const ws = WORDS.filter(w => w.ch === i);
    const list = ws.filter(w => {
      const p = S.prog[w.id] || { b: 0 };
      if (f === 'todo') return !p.b;
      if (f === 'doing') return p.b > 0 && p.b < 6;
      if (f === 'master') return p.b >= 6;
      return true;
    });
    const box = document.getElementById('wsList');
    if (box) box.innerHTML = wordRows(list);
    if (btn) {
      const seg = document.getElementById('chapSeg');
      if (seg) seg.querySelectorAll('button').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
    }
  }

  /* ---------- lists ---------- */
  function viewList(kind) {
    const titles = { fav: '生词本', wrong: '错词本', mastered: '已掌握' };
    let ws;
    if (kind === 'fav') ws = favList();
    else if (kind === 'wrong') ws = wrongList();
    else ws = WORDS.filter(w => S.prog[w.id] && S.prog[w.id].b >= 6);
    const title = titles[kind] || '单词';
    return `${topBar(title, `${ws.length} 个单词`, `<button class="icon-btn" data-act="back">←</button>`)}
    ${ws.length ? wordRows(ws) : `<div class="card empty">这里还空着，去学习吧 ✨</div>`}
    <div style="height:6px"></div>`;
  }

  /* ---------- me ---------- */
  function viewMe() {
    const learned = learnedCount(), mastered = masteredCount();
    let totalAns = 0, totalOk = 0, days = 0;
    for (const k in S.log) { const l = S.log[k]; totalAns += l.c + l.w; totalOk += l.c; if (l.n + l.r > 0) days++; }
    const acc = totalAns ? Math.round((totalOk / totalAns) * 100) : 0;
    const rep = 0;

    return `${topBar('我的', '设置与学习统计', '')}
    <div class="card">
      <div class="stat-grid">
        <div><b>${learned}</b><span>学过的单词</span></div>
        <div><b>${mastered}</b><span>已掌握（≥6级）</span></div>
        <div><b>${acc}%</b><span>累计正确率</span></div>
        <div><b>${days}</b><span>学习天数</span></div>
      </div>
    </div>

    <div class="section-title">学习设置</div>
    <div class="card">
      <div class="row"><div class="l"><div class="a">每日新词</div><div class="b">建议 20–40 个，按 21 天节奏</div></div></div>
      <div class="seg" style="margin-bottom:4px">
        ${[10, 20, 30, 40, 50].map(v => `<button class="${S.set.dailyNew === v ? 'on' : ''}" data-act="daily" data-v="${v}">${v} 个</button>`).join('')}
      </div>
      <div class="row"><div class="l"><div class="a">自动发音</div><div class="b">出现单词和答题时朗读</div></div>
        <div class="switch ${S.set.autoAudio ? 'on' : ''}" data-act="toggle" data-k="autoAudio"></div></div>
      <div class="row"><div class="l"><div class="a">拼写模式</div><div class="b">复习时随机要求看中文拼单词</div></div>
        <div class="switch ${S.set.spell ? 'on' : ''}" data-act="toggle" data-k="spell"></div></div>
      <div class="row"><div class="l"><div class="a">复习上限 / 天</div><div class="b">到期复习词最多 ${S.set.dailyReview} 个</div></div>
        <span class="chip" data-act="dailyReview">${S.set.dailyReview}</span></div>
    </div>

    <div class="section-title">数据</div>
    <div class="card">
      <div class="row"><div class="l"><div class="a">${SYNC.remote ? '手机 / 电脑同步' : '进度存储'}</div><div class="b">${SYNC.remote ? '进度存在本机服务里，两端共用 · <span id="syncState">' + esc(syncText()) + '</span>' : '这个版本进度只存在当前设备的浏览器里，换设备各自独立'}</div></div>
        ${SYNC.remote ? '<button class="btn btn-ghost btn-sm" data-act="sync">同步</button>' : ''}</div>
      <div class="row"><div class="l"><div class="a">重置全部进度</div><div class="b">清空学习记录、生词本与统计</div></div>
        <button class="btn btn-ghost btn-sm" data-act="reset">重置</button></div>
      <div class="row"><div class="l"><div class="a">词库来源</div><div class="b">刘洪波《雅思词汇真经》22 章 · 共 ${WORDS.length} 词</div></div></div>
    </div>

    <div class="tiny muted" style="text-align:center;margin-top:18px;line-height:1.7">
      心嘉大王 · 纯本地运行，数据保存在你的浏览器里<br>手机端建议「添加到主屏幕」当 App 用
    </div>
    <div style="height:10px"></div>`;
  }

  /* ---------- sheet ---------- */
  const sheetEl = document.getElementById('sheet');
  function openSheet(id) {
    const w = BYID.get(id);
    if (!w) return;
    const p = P(id);
    const lvl = p.b === 0 ? '未学习' : p.b >= 6 ? `已掌握（${p.b}/8）` : `学习中（${p.b}/8）`;
    sheetEl.hidden = false;
    sheetEl.innerHTML = `<div class="sheet" data-act="stop">
      <div class="grab"></div>
      <div><span class="pos">${esc(w.pos || 'word')}</span></div>
      <div class="word small" data-act="speak" data-w="${esc(w.w)}">${esc(w.w)} 🔊</div>
      ${(w.alts || []).length ? `<div class="alts">${w.alts.map(esc).join(' / ')}</div>` : ''}
      <div class="meaning">${esc(w.m)}</div>
      ${w.ex ? `<div class="ex">${highlight(w.ex, w.w)}</div>` : ''}
      ${w.x && w.x !== '-' ? `<div class="extra"><b>拓展</b>　${esc(w.x)}</div>` : ''}
      <div class="tiny muted" style="margin-top:14px">第 ${w.ch} 章 · ${esc((CH_BY_I.get(w.ch) || {}).name || '')} · 组 ${w.g + 1} · ${lvl} · 答对 ${p.r} / 答错 ${p.w}</div>
      <div class="btn-row">
        <button class="btn btn-ghost btn-sm" style="flex:1" data-act="speak" data-w="${esc(w.w)}">🔊 发音</button>
        <button class="btn btn-ghost btn-sm" style="flex:1" data-act="fav" data-id="${id}">${p.fav ? '⭐ 已在生词本' : '☆ 加入生词本'}</button>
      </div>
      <div class="btn-row"><button class="btn btn-ghost" data-act="closeSheet">关闭</button></div>
    </div>`;
  }
  function closeSheet() { sheetEl.hidden = true; sheetEl.innerHTML = ''; }
  sheetEl.addEventListener('click', e => {
    if (e.target === sheetEl) closeSheet();
  });

  /* ---------------- events ---------------- */
  let toastTimer = 0;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 1600);
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'stop') return;

    switch (act) {
      case 'start': startSession(today().n >= S.set.dailyNew); break;
      case 'start-more': startSessionMore(); break;
      case 'again': startSession(true); break;
      case 'reviewNow': {
        sess = null;
        const dues = dueWords().slice(0, S.set.dailyReview);
        if (!dues.length) { toast('暂时没有到期的复习词'); return; }
        location.hash = '#/study';
        sess = {
          items: dues.map(w => ({ id: w.id, type: 'rev' })), teachIdx: 0, revealed: false,
          queue: shuffle(dues.map(w => ({ id: w.id, type: 'rev', retry: 0 }))),
          qi: 0, q: null, stats: { new: 0, rev: 0, ok: 0, no: 0 }, t0: now()
        };
        nextQuestion(); render();
      } break;
      case 'exit': {
        if (confirm('退出本次学习？已答的进度会保存。')) {
          sess = null;
          location.hash = '#/home';
        }
      } break;
      case 'home': sess = null; location.hash = '#/home'; break;
      case 'reveal': {
        if (!sess) return;
        sess.revealed = true;
        render();
      } break;
      case 'grade': grade(+t.dataset.g); break;
      case 'opt': answer(+t.dataset.i); break;
      case 'nextQ': advanceQ(); break;
      case 'spellSubmit': spellingSubmit(); break;
      case 'dictSubmit': dictSubmit(); break;
      case 'dictNext': extraNext(); break;
      case 'copt': clozeAnswer(+t.dataset.i); break;
      case 'cnext': extraNext(); break;
      case 'skipExtra': {
        if (sess) { sess.extra = null; sess.done = true; render(); }
      } break;
      case 'speak': speak(t.dataset.w); break;
      case 'open': openSheet(+t.dataset.id); break;
      case 'closeSheet': closeSheet(); break;
      case 'fav': {
        const id = +t.dataset.id;
        const p = P(id);
        p.fav = p.fav ? 0 : 1;
        save();
        toast(p.fav ? '已加入生词本' : '已移出生词本');
        openSheet(id);
      } break;
      case 'daily': S.set.dailyNew = +t.dataset.v; save(); render(); break;
      case 'dailyReview': {
        const v = prompt('每天最多复习多少个到期单词？(50-500)', S.set.dailyReview);
        if (v && +v > 0) { S.set.dailyReview = Math.min(1000, +v); save(); render(); }
      } break;
      case 'toggle': {
        const k = t.dataset.k;
        S.set[k] = !S.set[k];
        save(); render();
      } break;
      case 'sync': toast('正在同步…'); pullRemote(true); break;
      case 'reset': {
        if (confirm('确认清空所有学习进度？此操作不可恢复。')) {
          S = DEFAULTS(); save();
          fetch('./api/reset', { method: 'POST' }).catch(() => { });
          sess = null; toast('已重置'); render();
        }
      } break;
      case 'back': history.length > 1 ? history.back() : (location.hash = '#/book'); break;
      case 'filter': filterChapter(t.dataset.f, t); break;
      case 'go': location.hash = t.dataset.to; break;
    }
  });

  function startSessionMore() {
    const news = freshWords().slice(0, 10).map(w => ({ id: w.id, type: 'new' }));
    const dues = dueWords().slice(0, 30).map(w => ({ id: w.id, type: 'rev' }));
    if (!news.length && !dues.length) { toast('词库已经学完了 🎉'); return; }
    sess = {
      items: news.concat(dues), teachIdx: 0, revealed: false,
      queue: shuffle(news.concat(dues).map(i => ({ id: i.id, type: i.type, retry: 0 }))),
      qi: 0, q: null, stats: { new: 0, rev: 0, ok: 0, no: 0 }, t0: now()
    };
    location.hash = '#/study';
    render();
  }

  window.addEventListener('hashchange', render);

  document.addEventListener('keydown', e => {
    if (!sess || sess.done) return;
    if (document.activeElement && (document.activeElement.id === 'spellIn' || document.activeElement.id === 'dictIn')) return;
    const tch = teachCur();
    if (tch) {
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        if (!sess.revealed) { sess.revealed = true; render(); }
      } else if (sess.revealed) {
        if (e.key === '1') grade(1);
        if (e.key === '2') grade(2);
        if (e.key === '3') grade(3);
      }
    } else if (sess.q) {
      if (sess.q.answered) {
        if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); advanceQ(); }
      } else if (!sess.q.spell) {
        const i = '1234'.indexOf(e.key);
        if (i >= 0) answer(i);
      }
    } else if (sess.extra && sess.extra.item) {
      const it = sess.extra.item;
      if (sess.extra.phase === 1) {
        if (e.key === 'Enter' && it.answered) { e.preventDefault(); extraNext(); }
      } else if (!it.answered) {
        const i = '1234'.indexOf(e.key);
        if (i >= 0) clozeAnswer(i);
      } else if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        extraNext();
      }
    }
  });
  /* 首次触摸/点击即预热发音引擎 */
  ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, warmupTTS, { once: true, passive: true });
  });

  /* auto speak on question change */
  let lastQ = null;
  const origRender = render;
  render = function () {
    origRender();
    if (sess && !sess.done && sess.q && sess.q !== lastQ) {
      lastQ = sess.q;
      if (S.set.autoAudio && !sess.q.spell) speak(sess.q.w.w);
    }
  };

  /* init */
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
    navigator.serviceWorker.register('./sw.js').catch(() => { });
  }
  if (!location.hash) location.hash = '#/home';
  render();
  pullRemote(false);
})();
