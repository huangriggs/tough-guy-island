import { IslandWorld3D } from './world3d.js';

const STORAGE_KEY = 'toughGuyIslandState_v1';

const ITEM_META = {
  shell: { name: '貝殼', icon: '🐚' },
  bookmark: { name: '語文書籤', icon: '📝' },
  abc_badge: { name: '字母徽章', icon: '🔤' },
  cube: { name: '幾何魔方', icon: '📐' },
  seed: { name: '生態種子', icon: '🌱' },
  gear: { name: '智慧齒輪', icon: '⚙️' },
  medal: { name: '活力獎章', icon: '🏅' },
  compass: { name: '領航羅盤', icon: '🧭' },
  note_gem: { name: '音符水晶', icon: '🎵' },
  brush: { name: '彩虹畫筆', icon: '🎨' },
  star_diamond: { name: '男子漢榮譽星鑽', icon: '💎' }
};

class ToughGuyIslandApp {
  constructor() {
    this.content = null;
    this.world = null;
    this.state = this.loadState();
    this.currentIslandId = null;
    this.currentTab = 'lesson';
    this.currentPeriod = 'day';
    this.activeBubbleActor = null;
    this.audioCtx = null;
    this.musicTimer = null;
    this.isMusicPlaying = false;
  }

  defaultState() {
    const today = new Date().toISOString().slice(0, 10);
    return {
      themeMode: 'auto', // 'auto' | 'morning' | 'mist' | 'night'
      fontSize: 'md', // 'sm' | 'md' | 'lg' | 'xl'
      visitedIslands: [],
      readLessons: [],
      worksheets: {},
      quizScores: {},
      backpack: {
        shell: 3,
        bookmark: 0,
        abc_badge: 0,
        cube: 0,
        seed: 0,
        gear: 0,
        medal: 0,
        compass: 0,
        note_gem: 0,
        brush: 0,
        star_diamond: 0
      },
      dailyKeys: {
        date: today,
        remaining: 3
      },
      collectedCards: [],
      introPlayed: false,
      studentName: '好孩子小學堂學員'
    };
  }

  loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const def = this.defaultState();
      if (!raw) return def;
      const parsed = JSON.parse(raw);
      const today = new Date().toISOString().slice(0, 10);
      const dailyKeys =
        parsed.dailyKeys && parsed.dailyKeys.date === today
          ? parsed.dailyKeys
          : { date: today, remaining: 3 };
      return {
        ...def,
        ...parsed,
        backpack: { ...def.backpack, ...(parsed.backpack || {}) },
        dailyKeys
      };
    } catch {
      return this.defaultState();
    }
  }

  saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.warn('Unable to save state:', e);
    }
    this.refreshHudCounters();
  }

  async init() {
    const res = await fetch('./data/content.json');
    this.content = await res.json();

    // 套用字體大小與初始底色
    this.applyFontSize(this.state.fontSize);
    this.applyThemeMode(this.state.themeMode, 'day');

    // 初始化 3D 世界
    const canvas = document.getElementById('webgl-canvas');
    const labelsLayer = document.getElementById('labels-layer');

    this.world = new IslandWorld3D(canvas, labelsLayer, this.content, {
      onSelectIsland: (islandId) => this.openIslandPanel(islandId),
      onTimeUpdate: (period, timeStr) => this.handleTimeUpdate(period, timeStr),
      onPickupShell: () => this.handlePickupShell(),
      onOpenBubble: (kind, actor) => this.renderActorBubble(kind, actor),
      onCloseBubble: () => this.hideActorBubble(),
      onUpdateBubblePos: (x, y) => this.positionActorBubble(x, y),
      onQualityChange: (low) => {
        const btn = document.getElementById('btn-quality');
        if (btn) btn.textContent = `✨ 畫質：${low ? '低' : '高'}`;
      }
    });

    this.bindUiEvents();
    this.refreshHudCounters();
    this.world.markVisitedLabels(new Set(this.state.visitedIslands));

    // WebGL 失敗時自動打開完整文字清單模式
    if (!this.world.webglSupported) {
      this.openListModal('all', true);
      return;
    }

    // 電影史詩開場運鏡（第一次進站播放，隨時可點畫面或按 Esc 跳過）
    if (!this.state.introPlayed && !this.world.reducedMotion) {
      this.startCinemaOverlay();
    }
  }

  startCinemaOverlay() {
    const overlay = document.getElementById('cinema-overlay');
    overlay.hidden = false;
    this.world.playEpicCinemaIntro(() => {
      overlay.hidden = true;
      this.state.introPlayed = true;
      this.saveState();
    });
  }

  applyFontSize(sizeKey) {
    const valid = ['sm', 'md', 'lg', 'xl'].includes(sizeKey) ? sizeKey : 'md';
    this.state.fontSize = valid;
    document.documentElement.setAttribute('data-font-size', valid);
    const labelMap = { sm: '小', md: '標準', lg: '大', xl: '特大' };
    const btn = document.getElementById('btn-font-size');
    if (btn) btn.textContent = `🔠 字級：${labelMap[valid]}`;
    this.saveState();
  }

  cycleFontSize() {
    const order = ['sm', 'md', 'lg', 'xl'];
    const next = order[(order.indexOf(this.state.fontSize) + 1) % order.length];
    this.applyFontSize(next);
  }

  applyThemeMode(mode, period = this.currentPeriod) {
    this.state.themeMode = mode;
    let effectiveTheme = mode;
    if (mode === 'auto') {
      if (period === 'day') effectiveTheme = 'morning';
      else if (period === 'dusk') effectiveTheme = 'mist';
      else effectiveTheme = 'night';
    }
    document.documentElement.setAttribute('data-theme', effectiveTheme);

    document.querySelectorAll('[data-theme-btn]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.themeBtn === mode);
    });

    if (this.world) {
      this.world.setThemeVisual(effectiveTheme);
      // 手動切到夜海底色時，預設把光線調成夜晚
      if (mode === 'night' && this.world.timeMode === 'auto') {
        this.setTimeMode('night');
      }
    }
    this.saveState();
  }

  setTimeMode(mode) {
    document.querySelectorAll('[data-time-btn]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.timeBtn === mode);
    });
    if (this.world) {
      this.world.setTimeMode(mode);
    }
  }

  handleTimeUpdate(period, timeStr) {
    const periodChanged = period !== this.currentPeriod;
    this.currentPeriod = period;
    const labelMap = {
      day: '☀️ 白天',
      dusk: '🌇 黃昏',
      night: '🌙 夜晚'
    };
    const clockEl = document.getElementById('clock-readout');
    if (clockEl) {
      clockEl.textContent = `${labelMap[period] || '☀️ 白天'} ${timeStr}`;
    }
    if (periodChanged && this.state.themeMode === 'auto') {
      this.applyThemeMode('auto', period);
    }
  }

  refreshHudCounters() {
    const visitedCount = new Set(this.state.visitedIslands).size;
    const progEl = document.getElementById('progress-badge');
    if (progEl) progEl.textContent = `進度 ${visitedCount}/10`;

    const shellEl = document.getElementById('shell-count');
    if (shellEl) shellEl.textContent = `🐚${this.state.backpack.shell || 0}`;

    const keyEl = document.getElementById('key-count');
    if (keyEl) keyEl.textContent = `${this.state.dailyKeys.remaining}/3`;

    const cardEl = document.getElementById('card-count');
    if (cardEl) cardEl.textContent = `${this.state.collectedCards.length}/10`;

    if (this.world) {
      this.world.markVisitedLabels(new Set(this.state.visitedIslands));
    }
  }

  handlePickupShell() {
    this.state.backpack.shell = (this.state.backpack.shell || 0) + 1;
    this.saveState();
    this.bounceBackpackButton();
  }

  bounceBackpackButton() {
    const btn = document.getElementById('btn-backpack');
    if (!btn) return;
    btn.classList.remove('bag-bounce');
    void btn.offsetWidth;
    btn.classList.add('bag-bounce');
  }

  // 居民與動物頭頂對話泡泡
  renderActorBubble(kind, actor) {
    this.activeBubbleActor = { kind, actor };
    const bubble = document.getElementById('npc-bubble');
    const nameEl = document.getElementById('bubble-name');
    const metaEl = document.getElementById('bubble-meta');
    const textEl = document.getElementById('bubble-text');
    const tradeBox = document.getElementById('bubble-trade-box');
    const tradeBtn = document.getElementById('bubble-trade-btn');

    const d = actor.data;
    const lines = d.lines || ['歡迎來到男子漢學習島嶼！'];
    const line = lines[actor.lineIndex % lines.length];

    if (kind === 'animal') {
      nameEl.textContent = `${d.icon} ${d.name}`;
      const isl = this.findIslandName(d.islandId);
      metaEl.textContent = `島嶼小動物 · ${isl}`;
      textEl.textContent = line;
      tradeBox.hidden = true;
      tradeBtn.hidden = true;
    } else {
      nameEl.textContent = `🧑 ${d.name}（${d.role}）`;
      metaEl.textContent = `所在島嶼：${d.islandName}`;
      textEl.textContent = line;

      const trade = this.content.trades.find((t) => t.id === d.tradeId);
      if (trade) {
        tradeBox.hidden = false;
        tradeBtn.hidden = false;
        const haveCount = this.state.backpack[trade.give.id] || 0;
        const canTrade = haveCount >= trade.give.count;
        tradeBox.innerHTML = `
          <div><b>🔁 島民交換提案：</b>用 <b>${trade.give.count} 個 ${trade.give.icon}${trade.give.name}</b> 交換 <b>${trade.get.count} 個 ${trade.get.icon}${trade.get.name}</b></div>
          <div style="margin-top:4px;color:var(--muted);">你目前擁有：${trade.give.icon}${trade.give.name} × ${haveCount} ${canTrade ? '（可交換！）' : `（不足，提示：${trade.hint}）`}</div>
        `;
        tradeBtn.disabled = !canTrade;
        tradeBtn.textContent = canTrade
          ? `🔁 立即交換 ${trade.get.icon}${trade.get.name}`
          : `🔒 缺少 ${trade.give.icon}${trade.give.name}`;
      } else {
        tradeBox.hidden = true;
        tradeBtn.hidden = true;
      }
    }

    bubble.hidden = false;
  }

  positionActorBubble(x, y) {
    const bubble = document.getElementById('npc-bubble');
    if (!bubble || bubble.hidden) return;
    bubble.style.left = `${x.toFixed(1)}px`;
    bubble.style.top = `${y.toFixed(1)}px`;
  }

  hideActorBubble() {
    this.activeBubbleActor = null;
    const bubble = document.getElementById('npc-bubble');
    if (bubble) bubble.hidden = true;
  }

  findIslandName(islandId) {
    if (islandId === 'center-island') return this.content.centerIsland.name;
    const found = this.content.islands.find((i) => i.id === islandId);
    return found ? found.name : '好孩子校本館';
  }

  // 打開島嶼側邊面板（手機底部抽屜）
  openIslandPanel(islandId, initialTab = null) {
    this.currentIslandId = islandId;
    if (!this.state.visitedIslands.includes(islandId)) {
      this.state.visitedIslands.push(islandId);
    }
    // 造訪即解鎖對應圖鑑卡
    const card = this.content.collectionCards.find((c) => c.islandId === islandId);
    if (card && !this.state.collectedCards.includes(card.id)) {
      this.state.collectedCards.push(card.id);
    }
    this.saveState();

    const panel = document.getElementById('island-panel');
    const badgesEl = document.getElementById('panel-badges');
    const titleEl = document.getElementById('panel-title');
    const subEl = document.getElementById('panel-subtitle');
    const tabsEl = document.getElementById('panel-tabs');

    if (islandId === 'center-island') {
      const c = this.content.centerIsland;
      badgesEl.innerHTML = `
        <span class="badge">★ 中央總複習島</span>
        <span class="badge badge-demo">含：男子漢品牌圖書館（示意）</span>
      `;
      titleEl.textContent = c.name;
      subEl.textContent = c.description;

      this.currentTab = initialTab || 'library';
      const tabs = [
        { id: 'library', label: '🏛️ 男子漢品牌圖書館' },
        { id: 'reviewQuiz', label: '🎯 跨課總複習測驗' },
        { id: 'dashboard', label: '📊 學習進度總覽' }
      ];
      tabsEl.innerHTML = tabs
        .map(
          (t) =>
            `<button type="button" class="btn btn-sm ${this.currentTab === t.id ? 'is-active' : ''}" data-panel-tab="${t.id}">${t.label}</button>`
        )
        .join('');
      this.renderCenterPanelBody();
    } else {
      const isl = this.content.islands.find((i) => i.id === islandId);
      if (!isl) return;

      badgesEl.innerHTML = `
        <span class="badge">#${isl.order} ${isl.group}</span>
        ${isl.isDemo ? '<span class="badge badge-demo">示意教材／自編練習題</span>' : ''}
      `;
      titleEl.textContent = isl.name;
      subEl.innerHTML = `
        <div>${isl.intro}</div>
        <div style="margin-top:4px;font-weight:700;color:var(--primary);">🎯 ${this.content.extraLabel}：${isl.extra}</div>
      `;

      this.currentTab = initialTab || 'lesson';
      if (this.currentTab === 'lesson' && !this.state.readLessons.includes(isl.id)) {
        this.state.readLessons.push(isl.id);
        this.saveState();
      }

      const tabs = [
        { id: 'lesson', label: '📖 教材重點' },
        { id: 'worksheet', label: '✍️ 學習單' },
        { id: 'quiz', label: '📝 隨堂測驗' }
      ];
      tabsEl.innerHTML = tabs
        .map(
          (t) =>
            `<button type="button" class="btn btn-sm ${this.currentTab === t.id ? 'is-active' : ''}" data-panel-tab="${t.id}">${t.label}</button>`
        )
        .join('');
      this.renderSubjectPanelBody(isl);
    }

    tabsEl.querySelectorAll('[data-panel-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.currentTab = btn.dataset.panelTab;
        tabsEl.querySelectorAll('[data-panel-tab]').forEach((b) => {
          b.classList.toggle('is-active', b === btn);
        });
        if (this.currentIslandId === 'center-island') {
          this.renderCenterPanelBody();
        } else {
          const isl = this.content.islands.find((i) => i.id === this.currentIslandId);
          this.renderSubjectPanelBody(isl);
        }
      });
    });

    panel.hidden = false;
  }

  closeIslandPanel() {
    const panel = document.getElementById('island-panel');
    if (panel && !panel.hidden) {
      panel.hidden = true;
      this.currentIslandId = null;
      if (this.world) this.world.resetToOverview();
    }
  }

  renderSubjectPanelBody(isl) {
    const body = document.getElementById('panel-body');
    if (!body || !isl) return;

    if (this.currentTab === 'lesson') {
      const islandNpcs = this.content.residents.filter((r) => r.islandId === isl.id);
      body.innerHTML = `
        <div class="info-card">
          <h3>📌 本島三大內容重點 <span class="badge badge-demo">示意</span></h3>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
            ${isl.points.map((p) => `<span class="badge">${p}</span>`).join('')}
          </div>
          <div style="margin-top:10px;font-size:0.84rem;color:var(--muted);">
            📚 教材來源說明：${isl.sourceMaterial}
          </div>
          ${
            isl.link
              ? `<div style="margin-top:8px;">
                  <a href="${isl.link}" target="_blank" rel="noopener noreferrer" class="btn btn-sm">🔗 前往公開參考校網（雲林縣公誠國民小學）↗</a>
                </div>`
              : ''
          }
        </div>

        ${isl.lesson
          .map(
            (sec) => `
          <div class="info-card">
            <h3>${sec.title}</h3>
            <p style="margin:4px 0 8px;"><b>核心觀念：</b>${sec.concept}</p>
            <ul>
              ${sec.bullets.map((b) => `<li>${b}</li>`).join('')}
            </ul>
            <div class="example-box">${sec.example}</div>
          </div>
        `
          )
          .join('')}

        <div class="info-card">
          <h3>🗣️ 與本島居民聊聊知識並交換寶物</h3>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
            ${islandNpcs
              .map(
                (npc) =>
                  `<button type="button" class="btn btn-sm" data-talk-npc="${npc.id}">💬 呼叫 ${npc.name}（${npc.role}）</button>`
              )
              .join('')}
          </div>
        </div>
      `;

      body.querySelectorAll('[data-talk-npc]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (this.world) this.world.triggerNpcTalkById(btn.dataset.talkNpc);
        });
      });
    } else if (this.currentTab === 'worksheet') {
      body.innerHTML = `
        <div class="info-card">
          <h3>✍️ ${isl.name}｜自主探究學習單 <span class="badge badge-demo">自編練習題／示意</span></h3>
          <p style="margin:4px 0;font-size:0.9rem;color:var(--muted);">
            寫下你的想法後按「💾 儲存草稿」會自動保存在瀏覽器，也可以按「📥 匯出 Markdown」下載成檔案交給老師喔！
          </p>
        </div>
        ${isl.worksheet
          .map((w) => {
            const val = this.state.worksheets[w.id] || '';
            return `
            <div class="worksheet-item">
              <div style="font-weight:700;">${w.prompt}</div>
              <div style="font-size:0.82rem;color:var(--muted);margin-top:4px;">💡 思考提示：${w.hint}</div>
              <textarea class="worksheet-textarea" data-ws-id="${w.id}" placeholder="請在這裡輸入你的回答…">${val}</textarea>
            </div>
          `;
          })
          .join('')}
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;">
          <button type="button" class="btn btn-primary" id="btn-save-ws">💾 儲存學習單草稿</button>
          <button type="button" class="btn btn-accent" id="btn-export-ws">📥 匯出 Markdown (.md)</button>
          <span id="ws-save-msg" style="align-self:center;font-weight:700;color:var(--primary);"></span>
        </div>
      `;

      const saveInputs = () => {
        body.querySelectorAll('[data-ws-id]').forEach((ta) => {
          this.state.worksheets[ta.dataset.wsId] = ta.value.trim();
        });
        this.saveState();
      };

      body.querySelector('#btn-save-ws').addEventListener('click', () => {
        saveInputs();
        const msg = body.querySelector('#ws-save-msg');
        if (msg) msg.textContent = '✅ 已成功儲存草稿！';
      });

      body.querySelector('#btn-export-ws').addEventListener('click', () => {
        saveInputs();
        const lines = [
          `# ${this.content.site.title}｜${isl.name} 學習單`,
          `- 分類海域：${isl.group}`,
          `- 學習目標：${isl.extra}`,
          `- 匯出日期：${new Date().toISOString().slice(0, 10)}`,
          ''
        ];
        isl.worksheet.forEach((w) => {
          lines.push(`## ${w.prompt}`);
          lines.push(`- 提示：${w.hint}`);
          lines.push(`- 我的回答：\n${this.state.worksheets[w.id] || '（尚未作答）'}\n`);
        });
        this.downloadTextFile(`${isl.name}_學習單.md`, lines.join('\n'), 'text/markdown');
      });
    } else if (this.currentTab === 'quiz') {
      this.renderQuizSection(body, isl.id, `${isl.name}｜隨堂測驗`, isl.quiz);
    }
  }

  renderCenterPanelBody() {
    const body = document.getElementById('panel-body');
    if (!body) return;
    const c = this.content.centerIsland;

    if (this.currentTab === 'library') {
      const lib = c.library;
      const src = this.content.webSources[0];
      body.innerHTML = `
        <div class="info-card" style="border:2px solid var(--accent);">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
            <h3>🏛️ ${lib.title}</h3>
            <span class="badge badge-demo">${lib.badge}（個人品牌展示）</span>
          </div>
          <p style="font-weight:700;color:var(--primary);margin:6px 0;">${lib.subtitle}</p>
          <div style="font-size:0.9rem;color:var(--muted);">
            👨‍🏫 創辦島主：<b>${lib.founder}</b> ｜ ✉️ 聯絡信箱：<a href="mailto:${lib.contact}" style="color:var(--primary);">${lib.contact}</a><br/>
            🤓 領航吉祥物：<b>${lib.mascotName}</b>
          </div>
        </div>

        ${lib.pillars
          .map(
            (p) => `
          <div class="info-card">
            <h3>${p.title}</h3>
            <p style="white-space:pre-line;margin:0;">${p.content}</p>
          </div>
        `
          )
          .join('')}

        <div class="info-card">
          <h3>🌟 小硬漢老師的學習勉勵金句</h3>
          <ul>
            ${lib.mottoes.map((m) => `<li>${m}</li>`).join('')}
          </ul>
        </div>

        <div class="info-card">
          <h3>🌐 外部公開資料來源與非官方聲明</h3>
          <p style="margin:4px 0;">
            <b>來源網站：</b><a href="${src.url}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);font-weight:700;">${src.title} (${src.url}) ↗</a><br/>
            <b>查詢日期：</b>${src.queryDate}<br/>
            <b>摘要說明：</b>${src.summary}
          </p>
          <div class="example-box">${this.content.disclaimer}</div>
        </div>
      `;
    } else if (this.currentTab === 'reviewQuiz') {
      // 從 9 座島題庫各抽 1 題組成 9 題跨課總複習測驗
      const pool = [];
      this.content.islands.forEach((isl) => {
        if (isl.quiz && isl.quiz.length > 0) {
          const pick = isl.quiz[Math.floor(Math.random() * isl.quiz.length)];
          pool.push({
            ...pick,
            id: `center-${pick.id}`,
            question: `【${isl.name}】${pick.question}`
          });
        }
      });
      this.renderQuizSection(body, 'center-island', '好孩子校本館｜跨課總複習測驗（共 9 題）', pool);
    } else if (this.currentTab === 'dashboard') {
      const prevScore = this.state.quizScores['center-island'];
      body.innerHTML = `
        <div class="info-card">
          <h3>📊 全站課程學習進度總覽</h3>
          <p style="margin:4px 0;">
            已造訪島嶼：<b>${new Set(this.state.visitedIslands).size} / 10</b> ｜
            已讀教材：<b>${this.state.readLessons.length} / 9</b> ｜
            總複習測驗：<b>${prevScore ? `${prevScore.score}/${prevScore.total} 分` : '尚未測驗'}</b>
          </p>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;">
            <button type="button" class="btn btn-primary btn-sm" id="dash-cert-btn">🏅 領取／列印完成證書</button>
            <button type="button" class="btn btn-sm" id="dash-reset-btn">🗑️ 重置全部學習進度</button>
          </div>
        </div>

        <div class="grid-cards">
          ${this.content.islands
            .map((isl) => {
              const visited = this.state.visitedIslands.includes(isl.id);
              const qScore = this.state.quizScores[isl.id];
              const wsDone = isl.worksheet.some((w) => Boolean(this.state.worksheets[w.id]));
              return `
              <div class="card-box">
                <div>
                  <span class="badge">#${isl.order} ${isl.group}</span>
                  <h4 style="margin:6px 0 4px;">${isl.name}</h4>
                  <div style="font-size:0.84rem;color:var(--muted);">
                    狀態：${visited ? '✅ 已探索' : '⏳ 未探索'}<br/>
                    學習單：${wsDone ? '✅ 已存草稿' : '尚未填寫'}<br/>
                    隨堂測驗：${qScore ? `🏆 ${qScore.score}/${qScore.total}` : '尚未作答'}
                  </div>
                </div>
                <button type="button" class="btn btn-sm btn-primary" data-jump-island="${isl.id}">🚀 飛往${isl.name}</button>
              </div>
            `;
            })
            .join('')}
        </div>
      `;

      body.querySelector('#dash-cert-btn').addEventListener('click', () => this.openCertificateModal());
      body.querySelector('#dash-reset-btn').addEventListener('click', () => {
        this.state.visitedIslands = [];
        this.state.readLessons = [];
        this.state.worksheets = {};
        this.state.quizScores = {};
        this.saveState();
        this.renderCenterPanelBody();
      });
      body.querySelectorAll('[data-jump-island]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const targetId = btn.dataset.jumpIsland;
          if (this.world) this.world.focusIsland(targetId, true);
          else this.openIslandPanel(targetId);
        });
      });
    }
  }

  // 渲染測驗（選項打亂後仍以 ID 判分，顯示缺答提醒與每題解析）
  renderQuizSection(container, islandId, quizTitle, questions) {
    const prev = this.state.quizScores[islandId];
    const shuffledQuestions = questions.map((q) => ({
      ...q,
      shuffledOptions: this.shuffleArray([...q.options])
    }));

    const selections = {};

    container.innerHTML = `
      <div class="info-card">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
          <h3>📝 ${quizTitle}</h3>
          <span class="badge badge-demo">自編練習題</span>
        </div>
        <p style="margin:4px 0;font-size:0.9rem;color:var(--muted);">
          每題選項順序皆隨機排列，請點選最合適的答案後按下「送出批改」！
          ${prev ? `<br/><b style="color:var(--primary);">🏆 上次最佳紀錄：${prev.score} / ${prev.total} 題正確</b>` : ''}
        </p>
      </div>
      <div id="quiz-questions-wrap">
        ${shuffledQuestions
          .map(
            (q, qIdx) => `
          <div class="quiz-item" data-q-box="${q.id}">
            <div style="font-weight:700;">第 ${qIdx + 1} 題：${q.question}</div>
            <div class="quiz-options-list">
              ${q.shuffledOptions
                .map(
                  (opt, oIdx) => `
                <button type="button" class="quiz-option" data-q-id="${q.id}" data-opt-id="${opt.id}">
                  <span class="badge">${['A', 'B', 'C', 'D'][oIdx]}</span>
                  <span>${opt.text}</span>
                </button>
              `
                )
                .join('')}
            </div>
            <div class="quiz-feedback" id="fb-${q.id}" hidden></div>
          </div>
        `
          )
          .join('')}
      </div>
      <div id="quiz-alert" style="margin:10px 0;font-weight:700;color:#dc2626;" hidden></div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;">
        <button type="button" class="btn btn-primary" id="btn-submit-quiz">✅ 送出批改並看解析</button>
        <button type="button" class="btn" id="btn-retry-quiz">🔄 重新洗牌再測一次</button>
      </div>
    `;

    container.querySelectorAll('.quiz-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        const qId = btn.dataset.qId;
        const optId = btn.dataset.optId;
        selections[qId] = optId;
        container
          .querySelectorAll(`.quiz-option[data-q-id="${qId}"]`)
          .forEach((b) => b.classList.toggle('selected', b === btn));
      });
    });

    container.querySelector('#btn-submit-quiz').addEventListener('click', () => {
      const unanswered = [];
      shuffledQuestions.forEach((q, idx) => {
        if (!selections[q.id]) unanswered.push(idx + 1);
      });

      const alertEl = container.querySelector('#quiz-alert');
      if (unanswered.length > 0) {
        alertEl.hidden = false;
        alertEl.textContent = `⚠️ 還有第 ${unanswered.join('、')} 題尚未作答，請選完所有題目再送出喔！`;
        return;
      }

      let correctCount = 0;
      shuffledQuestions.forEach((q) => {
        const picked = selections[q.id];
        const isCorrect = picked === q.answerId;
        if (isCorrect) correctCount++;
        const correctOpt = q.options.find((o) => o.id === q.answerId);
        const fb = container.querySelector(`#fb-${q.id}`);
        if (fb) {
          fb.hidden = false;
          fb.className = `quiz-feedback ${isCorrect ? 'correct' : 'wrong'}`;
          fb.innerHTML = `
            <div><b>${isCorrect ? '🎉 答對了！' : `❌ 答錯囉！正確答案是：${correctOpt ? correctOpt.text : ''}`}</b></div>
            <div style="margin-top:4px;">💡 <b>解析：</b>${q.explanation}</div>
          `;
        }
      });

      this.state.quizScores[islandId] = {
        score: correctCount,
        total: shuffledQuestions.length
      };
      this.saveState();

      alertEl.hidden = false;
      alertEl.style.color = 'var(--primary)';
      alertEl.textContent = `🏆 批改完成！你在 ${shuffledQuestions.length} 題中答對了 ${correctCount} 題！請查看上方每題詳細解析。`;
    });

    container.querySelector('#btn-retry-quiz').addEventListener('click', () => {
      this.renderQuizSection(container, islandId, quizTitle, questions);
    });
  }

  shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // 模態視窗控制
  openModal(title, htmlContent, onMount) {
    const backdrop = document.getElementById('app-modal');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    titleEl.textContent = title;
    bodyEl.innerHTML = htmlContent;
    backdrop.hidden = false;
    if (onMount) onMount(bodyEl);
  }

  closeModal() {
    const backdrop = document.getElementById('app-modal');
    if (backdrop) backdrop.hidden = true;
  }

  // 📋 地點清單（含分類海域篩選＋完整居民對話名錄，WebGL 關閉時也能讀完所有內容）
  openListModal(selectedCategory = 'all', isFallback = false) {
    const categories = [
      'all',
      '語文領域',
      '數學領域',
      '自然科學領域',
      '科技領域',
      '健康與體育領域',
      '社會領域',
      '藝術領域'
    ];

    const filtered =
      selectedCategory === 'all'
        ? this.content.islands
        : this.content.islands.filter((i) => i.group === selectedCategory);

    const html = `
      ${
        isFallback
          ? `<div class="example-box" style="margin-bottom:12px;">
              ℹ️ 偵測到目前瀏覽器未啟用 3D WebGL，已自動為您切換為「完整文字清單模式」，您仍可在此閱讀全部 9 座島嶼教材、學習單、測驗與居民對話！
            </div>`
          : ''
      }
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">
        ${categories
          .map(
            (cat) => `
          <button type="button" class="btn btn-sm ${selectedCategory === cat ? 'is-active' : ''}" data-cat-filter="${cat}">
            ${cat === 'all' ? '🌊 全部海域 (9島＋中央島)' : cat}
          </button>
        `
          )
          .join('')}
      </div>

      <div class="info-card" style="border:2px solid var(--primary);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <span class="badge">★ 中央總複習島</span>
            <h3 style="margin:6px 0 4px;">${this.content.centerIsland.name}（含：男子漢品牌圖書館）</h3>
            <p style="margin:0;font-size:0.9rem;color:var(--muted);">${this.content.centerIsland.description}</p>
          </div>
          <div style="display:flex;gap:6px;">
            <button type="button" class="btn btn-sm btn-accent" data-list-open="center-island" data-list-tab="library">🏛️ 品牌圖書館</button>
            <button type="button" class="btn btn-sm btn-primary" data-list-open="center-island" data-list-tab="reviewQuiz">🎯 總複習測驗</button>
          </div>
        </div>
      </div>

      <div class="grid-cards" style="margin-bottom:18px;">
        ${filtered
          .map(
            (isl) => `
          <div class="card-box">
            <div>
              <div style="display:flex;justify-content:space-between;gap:4px;">
                <span class="badge">#${isl.order} ${isl.group}</span>
                <span class="badge badge-demo">示意</span>
              </div>
              <h3 style="margin:8px 0 4px;">${isl.name}</h3>
              <p style="margin:0 0 6px;font-size:0.88rem;">${isl.intro}</p>
              <div style="font-size:0.82rem;color:var(--muted);">
                <b>重點：</b>${isl.points.join('；')}<br/>
                <b>學習目標：</b>${isl.extra}
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn btn-sm btn-primary" data-list-open="${isl.id}" data-list-tab="lesson">📖 讀教材</button>
              <button type="button" class="btn btn-sm" data-list-open="${isl.id}" data-list-tab="quiz">📝 做測驗</button>
            </div>
          </div>
        `
          )
          .join('')}
      </div>

      <div class="info-card">
        <h3>👥 群島居民名單與知識對話一覽（不開 3D 也能完整閱讀）</h3>
        <div style="max-height:240px;overflow-y:auto;padding-right:6px;">
          ${this.content.residents
            .map(
              (r) => `
            <div style="padding:8px 0;border-bottom:1px solid var(--line);">
              <b>🧑 ${r.name}</b>（${r.role} · ${r.islandName}）
              <div style="font-size:0.86rem;color:var(--muted);margin-top:3px;">
                「${r.lines.join('」／「')}」
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;

    this.openModal('📋 地點清單與海域分類導覽', html, (body) => {
      body.querySelectorAll('[data-cat-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.openListModal(btn.dataset.catFilter, isFallback);
        });
      });
      body.querySelectorAll('[data-list-open]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.listOpen;
          const tab = btn.dataset.listTab || 'lesson';
          this.closeModal();
          if (this.world && this.world.webglSupported) {
            this.world.focusIsland(id, false);
          }
          this.openIslandPanel(id, tab);
        });
      });
    });
  }

  // 🎒 背包與島民交換鏈
  openBackpackModal() {
    const itemsHtml = Object.entries(ITEM_META)
      .map(([id, meta]) => {
        const cnt = this.state.backpack[id] || 0;
        return `
          <div class="card-box" style="text-align:center;padding:10px;">
            <div style="font-size:1.8rem;">${meta.icon}</div>
            <div style="font-weight:700;">${meta.name}</div>
            <div class="badge" style="align-self:center;">數量：${cnt}</div>
          </div>
        `;
      })
      .join('');

    const tradesHtml = this.content.trades
      .map((t, idx) => {
        const have = this.state.backpack[t.give.id] || 0;
        const can = have >= t.give.count;
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);">
            <div>
              <b>步驟 ${idx + 1}（${t.islandName}）：</b>
              用 ${t.give.icon}${t.give.name} ×1 ➔ 換 <b>${t.get.icon}${t.get.name} ×1</b>
            </div>
            <button type="button" class="btn btn-sm ${can ? 'btn-accent' : ''}" data-quick-trade="${t.id}" ${can ? '' : 'disabled'}>
              ${can ? '🔁 立即交換' : `缺 ${t.give.icon}${t.give.name}`}
            </button>
          </div>
        `;
      })
      .join('');

    const html = `
      <div class="info-card">
        <h3>🎒 我的探險背包（純前端收集小遊戲，不涉及真實金錢）</h3>
        <p style="margin:4px 0;font-size:0.9rem;color:var(--muted);">
          點擊各島沙灘上的粉色 🐚 貝殼（撿了 +1，20 秒重生），就能沿著九座學科島嶼一路跟居民交換，最終換到「💎 男子漢榮譽星鑽」！
        </p>
        <div class="grid-cards" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr));margin-top:10px;">
          ${itemsHtml}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
          <button type="button" class="btn btn-sm" id="btn-reset-bag">🗑️ 清空背包（重置為 3 個貝殼）</button>
        </div>
      </div>

      <div class="info-card">
        <h3>🔁 跨島寶物交換鏈一覽</h3>
        ${tradesHtml}
      </div>
    `;

    this.openModal('🎒 探險背包與居民交換鏈', html, (body) => {
      body.querySelector('#btn-reset-bag').addEventListener('click', () => {
        this.state.backpack = this.defaultState().backpack;
        this.saveState();
        this.openBackpackModal();
      });

      body.querySelectorAll('[data-quick-trade]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.executeTradeById(btn.dataset.quickTrade);
          this.openBackpackModal();
        });
      });
    });
  }

  executeTradeById(tradeId) {
    const trade = this.content.trades.find((t) => t.id === tradeId);
    if (!trade) return false;
    const have = this.state.backpack[trade.give.id] || 0;
    if (have < trade.give.count) return false;

    this.state.backpack[trade.give.id] = have - trade.give.count;
    this.state.backpack[trade.get.id] = (this.state.backpack[trade.get.id] || 0) + trade.get.count;
    this.saveState();
    this.bounceBackpackButton();
    return true;
  }

  // 🔑 每日鑰匙寶箱
  openDailyKeyModal() {
    const rem = this.state.dailyKeys.remaining;
    const html = `
      <div class="info-card" style="text-align:center;">
        <div style="font-size:3rem;">🎁</div>
        <h3>每日知識寶箱（今日剩餘鑰匙：🔑 ${rem} / 3）</h3>
        <p style="color:var(--muted);">
          每天有 3 把免費知識鑰匙，打開寶箱可獲得 <b>🐚 貝殼 × 2</b> 並隨機解鎖一張<b>學科知識圖鑑卡</b>！
        </p>
        <button type="button" class="btn btn-primary" id="btn-open-chest" ${rem <= 0 ? 'disabled' : ''}>
          ${rem > 0 ? '🔑 使用 1 把鑰匙開啟寶箱' : '⏳ 今日鑰匙已用完，明天再來！'}
        </button>
        <div id="chest-reward-msg" style="margin-top:12px;font-weight:700;color:var(--accent);"></div>
      </div>
    `;

    this.openModal('🔑 每日鑰匙與知識寶箱', html, (body) => {
      const openBtn = body.querySelector('#btn-open-chest');
      const msgEl = body.querySelector('#chest-reward-msg');
      openBtn.addEventListener('click', () => {
        if (this.state.dailyKeys.remaining <= 0) return;
        this.state.dailyKeys.remaining -= 1;
        this.state.backpack.shell = (this.state.backpack.shell || 0) + 2;

        const locked = this.content.collectionCards.filter(
          (c) => !this.state.collectedCards.includes(c.id)
        );
        let cardRewardText = '';
        if (locked.length > 0) {
          const picked = locked[Math.floor(Math.random() * locked.length)];
          this.state.collectedCards.push(picked.id);
          cardRewardText = `，並解鎖了【${picked.icon} ${picked.title}】圖鑑卡！`;
        }
        this.saveState();
        this.bounceBackpackButton();
        openBtn.textContent =
          this.state.dailyKeys.remaining > 0
            ? `🔑 再開一次（剩餘 ${this.state.dailyKeys.remaining}/3）`
            : '⏳ 今日鑰匙已用完';
        openBtn.disabled = this.state.dailyKeys.remaining <= 0;
        msgEl.textContent = `🎉 恭喜獲得 🐚 貝殼 × 2${cardRewardText}`;
      });
    });
  }

  // 🃏 收集圖鑑
  openCollectionModal() {
    const html = `
      <div class="info-card">
        <h3>🃏 男子漢學科知識圖鑑（已收集 ${this.state.collectedCards.length} / 10）</h3>
        <p style="margin:4px 0;font-size:0.9rem;color:var(--muted);">
          造訪各座島嶼或使用「🔑 每日鑰匙」開啟寶箱，就能收集全部 10 張學科概念精華卡！
        </p>
      </div>
      <div class="grid-cards">
        ${this.content.collectionCards
          .map((c) => {
            const unlocked = this.state.collectedCards.includes(c.id);
            return `
            <div class="card-box" style="opacity:${unlocked ? '1' : '0.6'};border-color:${unlocked ? 'var(--primary)' : 'var(--line)'};">
              <div>
                <div style="font-size:2rem;">${unlocked ? c.icon : '🔒'}</div>
                <span class="badge">${c.islandName}</span>
                <h4 style="margin:6px 0 4px;">${unlocked ? c.title : '尚未解鎖圖鑑卡'}</h4>
                <p style="margin:0;font-size:0.86rem;color:var(--muted);">
                  ${unlocked ? c.summary : '前往該島探索或開啟每日寶箱即可解鎖！'}
                </p>
              </div>
              <button type="button" class="btn btn-sm" data-card-go="${c.islandId}">📍 前往 ${c.islandName}</button>
            </div>
          `;
          })
          .join('')}
      </div>
    `;

    this.openModal('🃏 收集圖鑑', html, (body) => {
      body.querySelectorAll('[data-card-go]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.cardGo;
          this.closeModal();
          if (this.world && this.world.webglSupported) this.world.focusIsland(id, true);
          else this.openIslandPanel(id);
        });
      });
    });
  }

  // 🤖 小硬漢問答（純前端關鍵字比對網站內容並附出處，不出題目答案、不需 API 金鑰）
  openGuideModal() {
    const html = `
      <div class="info-card">
        <h3>🤓 小硬漢老師知識問答助教</h3>
        <p style="margin:4px 0;font-size:0.9rem;color:var(--muted);">
          輸入你想查詢的學科關鍵字（例如：<b>六何法、母音、周長、面積、昆蟲、磁鐵、程式、暖身、地圖、直笛、三原色、圖書館</b>），小硬漢老師會從群島教材幫你找出觀念並附上出處島嶼！
        </p>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <input type="text" id="guide-query-input" placeholder="請輸入關鍵字，例如：周長、昆蟲、六何法…" style="flex:1;min-height:44px;padding:8px 12px;border-radius:10px;border:1.5px solid var(--line);background:var(--surface-solid);color:var(--ink);font-size:0.95rem;" />
          <button type="button" class="btn btn-primary" id="guide-ask-btn">🔍 查詢觀念</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
          ${['六何法', '自然發音', '周長與面積', '昆蟲', '條件判斷', '運動安全', '地圖四要素', '直笛', '三原色', '品牌圖書館']
            .map((kw) => `<button type="button" class="btn btn-sm" data-kw-chip="${kw}">#${kw}</button>`)
            .join('')}
        </div>
      </div>
      <div id="guide-answer-box"></div>
    `;

    this.openModal('🤖 小硬漢問答（課內概念檢索）', html, (body) => {
      const input = body.querySelector('#guide-query-input');
      const ansBox = body.querySelector('#guide-answer-box');

      const runQuery = (q) => {
        const kw = q.trim().toLowerCase();
        if (!kw) return;
        const matches = [];

        // 比對中央圖書館
        const lib = this.content.centerIsland.library;
        if (
          lib.title.toLowerCase().includes(kw) ||
          lib.pillars.some((p) => p.title.toLowerCase().includes(kw) || p.content.toLowerCase().includes(kw))
        ) {
          matches.push({
            islandId: 'center-island',
            islandName: '好孩子校本館（男子漢品牌圖書館）',
            title: lib.title,
            text: lib.pillars[0].content
          });
        }

        // 比對 9 座島教材
        this.content.islands.forEach((isl) => {
          isl.lesson.forEach((sec) => {
            const hay = `${isl.name} ${isl.intro} ${sec.title} ${sec.concept} ${sec.bullets.join(' ')} ${sec.example}`.toLowerCase();
            if (hay.includes(kw)) {
              matches.push({
                islandId: isl.id,
                islandName: isl.name,
                title: sec.title,
                text: `${sec.concept}（${sec.bullets[0]}）`
              });
            }
          });
        });

        if (matches.length === 0) {
          ansBox.innerHTML = `
            <div class="info-card">
              <p>🤓 小硬漢老師：「找不到與『<b>${q}</b>』直接相符的段落，試試看點選上方的熱門關鍵字標籤，或輸入『國語、數學、自然、地圖、色彩』喔！」</p>
            </div>
          `;
          return;
        }

        ansBox.innerHTML = matches
          .slice(0, 5)
          .map(
            (m) => `
            <div class="info-card">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                <span class="badge">📍 出處：${m.islandName}</span>
                <button type="button" class="btn btn-sm btn-primary" data-guide-jump="${m.islandId}">前往 ${m.islandName}</button>
              </div>
              <h4 style="margin:8px 0 4px;">${m.title}</h4>
              <p style="margin:0;font-size:0.92rem;">${m.text}</p>
            </div>
          `
          )
          .join('');

        ansBox.querySelectorAll('[data-guide-jump]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.guideJump;
            this.closeModal();
            if (this.world && this.world.webglSupported) this.world.focusIsland(id, true);
            else this.openIslandPanel(id);
          });
        });
      };

      body.querySelector('#guide-ask-btn').addEventListener('click', () => runQuery(input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runQuery(input.value);
      });
      body.querySelectorAll('[data-kw-chip]').forEach((chip) => {
        chip.addEventListener('click', () => {
          input.value = chip.dataset.kwChip;
          runQuery(input.value);
        });
      });
    });
  }

  // 🏅 完成證書（可自訂姓名、下載 PNG 或列印）
  openCertificateModal() {
    const visited = new Set(this.state.visitedIslands).size;
    const quizCount = Object.keys(this.state.quizScores).length;
    const html = `
      <div class="info-card">
        <h3>🏅 男子漢學習島嶼｜榮譽完成證書</h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0;">
          <label for="cert-name-input" style="font-weight:700;">獲獎學員姓名：</label>
          <input type="text" id="cert-name-input" value="${this.state.studentName}" style="min-height:44px;padding:6px 12px;border-radius:10px;border:1.5px solid var(--line);background:var(--surface-solid);color:var(--ink);font-size:0.95rem;" />
          <button type="button" class="btn btn-sm" id="cert-redraw-btn">🔄 更新預覽</button>
        </div>
        <canvas id="cert-canvas" width="800" height="520" style="width:100%;height:auto;border-radius:12px;border:2px solid var(--primary);"></canvas>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
          <button type="button" class="btn btn-primary" id="cert-download-btn">📥 下載證書圖片 (.png)</button>
          <button type="button" class="btn btn-accent" id="cert-print-btn">🖨️ 列印證書</button>
        </div>
      </div>
    `;

    this.openModal('🏅 學習完成證書', html, (body) => {
      const nameInput = body.querySelector('#cert-name-input');
      const canvas = body.querySelector('#cert-canvas');
      const drawCert = () => {
        this.state.studentName = nameInput.value.trim() || '好孩子小學堂學員';
        this.saveState();
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fffcf5';
        ctx.fillRect(0, 0, 800, 520);

        ctx.strokeStyle = '#2f7a6b';
        ctx.lineWidth = 12;
        ctx.strokeRect(20, 20, 760, 480);

        ctx.strokeStyle = '#d9792f';
        ctx.lineWidth = 4;
        ctx.strokeRect(34, 34, 732, 452);

        ctx.fillStyle = '#2f7a6b';
        ctx.font = 'bold 34px "Noto Sans TC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('男子漢學習島嶼｜學習榮譽證書', 400, 105);

        ctx.fillStyle = '#475569';
        ctx.font = '20px "Noto Sans TC", sans-serif';
        ctx.fillText('好孩子校本館 × 九大學科領域課程群島', 400, 145);

        ctx.fillStyle = '#162420';
        ctx.font = 'bold 36px "Noto Sans TC", sans-serif';
        ctx.fillText(`茲證明  ${this.state.studentName}`, 400, 225);

        ctx.font = '21px "Noto Sans TC", sans-serif';
        ctx.fillText(
          `於「男子漢學習島嶼」完成 ${visited}/10 座島嶼探索、通過 ${quizCount} 項測驗挑戰，`,
          400,
          280
        );
        ctx.fillText('展現不怕困難、主動探索各領域學習概念之硬漢精神，特頒此狀！', 400, 318);

        ctx.fillStyle = '#d9792f';
        ctx.font = 'bold 20px "Noto Sans TC", sans-serif';
        ctx.fillText(`頒發單位：${this.content.site.author} ｜ 領航員：小硬漢老師`, 400, 395);

        ctx.fillStyle = '#64748b';
        ctx.font = '17px "Noto Sans TC", sans-serif';
        ctx.fillText(`頒發日期：${new Date().toISOString().slice(0, 10)}`, 400, 435);
      };

      drawCert();
      body.querySelector('#cert-redraw-btn').addEventListener('click', drawCert);
      body.querySelector('#cert-download-btn').addEventListener('click', () => {
        drawCert();
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `男子漢學習島嶼_完成證書_${this.state.studentName}.png`;
        a.click();
      });
      body.querySelector('#cert-print-btn').addEventListener('click', () => window.print());
    });
  }

  // 💾 接關碼（Base64 編碼／還原，不含個資，貼錯有清楚提示）
  openSaveCodeModal() {
    const payload = {
      v: 1,
      visitedIslands: this.state.visitedIslands,
      readLessons: this.state.readLessons,
      quizScores: this.state.quizScores,
      backpack: this.state.backpack,
      collectedCards: this.state.collectedCards
    };
    const code = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));

    const html = `
      <div class="info-card">
        <h3>💾 複製我的接關碼</h3>
        <p style="margin:4px 0;font-size:0.9rem;color:var(--muted);">
          換電腦或手機時，複製下方接關碼貼到新裝置，就能立刻接續你的探索進度、背包寶物與收集圖鑑（代碼不含個人隱私資料）：
        </p>
        <textarea id="savecode-out" class="worksheet-textarea" readonly>${code}</textarea>
        <button type="button" class="btn btn-primary btn-sm" id="btn-copy-code" style="margin-top:8px;">📋 複製接關碼</button>
      </div>

      <div class="info-card">
        <h3>📥 貼上接關碼還原進度</h3>
        <textarea id="savecode-in" class="worksheet-textarea" placeholder="請在此貼上你的接關碼…"></textarea>
        <div style="display:flex;gap:10px;align-items:center;margin-top:8px;">
          <button type="button" class="btn btn-accent btn-sm" id="btn-restore-code">🔄 還原進度</button>
          <span id="savecode-msg" style="font-weight:700;"></span>
        </div>
      </div>
    `;

    this.openModal('💾 跨裝置接關碼', html, (body) => {
      const msg = body.querySelector('#savecode-msg');
      body.querySelector('#btn-copy-code').addEventListener('click', () => {
        navigator.clipboard?.writeText(code);
        msg.style.color = 'var(--primary)';
        msg.textContent = '✅ 已複製接關碼到剪貼簿！';
      });

      body.querySelector('#btn-restore-code').addEventListener('click', () => {
        const raw = body.querySelector('#savecode-in').value.trim();
        try {
          const decoded = JSON.parse(decodeURIComponent(escape(atob(raw))));
          if (!decoded || typeof decoded !== 'object' || !Array.isArray(decoded.visitedIslands)) {
            throw new Error('Invalid structure');
          }
          this.state.visitedIslands = decoded.visitedIslands;
          this.state.readLessons = decoded.readLessons || [];
          this.state.quizScores = decoded.quizScores || {};
          this.state.backpack = { ...this.state.backpack, ...(decoded.backpack || {}) };
          this.state.collectedCards = decoded.collectedCards || [];
          this.saveState();
          msg.style.color = '#16a34a';
          msg.textContent = '🎉 接關碼還原成功！進度與背包已更新。';
        } catch {
          msg.style.color = '#dc2626';
          msg.textContent = '❌ 接關碼格式不正確，請確認是否完整複製喔！';
        }
      });
    });
  }

  // 📤 分享卡片
  openShareModal() {
    const html = `
      <div class="info-card">
        <h3>📤 產生「男子漢學習島嶼」分享圖卡</h3>
        <canvas id="share-canvas" width="720" height="420" style="width:100%;height:auto;border-radius:12px;border:2px solid var(--primary);margin-top:8px;"></canvas>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
          <button type="button" class="btn btn-primary" id="btn-dl-share">📥 下載分享圖卡 (.png)</button>
          <button type="button" class="btn" id="btn-copy-url">🔗 複製本站網址</button>
          <span id="share-msg" style="align-self:center;font-weight:700;color:var(--primary);"></span>
        </div>
      </div>
    `;

    this.openModal('📤 分享學習成果', html, (body) => {
      const sc = body.querySelector('#share-canvas');
      const ctx = sc.getContext('2d');
      ctx.fillStyle = '#16222e';
      ctx.fillRect(0, 0, 720, 420);

      try {
        const glCanvas = document.getElementById('webgl-canvas');
        ctx.drawImage(glCanvas, 0, 0, 720, 420);
      } catch {
        // ignore if fallback
      }

      ctx.fillStyle = 'rgba(22, 34, 46, 0.78)';
      ctx.fillRect(0, 295, 720, 125);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 26px "Noto Sans TC", sans-serif';
      ctx.fillText('🏝️ 男子漢學習島嶼｜跟著男子漢一起來學習', 24, 340);

      ctx.fillStyle = '#f59b4c';
      ctx.font = '19px "Noto Sans TC", sans-serif';
      ctx.fillText(
        `已探索 ${new Set(this.state.visitedIslands).size}/10 座島嶼 · 收集 ${this.state.collectedCards.length}/10 張知識圖鑑卡`,
        24,
        378
      );

      body.querySelector('#btn-dl-share').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = sc.toDataURL('image/png');
        a.download = '男子漢學習島嶼_分享卡.png';
        a.click();
      });

      body.querySelector('#btn-copy-url').addEventListener('click', () => {
        navigator.clipboard?.writeText(window.location.href);
        body.querySelector('#share-msg').textContent = '✅ 已複製網址！';
      });
    });
  }

  // ❓ 操作說明與資料來源聲明
  openHelpModal() {
    const src = this.content.webSources[0];
    const html = `
      <div class="info-card">
        <h3>🤓 小硬漢老師的群島操作指南</h3>
        <p>${this.content.site.mascot.greeting}</p>
        <ul>
          <li><b>旋轉與縮放：</b>滑鼠左鍵／單指拖曳可旋轉群島；滾輪／雙指可放大縮小；按「🗺️ 回到全景」回到俯瞰視角。</li>
          <li><b>登島學習：</b>點擊任一座 3D 島嶼、島名標籤或「📋 地點清單」，即可打開<b>教材、學習單、隨堂測驗</b>三分頁。</li>
          <li><b>中央島【男子漢品牌圖書館】：</b>點選上方「🏛️ 品牌圖書館」或中央大島，可瀏覽個人品牌理念並挑戰跨課總複習！</li>
          <li><b>生活感互動：</b>點擊島上散步的<b>居民</b>或<b>松鼠🐿️、小狗🐶、貓咪🐱</b>可聊天；撿取沙灘上的<b>🐚貝殼</b>可跟居民交換寶物！</li>
          <li><b>字體大小設定：</b>點選頂部「🔠 字級」按鈕，可自由切換「小／標準／大／特大」字體。</li>
        </ul>
      </div>

      <div class="info-card">
        <h3>🌐 資料來源區與非官方聲明</h3>
        <ul>
          <li>
            <b>${src.title}</b>：<a href="${src.url}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);">${src.url} ↗</a>（查詢日期：${src.queryDate}）<br/>
            <span style="font-size:0.88rem;color:var(--muted);">${src.summary}</span>
          </li>
        </ul>
        <div class="example-box" id="site-footer-note">${this.content.disclaimer}</div>
      </div>
    `;
    this.openModal('❓ 網站說明與資料來源', html);
  }

  // 🎵 Web Audio 合成輕快木琴海島背景音樂（使用者按下才播放，不抓外部音檔）
  toggleMusic() {
    const btn = document.getElementById('btn-music');
    if (this.isMusicPlaying) {
      this.isMusicPlaying = false;
      if (this.musicTimer) clearInterval(this.musicTimer);
      this.musicTimer = null;
      if (btn) btn.textContent = '🎵 音樂：關';
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!this.audioCtx) this.audioCtx = new AudioContextClass();
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

    this.isMusicPlaying = true;
    if (btn) btn.textContent = '🎵 音樂：開';

    const notes = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 440.0, 392.0];
    let step = 0;

    const playNote = () => {
      if (!this.isMusicPlaying || !this.audioCtx) return;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = notes[step % notes.length];
      step++;

      const now = this.audioCtx.currentTime;
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.45);
    };

    playNote();
    this.musicTimer = setInterval(playNote, 520);
  }

  downloadTextFile(filename, text, mime) {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  bindUiEvents() {
    // 搜尋功能
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');

    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      if (!q) {
        searchResults.hidden = true;
        return;
      }
      const hits = [];
      if (
        this.content.centerIsland.name.toLowerCase().includes(q) ||
        '圖書館'.includes(q) ||
        '總複習'.includes(q)
      ) {
        hits.push({
          id: 'center-island',
          title: `★ ${this.content.centerIsland.name}（含品牌圖書館）`,
          sub: this.content.centerIsland.description
        });
      }
      this.content.islands.forEach((isl) => {
        const hay = `${isl.name} ${isl.group} ${isl.intro} ${isl.points.join(' ')} ${isl.extra}`.toLowerCase();
        if (hay.includes(q)) {
          hits.push({
            id: isl.id,
            title: `#${isl.order} ${isl.name}（${isl.group}）`,
            sub: isl.intro
          });
        }
      });

      if (hits.length === 0) {
        searchResults.innerHTML = `<div style="padding:8px 10px;color:var(--muted);">找不到符合「${searchInput.value}」的島嶼</div>`;
      } else {
        searchResults.innerHTML = hits
          .map(
            (h) => `
          <button type="button" class="search-item" data-search-go="${h.id}">
            <div style="font-weight:700;">${h.title}</div>
            <div style="font-size:0.78rem;color:var(--muted);">${h.sub}</div>
          </button>
        `
          )
          .join('');
        searchResults.querySelectorAll('[data-search-go]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.searchGo;
            searchResults.hidden = true;
            searchInput.value = '';
            if (this.world && this.world.webglSupported) this.world.focusIsland(id, true);
            else this.openIslandPanel(id);
          });
        });
      }
      searchResults.hidden = false;
    });

    // 頂部按鈕
    document.getElementById('mascot-btn').addEventListener('click', () => this.openGuideModal());
    document.getElementById('btn-list').addEventListener('click', () => this.openListModal());
    document.getElementById('btn-library').addEventListener('click', () => {
      if (this.world && this.world.webglSupported) this.world.focusIsland('center-island', false);
      this.openIslandPanel('center-island', 'library');
    });
    document.getElementById('btn-overview').addEventListener('click', () => {
      this.closeIslandPanel();
      if (this.world) this.world.resetToOverview();
    });
    document.getElementById('btn-font-size').addEventListener('click', () => this.cycleFontSize());
    document.getElementById('btn-replay-cinema').addEventListener('click', () => {
      this.closeIslandPanel();
      this.startCinemaOverlay();
    });
    document.getElementById('btn-help').addEventListener('click', () => this.openHelpModal());

    // 電影開場點擊跳過
    const cinemaOverlay = document.getElementById('cinema-overlay');
    cinemaOverlay.addEventListener('click', () => {
      cinemaOverlay.hidden = true;
      if (this.world) this.world.skipCinemaIntro();
    });

    // 面板關閉按鈕
    document.getElementById('panel-close-btn').addEventListener('click', () => this.closeIslandPanel());

    // 居民泡泡按鈕
    document.getElementById('bubble-close-btn').addEventListener('click', () => {
      if (this.world) this.world.closeActorBubble();
    });
    document.getElementById('bubble-dismiss-btn').addEventListener('click', () => {
      if (this.world) this.world.closeActorBubble();
    });
    document.getElementById('bubble-next-btn').addEventListener('click', () => {
      if (!this.activeBubbleActor) return;
      const { kind, actor } = this.activeBubbleActor;
      actor.lineIndex = (actor.lineIndex + 1) % (actor.data.lines?.length || 1);
      this.renderActorBubble(kind, actor);
    });
    document.getElementById('bubble-trade-btn').addEventListener('click', () => {
      if (!this.activeBubbleActor || this.activeBubbleActor.kind !== 'npc') return;
      const { actor } = this.activeBubbleActor;
      const ok = this.executeTradeById(actor.data.tradeId);
      if (ok) {
        document.getElementById('bubble-text').textContent = `🎉 太棒了！謝謝你跟我交換，快打開背包看看你的新寶物吧！`;
        this.renderActorBubble('npc', actor);
      }
    });

    // 底色切換按鈕（🌅 自動 / 晨光 / 海霧 / 夜海）
    document.querySelectorAll('[data-theme-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.applyThemeMode(btn.dataset.themeBtn);
      });
    });

    // 晝夜切換按鈕（☀️白天 / 🌇黃昏 / 🌙夜晚 / ⏱自動 / 🕒同步）
    document.querySelectorAll('[data-time-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setTimeMode(btn.dataset.timeBtn);
      });
    });

    // 底部多功能列
    document.getElementById('btn-backpack').addEventListener('click', () => this.openBackpackModal());
    document.getElementById('btn-daily-key').addEventListener('click', () => this.openDailyKeyModal());
    document.getElementById('btn-collection').addEventListener('click', () => this.openCollectionModal());
    document.getElementById('btn-guide').addEventListener('click', () => this.openGuideModal());
    document.getElementById('btn-music').addEventListener('click', () => this.toggleMusic());
    document.getElementById('btn-motion').addEventListener('click', (e) => {
      const next = !this.world.reducedMotion;
      this.world.setReducedMotion(next);
      e.currentTarget.textContent = `🐢 減少動態：${next ? '開' : '關'}`;
    });
    document.getElementById('btn-quality').addEventListener('click', () => {
      if (this.world) this.world.setQuality(!this.world.lowQuality);
    });
    document.getElementById('btn-certificate').addEventListener('click', () => this.openCertificateModal());
    document.getElementById('btn-savecode').addEventListener('click', () => this.openSaveCodeModal());
    document.getElementById('btn-share').addEventListener('click', () => this.openShareModal());

    // 模態關閉
    document.getElementById('modal-close-btn').addEventListener('click', () => this.closeModal());
    document.getElementById('app-modal').addEventListener('click', (e) => {
      if (e.target.id === 'app-modal') this.closeModal();
    });

    // 全域 Esc 快捷鍵支援（跳過開場 / 關對話泡泡 / 關模態 / 關面板）
    window.addEventListener('keydown', (e) => {
      if (this.world && this.world.isCinemaPlaying) {
        document.getElementById('cinema-overlay').hidden = true;
        this.world.skipCinemaIntro();
        return;
      }
      if (e.key === 'Escape') {
        if (!document.getElementById('app-modal').hidden) {
          this.closeModal();
        } else if (!document.getElementById('npc-bubble').hidden) {
          if (this.world) this.world.closeActorBubble();
        } else if (!document.getElementById('island-panel').hidden) {
          this.closeIslandPanel();
        }
      }
    });
  }
}

const app = new ToughGuyIslandApp();
window.toughGuyApp = app;
app.init();
