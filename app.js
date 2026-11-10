/**
 * app.js —— 界面交互层
 * 只负责：渲染、表单、筛选、备份导入导出；业务规则全部在 store.js
 */
(function () {
  'use strict';

  var S = window.StudyStore;

  function fatal(msg) {
    var p = document.createElement('p');
    p.className = 'banner';
    p.style.margin = '16px';
    p.textContent = msg;
    document.body.insertBefore(p, document.body.firstChild);
  }

  if (!S) {
    fatal('数据模块 store.js 未加载成功：请确认 store.js 与 index.html 在同一个文件夹里。');
    return;
  }

  /* ------------------------------------------------------------------ *
   * 存储初始化（隐私模式 / file:// 受限时降级为内存存储）
   * ------------------------------------------------------------------ */

  function makeMemoryStorage() {
    var map = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
      setItem: function (k, v) { map[k] = String(v); },
      removeItem: function (k) { delete map[k]; }
    };
  }

  var storage = null;
  try {
    var probe = '__study_log_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    storage = window.localStorage;
  } catch (e) {
    storage = null;
  }

  var state = S.loadState(storage);
  var fallbackStorage = storage ? null : makeMemoryStorage();
  var store = storage || fallbackStorage;

  // 本地数据无法解析时，先把它另存一份：否则用户一保存新记录，旧数据就被覆盖了
  if (state.corrupt && storage) {
    try {
      var brokenRaw = storage.getItem(S.STORAGE_KEY);
      if (brokenRaw) storage.setItem(S.STORAGE_KEY + '.broken', brokenRaw);
    } catch (e) {
      /* 空间不足就放弃备份，但不阻断启动 */
    }
  }

  var loadWarningEl = document.getElementById('load-warning');

  /** 把"读取时丢了数据/无法解析"这类情况明确告诉用户，而不是默默吞掉 */
  function showLoadWarning(loaded) {
    if (!loadWarningEl) return;
    var messages = [];
    if (loaded && loaded.corrupt) {
      messages.push('本地数据无法解析，已按空数据启动。原始内容已另存为 ' + S.STORAGE_KEY + '.broken，建议先导出备份再清理浏览器数据。');
    } else if (loaded && loaded.dropped > 0) {
      messages.push('有 ' + loaded.dropped + ' 条记录数据不完整，已跳过；其余 ' + loaded.records.length + ' 条已正常载入。');
    }
    if (!messages.length) {
      loadWarningEl.hidden = true;
      loadWarningEl.textContent = '';
      return;
    }
    loadWarningEl.textContent = messages.join(' ');
    loadWarningEl.hidden = false;
  }

  if (!storage) {
    document.getElementById('storage-warning').hidden = false;
  }

  /* ------------------------------------------------------------------ *
   * DOM 引用
   * ------------------------------------------------------------------ */

  var el = {
    form: document.getElementById('record-form'),
    formTitle: document.getElementById('form-title'),
    formToggle: document.getElementById('form-toggle'),
    formCard: document.querySelector('.form-card'),
    subjectChips: document.getElementById('subject-chips'),
    date: document.getElementById('date-input'),
    minutes: document.getElementById('minutes-input'),
    content: document.getElementById('content-input'),
    submit: document.getElementById('submit-btn'),
    cancel: document.getElementById('cancel-btn'),
    filterSubjects: document.getElementById('filter-subjects'),
    filterRange: document.getElementById('filter-range'),
    summary: document.getElementById('summary'),
    records: document.getElementById('records'),
    listCount: document.getElementById('list-count'),
    searchInput: document.getElementById('search-input'),
    quickMinutes: document.getElementById('quick-minutes'),
    trend: document.getElementById('trend-chart'),
    chartMeta: document.getElementById('chart-meta'),
    chartCompare: document.getElementById('chart-compare'),
    chartLegend: document.getElementById('chart-legend'),
    chartRange: document.getElementById('chart-range'),
    csvBtn: document.getElementById('csv-btn'),
    exportBtn: document.getElementById('export-btn'),
    importBtn: document.getElementById('import-btn'),
    importInput: document.getElementById('import-input'),
    clearBtn: document.getElementById('clear-btn'),
    toast: document.getElementById('toast'),
    toastText: document.getElementById('toast-text'),
    toastAction: document.getElementById('toast-action'),
    extraFields: document.getElementById('extra-fields'),
    tagsInput: document.getElementById('tags-input'),
    templateBtn: document.getElementById('template-btn'),
    reviewInput: document.getElementById('review-input'),
    reviewCard: document.getElementById('review-card'),
    reviewCount: document.getElementById('review-count'),
    reviewList: document.getElementById('review-list'),
    tagStats: document.getElementById('tag-stats'),
    goalInput: document.getElementById('goal-input'),
    examInput: document.getElementById('exam-input'),
    examPill: document.getElementById('exam-pill'),
    totals: document.getElementById('totals'),
    knowledgeCard: document.getElementById('knowledge-card'),
    knowledgeList: document.getElementById('knowledge-list'),
    knowledgeMeta: document.getElementById('knowledge-meta'),
    imageBtn: document.getElementById('image-btn'),
    imageInput: document.getElementById('image-input'),
    imageStrip: document.getElementById('image-strip'),
    imageDialog: document.getElementById('image-dialog'),
    imageViewer: document.getElementById('image-viewer'),
    imageClose: document.getElementById('image-close'),
    reportBtn: document.getElementById('report-btn'),
    reportDialog: document.getElementById('report-dialog'),
    reportText: document.getElementById('report-text'),
    reportCopy: document.getElementById('report-copy'),
    reportClose: document.getElementById('report-close'),
    reportHint: document.getElementById('report-hint')
  };

  var errors = {
    subject: document.getElementById('err-subject'),
    date: document.getElementById('err-date'),
    minutes: document.getElementById('err-minutes'),
    content: document.getElementById('err-content'),
    tags: document.getElementById('err-tags'),
    form: document.getElementById('err-form')
  };

  var formSubject = S.SUBJECTS[0].id;
  var editingId = null;
  var subjectBeforeEdit = null;
  var filters = { subject: 'all', range: 'all', keyword: '', tag: '' };
  var settings = S.loadSettings(store);

  /**
   * "是否用过"标记：只有真正的新用户才显示「载入示例数据」。
   * 否则用户清空全部数据后，空状态里的示例按钮一点就把 5 条示例又加回来，
   * 看起来就像"删了没生效"。
   */
  var ONBOARD_KEY = 'study-log:onboarded';

  function hasOnboarded() {
    try { return Boolean(store && store.getItem(ONBOARD_KEY) === '1'); } catch (e) { return false; }
  }

  function markOnboarded() {
    try { if (store) store.setItem(ONBOARD_KEY, '1'); } catch (e) { /* 隐私模式写入失败可忽略 */ }
  }

  /** 重新从存储读取数据，避免多标签页/后台恢复时用旧内存状态覆盖别人的删除 */
  function reloadStateFromStorage() {
    var loaded = S.loadState(store);
    state = { version: loaded.version, records: loaded.records };
    return loaded;
  }

  /* ---------- 图片附件状态 ---------- */
  var StudyFiles = window.StudyFiles || null;
  var imageSupported = Boolean(StudyFiles && StudyFiles.supported);
  var formImages = [];                 // 表单里待保存的图片 id
  var previewCache = Object.create(null); // id → objectURL，避免重复读取
  var viewerUrl = null;                // 大图弹窗当前 objectURL
  var imageCleanupTimer = null;        // 删除记录后延迟清理图片（给撤销留时间）

  /** 一键恢复"看全部"状态（导入后、或用户点清除时用） */
  function resetFilters() {
    filters = { subject: 'all', range: 'all', keyword: '', tag: '' };
    if (el.searchInput) el.searchInput.value = '';
    syncFilterChips();
  }

  /* ------------------------------------------------------------------ *
   * 小工具
   * ------------------------------------------------------------------ */

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value == null || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'style') node.setAttribute('style', value);
        else if (key === 'onclick') node.addEventListener('click', value);
        else node.setAttribute(key, value === true ? '' : value);
      });
    }
    (children || []).forEach(function (child) {
      if (child == null || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  var reduceMotion = Boolean(
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  var toastHideTimer = null;
  var toastRemoveTimer = null;
  var toastActionHandler = null;

  function hideToast() {
    window.clearTimeout(toastHideTimer);
    window.clearTimeout(toastRemoveTimer);
    el.toast.classList.remove('show');
    el.toast.hidden = true;
    el.toastAction.hidden = true;
    toastActionHandler = null;
  }

  /**
   * 轻提示。传 action 时出现一个可点按钮（用于"删除撤销"），停留时间也更长。
   * @param {string} message
   * @param {{label:string, onClick:Function}} [action]
   */
  function showToast(message, action) {
    el.toastText.textContent = message;
    el.toast.hidden = false;
    window.requestAnimationFrame(function () { el.toast.classList.add('show'); });

    toastActionHandler = action ? action.onClick : null;
    el.toastAction.hidden = !action;
    el.toast.classList.toggle('with-action', Boolean(action));
    if (action) el.toastAction.textContent = action.label;

    window.clearTimeout(toastHideTimer);
    window.clearTimeout(toastRemoveTimer);
    toastHideTimer = window.setTimeout(function () {
      el.toast.classList.remove('show');
      // 这个定时器同样要能被下一条提示取消，否则新提示会被提前隐藏
      toastRemoveTimer = window.setTimeout(function () {
        el.toast.hidden = true;
        el.toastAction.hidden = true;
        toastActionHandler = null;
      }, 220);
    }, action ? 6000 : 2200);
  }

  function weekdayName(date) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
  }

  function dateLabel(dateStr) {
    var d = S.parseDate(dateStr);
    if (!d) return dateStr;
    var today = S.todayString();
    var y = new Date();
    y.setDate(y.getDate() - 1);
    var prefix = dateStr === today ? '今天' : (dateStr === S.toDateString(y) ? '昨天' : '');
    var md = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return (prefix ? prefix + ' · ' : '') + md + ' ' + weekdayName(d);
  }

  /* ------------------------------------------------------------------ *
   * 渲染
   * ------------------------------------------------------------------ */

  // 科目/筛选胶囊只构建一次，之后只改 aria-pressed：
  // 每次重建 DOM 会让键盘用户的焦点掉回 body，必须避免。
  var subjectChipNodes = [];
  var filterChipNodes = [];
  var filterChipIds = [];

  function buildSubjectChips() {
    el.subjectChips.textContent = '';
    subjectChipNodes = S.SUBJECTS.map(function (subject) {
      var chip = h('button', {
        type: 'button',
        'class': 'chip',
        'style': '--c:' + subject.color,
        onclick: function () {
          if (formSubject === subject.id) return;
          formSubject = subject.id;
          syncSubjectChips();
          buildExtraFields(formSubject, {});
          clearErrors();
        }
      }, [h('span', { 'class': 'dot' }), subject.name]);
      el.subjectChips.appendChild(chip);
      return chip;
    });
    syncSubjectChips();
  }

  function syncSubjectChips() {
    subjectChipNodes.forEach(function (node, index) {
      node.setAttribute('aria-pressed', String(formSubject === S.SUBJECTS[index].id));
    });
  }

  function buildFilterChips() {
    var all = [{ id: 'all', name: '全部', color: '#8b93a1' }].concat(S.SUBJECTS);
    el.filterSubjects.textContent = '';
    filterChipIds = all.map(function (subject) { return subject.id; });
    filterChipNodes = all.map(function (subject) {
      var chip = h('button', {
        type: 'button',
        'class': 'chip',
        'style': '--c:' + subject.color,
        onclick: function () {
          filters.subject = subject.id;
          render();
        }
      }, subject.id === 'all' ? [subject.name] : [h('span', { 'class': 'dot' }), subject.name]);
      el.filterSubjects.appendChild(chip);
      return chip;
    });
    syncFilterChips();
  }

  function syncFilterChips() {
    filterChipNodes.forEach(function (node, index) {
      node.setAttribute('aria-pressed', String(filters.subject === filterChipIds[index]));
    });
  }

  function renderFilterRange() {
    Array.prototype.forEach.call(el.filterRange.children, function (btn) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-range') === filters.range));
    });
  }

  function renderSummary(list) {
    var summary = S.summarize(list);
    el.summary.textContent = '';
    if (!summary.count) return;

    // 连续打卡只看科目，不受时间范围/搜索影响（否则搜一下就"断签"了）
    var streakRecords = S.filterRecords(state.records, { subject: filters.subject, range: 'all' });
    var streak = S.streakDays(streakRecords);

    el.summary.appendChild(h('div', { 'class': 'stat' }, [
      h('span', { 'class': 'stat-value', text: S.formatMinutes(summary.totalMinutes) }),
      h('span', { 'class': 'stat-label', text: '总时长' })
    ]));
    el.summary.appendChild(h('div', { 'class': 'stat' }, [
      h('span', { 'class': 'stat-value', text: String(summary.count) }),
      h('span', { 'class': 'stat-label', text: '条记录' })
    ]));
    el.summary.appendChild(h('div', { 'class': 'stat' }, [
      h('span', { 'class': 'stat-value', text: String(summary.dayCount) }),
      h('span', { 'class': 'stat-label', text: '学习天数' })
    ]));
    el.summary.appendChild(h('div', { 'class': 'stat' }, [
      h('span', { 'class': 'stat-value', text: streak > 0 ? streak + ' 天' : '—' }),
      h('span', { 'class': 'stat-label', text: '连续打卡' })
    ]));
    el.summary.appendChild(goalStatNode());

    var shown = summary.bySubject.filter(function (s) { return s.minutes > 0; });
    if (!shown.length) return;
    var max = shown.reduce(function (acc, s) { return Math.max(acc, s.minutes); }, 0);
    var bars = h('div', { 'class': 'bars' });
    shown.forEach(function (s) {
      bars.appendChild(h('div', { 'class': 'bar-row' }, [
        h('span', { text: s.name }),
        h('div', { 'class': 'bar-track' }, [
          h('div', {
            'class': 'bar-fill',
            'style': 'width:' + Math.round((s.minutes / max) * 100) + '%;--c:' + s.color
          })
        ]),
        h('span', { 'class': 'bar-value', text: S.formatMinutes(s.minutes) })
      ]));
    });
    el.summary.appendChild(bars);
  }

  function mdLabel(dateStr) {
    var d = S.parseDate(dateStr);
    if (!d) return dateStr;
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  /** 今日目标进度环（统计今日全部记录，不受筛选影响） */
  function goalStatNode() {
    var today = S.todayString();
    var minutes = state.records.reduce(function (sum, r) {
      return r && r.date === today && isFinite(r.minutes) ? sum + r.minutes : sum;
    }, 0);
    var goal = settings.dailyGoal;
    var ratio = Math.min(1, minutes / goal);
    var radius = 18;
    var circumference = 2 * Math.PI * radius;

    var svg = svgEl('svg', {
      'class': minutes >= goal ? 'goal-ring done' : 'goal-ring',
      width: 44, height: 44, viewBox: '0 0 44 44',
      role: 'img',
      'aria-label': '今日已学 ' + S.formatMinutes(minutes) + '，目标 ' + S.formatMinutes(goal)
    });
    svg.appendChild(svgEl('circle', { 'class': 'ring-bg', cx: 22, cy: 22, r: radius }));
    svg.appendChild(svgEl('circle', {
      'class': 'ring-fg',
      cx: 22, cy: 22, r: radius,
      'stroke-dasharray': circumference.toFixed(2),
      'stroke-dashoffset': (circumference * (1 - ratio)).toFixed(2)
    }));

    return h('div', { 'class': 'stat goal-stat' }, [
      svg,
      h('div', { 'class': 'goal-text' }, [
        h('b', { text: minutes >= goal ? '目标达成' : S.formatMinutes(minutes) }),
        h('span', { text: '今日 / 目标 ' + S.formatMinutes(goal) })
      ])
    ]);
  }

  /* ------------------------------------------------------------------ *
   * 图片附件（错题本）
   * ------------------------------------------------------------------ */

  function newImageId() {
    return 'img-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /** 读图 → 等比缩到 1400px 内 → 转 JPEG，控制体积（IndexedDB 也不是无限大） */
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !file.type || file.type.indexOf('image/') !== 0) {
        reject(new Error('只支持图片文件'));
        return;
      }
      if (file.size > 12 * 1024 * 1024) {
        reject(new Error('图片太大（超过 12MB），请先压缩'));
        return;
      }
      var objectUrl = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        try {
          var maxDim = 1400;
          var scale = Math.min(1, maxDim / Math.max(image.width, image.height));
          var width = Math.max(1, Math.round(image.width * scale));
          var height = Math.max(1, Math.round(image.height * scale));
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(image, 0, 0, width, height);
          URL.revokeObjectURL(objectUrl);
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('图片压缩失败'));
          }, 'image/jpeg', 0.82);
        } catch (e) {
          URL.revokeObjectURL(objectUrl);
          reject(e);
        }
      };
      image.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('图片读取失败'));
      };
      image.src = objectUrl;
    });
  }

  /** 取得（并缓存）图片的 objectURL；不存在时返回空串 */
  function previewUrl(id) {
    if (previewCache[id]) return Promise.resolve(previewCache[id]);
    if (!imageSupported) return Promise.resolve('');
    return StudyFiles.get(id).then(function (blob) {
      if (!blob) return '';
      var url = URL.createObjectURL(blob);
      previewCache[id] = url;
      return url;
    }).catch(function () {
      return '';
    });
  }

  function renderImageStrip() {
    el.imageStrip.textContent = '';
    if (!formImages.length) {
      el.imageStrip.appendChild(h('div', { 'class': 'thumb-empty', text: '还没有图片' }));
      return;
    }
    formImages.forEach(function (id) {
      var thumb = h('div', { 'class': 'thumb' });
      var img = h('img', { alt: '已选图片' });
      previewUrl(id).then(function (url) { if (url) img.src = url; });
      thumb.appendChild(img);
      thumb.appendChild(h('button', {
        type: 'button',
        'class': 'thumb-del',
        title: '移除这张图片',
        'aria-label': '移除图片',
        text: '×',
        onclick: function () {
          formImages = formImages.filter(function (item) { return item !== id; });
          renderImageStrip();
        }
      }));
      el.imageStrip.appendChild(thumb);
    });
  }

  function handleImageFiles(fileList) {
    if (!imageSupported) {
      showToast('当前浏览器不支持保存图片（IndexedDB 不可用）');
      return;
    }
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    var remaining = S.MAX_IMAGES - formImages.length;
    if (remaining <= 0) {
      showToast('最多 ' + S.MAX_IMAGES + ' 张，先移除一张再添加');
      return;
    }
    if (files.length > remaining) {
      showToast('最多 ' + S.MAX_IMAGES + ' 张，只添加了前 ' + remaining + ' 张');
    }

    files.slice(0, remaining).forEach(function (file) {
      compressImage(file).then(function (blob) {
        var id = newImageId();
        return StudyFiles.put(id, blob).then(function () {
          formImages.push(id);
          renderImageStrip();
        });
      }).catch(function (error) {
        showToast('添加图片失败：' + error.message);
      });
    });
  }

  function openImageViewer(id) {
    if (!imageSupported) return;
    StudyFiles.get(id).then(function (blob) {
      if (!blob) { showToast('这张图片已经丢失'); return; }
      if (viewerUrl) URL.revokeObjectURL(viewerUrl);
      viewerUrl = URL.createObjectURL(blob);
      el.imageViewer.src = viewerUrl;
      if (typeof el.imageDialog.showModal === 'function') el.imageDialog.showModal();
      else el.imageDialog.setAttribute('open', '');
    }).catch(function () {
      showToast('读取图片失败');
    });
  }

  function closeImageViewer() {
    if (typeof el.imageDialog.close === 'function') el.imageDialog.close();
    else el.imageDialog.removeAttribute('open');
    if (viewerUrl) {
      URL.revokeObjectURL(viewerUrl);
      viewerUrl = null;
    }
    el.imageViewer.removeAttribute('src');
  }

  /** 把记录里的图片渲染成缩略图（点开看大图） */
  function recordImagesNode(record) {
    if (!Array.isArray(record.images) || !record.images.length) return null;
    var wrap = h('div', { 'class': 'record-images' });
    record.images.forEach(function (id) {
      var img = h('img', { alt: '错题图片', loading: 'lazy' });
      img.addEventListener('click', function () { openImageViewer(id); });
      previewUrl(id).then(function (url) { if (url) img.src = url; });
      wrap.appendChild(img);
    });
    return wrap;
  }

  /** 删除/清空后延迟清理图片：给 6 秒撤销留窗口，撤销后图片还在 */
  function scheduleImageCleanup(ids) {
    if (!imageSupported || !ids || !ids.length) return;
    window.clearTimeout(imageCleanupTimer);
    imageCleanupTimer = window.setTimeout(function () {
      imageCleanupTimer = null;
      StudyFiles.removeMany(ids).catch(function () { /* 清理失败不影响主流程 */ });
    }, 6500);
  }

  function cancelImageCleanup() {
    window.clearTimeout(imageCleanupTimer);
    imageCleanupTimer = null;
  }

  function recordNode(record) {
    var subject = S.subjectById(record.subject) || { name: '未知', color: '#8b93a1' };
    var hasContent = record.content && record.content.length > 0;
    var isEditing = record.id === editingId;
    var today = S.todayString();

    var meta = [];
    S.extraSummary(record).forEach(function (text) {
      meta.push(h('span', { 'class': 'meta-chip', text: text }));
    });
    (Array.isArray(record.tags) ? record.tags : []).forEach(function (tag) {
      meta.push(h('button', {
        type: 'button',
        'class': 'tag-mini',
        text: '#' + tag,
        onclick: function () {
          filters.tag = filters.tag === tag ? '' : tag;
          render();
        }
      }));
    });
    if (record.reviewAt) {
      var due = record.reviewAt <= today;
      meta.push(h('span', {
        'class': 'review-badge',
        text: due ? '待复习' : '复习 ' + mdLabel(record.reviewAt)
      }));
    }

    var contentNode;
    if (hasContent) {
      contentNode = h('p', { 'class': 'content', text: record.content });
      // 手机屏幕窄，长内容先折 4 行，点一下展开（桌面端不动）
      if (record.content.length > 90 && window.matchMedia && window.matchMedia('(max-width: 520px)').matches) {
        contentNode.classList.add('clampable');
        contentNode.title = '点击展开 / 收起';
        contentNode.addEventListener('click', function () {
          contentNode.classList.toggle('expanded');
        });
      }
    } else {
      contentNode = h('p', { 'class': 'content empty', text: '（未填写学习内容）' });
    }

    var main = [
      h('div', { 'class': 'record-head' }, [
        h('span', { 'class': 'badge', text: subject.name }),
        h('span', { 'class': 'dur', text: S.formatMinutes(record.minutes) })
      ]),
      contentNode
    ];
    if (meta.length) main.push(h('div', { 'class': 'record-meta' }, meta));

    var images = recordImagesNode(record);
    if (images) main.push(images);

    return h('article', {
      'class': isEditing ? 'record editing' : 'record',
      'style': '--c:' + subject.color
    }, [
      h('div', { 'class': 'record-main' }, main),
      h('div', { 'class': 'record-actions' }, [
        h('button', { type: 'button', 'class': 'icon-btn', text: '编辑', onclick: function () { startEdit(record.id); } }),
        h('button', { type: 'button', 'class': 'icon-btn danger', text: '删除', onclick: function () { removeRecord(record.id); } })
      ])
    ]);
  }

  /** 标签统计（跨科目）：显示总时长，点一下即按标签筛选 */
  function renderTagStats() {
    var stats = S.tagStats(state.records).slice(0, 12);
    var active = filters.tag;
    var activeVisible = stats.some(function (s) { return s.tag === active; });

    el.tagStats.textContent = '';
    if (!stats.length && !active) {
      el.tagStats.hidden = true;
      return;
    }
    el.tagStats.hidden = false;
    el.tagStats.appendChild(h('span', { 'class': 'tag-stats-label', text: '标签' }));

    if (active && !activeVisible) {
      el.tagStats.appendChild(h('button', {
        type: 'button', 'class': 'tag-chip', 'aria-pressed': 'true', text: '#' + active + ' ✕',
        onclick: function () { filters.tag = ''; render(); }
      }));
    }
    stats.forEach(function (item) {
      el.tagStats.appendChild(h('button', {
        type: 'button',
        'class': 'tag-chip',
        'aria-pressed': String(filters.tag === item.tag),
        onclick: function () {
          filters.tag = filters.tag === item.tag ? '' : item.tag;
          render();
        }
      }, [
        h('span', { text: '#' + item.tag }),
        h('span', { 'class': 'tag-minutes', text: S.formatMinutes(item.minutes) })
      ]));
    });
  }

  /** 今日复习卡片（没有待复习内容时整卡隐藏） */
  function renderReview() {
    var today = S.todayString();
    var due = S.dueReviews(state.records, today);
    el.reviewList.textContent = '';

    if (!due.length) {
      el.reviewCard.hidden = true;
      el.reviewCount.textContent = '';
      return;
    }

    el.reviewCard.hidden = false;
    el.reviewCount.textContent = '待复习 ' + due.length + ' 条';

    due.slice(0, 10).forEach(function (record) {
      var subject = S.subjectById(record.subject) || { name: '未知', color: '#8b93a1' };
      var overdue = record.reviewAt < today;
      var preview = record.content || '（无内容）';
      if (preview.length > 80) preview = preview.slice(0, 80) + '…';

      el.reviewList.appendChild(h('div', { 'class': 'review-item', 'style': '--c:' + subject.color }, [
        h('div', { 'class': 'review-main' }, [
          h('div', { 'class': 'review-head' }, [
            h('span', { 'class': 'badge', text: subject.name }),
            h('span', { text: dateLabel(record.date) }),
            h('span', { 'class': 'review-due', text: overdue ? '已逾期（' + mdLabel(record.reviewAt) + '）' : '今天' })
          ]),
          h('p', { 'class': 'review-text', text: preview })
        ]),
        h('button', { type: 'button', 'class': 'icon-btn', text: '完成复习', onclick: function () { finishReview(record.id); } })
      ]));
    });

    if (due.length > 10) {
      el.reviewList.appendChild(h('p', { 'class': 'review-empty', text: '还有 ' + (due.length - 10) + ' 条没有显示，完成上面的会继续出现。' }));
    }
  }

  function finishReview(id) {
    var result = S.completeReview(state, id, S.todayString());
    if (!result.ok) { showToast(result.error); return; }
    var error = persist(result.state);
    if (error) { showToast(error); return; }
    render();
    showToast(result.done ? '已完成全部复习，这条退出复习计划' : '已复习，下次 ' + mdLabel(result.record.reviewAt) + ' 提醒');
  }


  function renderList(list) {
    el.records.textContent = '';

    if (!list.length) {
      var emptyText;
      if (filters.keyword) {
        emptyText = '没有匹配「' + filters.keyword + '」的记录，换个关键词试试。';
      } else if (state.records.length) {
        emptyText = '当前筛选条件下没有记录，换个科目或时间范围试试。';
      } else {
        emptyText = '还没有任何记录。在左侧填一条，今天的学习就算数了。';
      }
      var empty = h('div', { 'class': 'empty-state' }, [h('p', { text: emptyText })]);
      // 只有"从没用过"的新用户才给示例按钮；用过又清空后不再出现，避免误点后示例数据"复活"
      if (!state.records.length && !hasOnboarded()) {
        empty.appendChild(h('button', {
          type: 'button',
          'class': 'btn ghost',
          text: '载入示例数据看看效果',
          onclick: loadSample
        }));
      }
      el.records.appendChild(empty);
      return;
    }

    var groups = [];
    var lastDate = null;
    list.forEach(function (record) {
      if (record.date !== lastDate) {
        groups.push({ date: record.date, items: [] });
        lastDate = record.date;
      }
      groups[groups.length - 1].items.push(record);
    });

    // 先离屏拼好整棵树再一次性挂载，避免逐条触发布局
    var fragment = document.createDocumentFragment();
    groups.forEach(function (group) {
      var total = group.items.reduce(function (sum, r) { return sum + r.minutes; }, 0);
      var day = h('div', { 'class': 'day' }, [
        h('div', { 'class': 'day-head' }, [
          h('span', { text: dateLabel(group.date) }),
          h('span', { 'class': 'day-total', text: '共 ' + S.formatMinutes(total) })
        ])
      ]);
      group.items.forEach(function (record) { day.appendChild(recordNode(record)); });
      fragment.appendChild(day);
    });
    el.records.appendChild(fragment);
  }

  /* ---------- 考试倒计时 / 累计指标 / 知识点分布 ---------- */

  // 数字型 extra 的展示元信息（label / unit）
  var NUMERIC_META = (function () {
    var meta = {};
    Object.keys(S.EXTRA_FIELDS || {}).forEach(function (subjectId) {
      (S.EXTRA_FIELDS[subjectId] || []).forEach(function (field) {
        if (field.type === 'number') meta[field.key] = { label: field.label, unit: field.unit || '' };
      });
    });
    return meta;
  })();

  function renderExamPill() {
    if (!el.examPill) return;
    var examDate = settings.examDate;
    var days = examDate ? S.daysUntil(examDate) : null;
    if (days === null) {
      el.examPill.hidden = true;
      el.examPill.textContent = '';
      return;
    }
    el.examPill.hidden = false;
    el.examPill.classList.toggle('urgent', days >= 0 && days <= 30);
    el.examPill.classList.toggle('past', days < 0);
    if (days > 0) el.examPill.textContent = '距考试 ' + days + ' 天';
    else if (days === 0) el.examPill.textContent = '今天考试';
    else el.examPill.textContent = '考试已过 ' + (-days) + ' 天';
  }

  /** 累计指标：错题数 / 词汇量 / 考点数 / 做题数 */
  function renderTotals() {
    if (!el.totals) return;
    var totals = S.subjectTotals(state.records);
    var chips = [];

    Object.keys(NUMERIC_META).forEach(function (key) {
      var value = totals.extras[key];
      if (!value) return;
      var meta = NUMERIC_META[key];
      chips.push({
        label: String(meta.label).replace(/数$/, ''),
        value: value + (meta.unit || '')
      });
    });

    el.totals.textContent = '';
    if (!chips.length) {
      el.totals.hidden = true;
      return;
    }
    el.totals.hidden = false;
    el.totals.appendChild(h('span', { 'class': 'totals-label', text: '累计' }));
    chips.forEach(function (chip) {
      el.totals.appendChild(h('span', { 'class': 'total-chip' }, [
        h('span', { 'class': 'total-chip-label', text: chip.label }),
        h('b', { text: chip.value })
      ]));
    });
  }

  /** 知识点分布：按科目分组、按知识点汇总时长，点一行即按该知识点筛选 */
  function renderKnowledge() {
    if (!el.knowledgeCard) return;
    var stats = S.knowledgeStats(state.records);

    el.knowledgeList.textContent = '';
    if (!stats.groups.length) {
      el.knowledgeCard.hidden = true;
      el.knowledgeMeta.textContent = '';
      return;
    }
    el.knowledgeCard.hidden = false;

    var points = 0;
    stats.groups.forEach(function (group) { points += group.items.length; });
    el.knowledgeMeta.textContent = points + ' 个知识点 · 合计 ' + S.formatMinutes(stats.total);

    stats.groups.forEach(function (group) {
      var block = h('div', { 'class': 'knowledge-group' });
      block.appendChild(h('div', { 'class': 'knowledge-group-head' }, [
        h('span', { 'class': 'badge', 'style': '--c:' + group.color, text: group.name }),
        h('span', { 'class': 'knowledge-field', text: group.fieldLabel })
      ]));

      group.items.forEach(function (item) {
        var width = Math.max(4, Math.round((item.minutes / group.items[0].minutes) * 100));
        var extraText = Object.keys(item.extras).map(function (key) {
          var meta = NUMERIC_META[key];
          if (!meta) return '';
          return String(meta.label).replace(/数$/, '') + ' ' + item.extras[key] + (meta.unit || '');
        }).filter(Boolean).join(' · ');

        block.appendChild(h('button', {
          type: 'button',
          'class': 'knowledge-row',
          title: item.value + '：' + S.formatMinutes(item.minutes) + (extraText ? '（' + extraText + '）' : ''),
          onclick: function () { filterByKnowledge(item.value); }
        }, [
          h('span', { 'class': 'knowledge-name', text: item.value }),
          h('span', { 'class': 'knowledge-bar' }, [
            h('span', { 'class': 'knowledge-bar-fill', 'style': 'width:' + width + '%;--c:' + group.color })
          ]),
          h('span', { 'class': 'knowledge-value', text: S.formatMinutes(item.minutes) }),
          h('span', { 'class': 'knowledge-extra', text: extraText })
        ]));
      });

      el.knowledgeList.appendChild(block);
    });
  }

  function filterByKnowledge(value) {
    if (el.searchInput) el.searchInput.value = value;
    filters.keyword = value;
    render();
    var target = document.querySelector('.list-card');
    if (target) target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    showToast('已筛选知识点：' + value);
  }

  function render() {
    var list = S.filterRecords(state.records, {
      subject: filters.subject,
      range: filters.range,
      keyword: filters.keyword,
      tag: filters.tag
    });
    var summary = S.summarize(list);

    el.listCount.textContent = summary.count
      ? '共 ' + summary.count + ' 条 · 合计 ' + S.formatMinutes(summary.totalMinutes)
      : '';

    // 跨过午夜后"今天"会变，日期上限要跟着刷新
    el.date.max = S.todayString();

    syncFilterChips();
    renderFilterRange();
    renderSummary(list);
    renderTotals();
    renderKnowledge();
    renderTagStats();
    renderList(list);
    renderReview();
    renderTrend();
    renderExamPill();
  }

  /* ------------------------------------------------------------------ *
   * 趋势图（原生 SVG，不引图表库）
   * ------------------------------------------------------------------ */

  var trendDays = 7;
  var AXIS_STEPS = [30, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 960, 1200, 1440];

  /** 把纵轴上限取整到好读的刻度（30 分 / 1 小时 / 2 小时……） */
  function niceCeil(minutes) {
    for (var i = 0; i < AXIS_STEPS.length; i++) {
      if (minutes <= AXIS_STEPS[i]) return AXIS_STEPS[i];
    }
    return AXIS_STEPS[AXIS_STEPS.length - 1];
  }

  function axisLabel(minutes) {
    if (minutes === 0) return '0';
    if (minutes < 60) return minutes + '分';
    return Math.round((minutes / 60) * 10) / 10 + 'h';
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    return node;
  }

  function buildLegend() {
    el.chartLegend.textContent = '';
    S.SUBJECTS.forEach(function (subject) {
      el.chartLegend.appendChild(h('span', { 'class': 'legend-item', 'style': '--c:' + subject.color }, [
        h('span', { 'class': 'dot' }),
        subject.name
      ]));
    });
  }

  function syncChartRange() {
    Array.prototype.forEach.call(el.chartRange.children, function (btn) {
      btn.setAttribute('aria-pressed', String(Number(btn.getAttribute('data-days')) === trendDays));
    });
  }

  function renderCompare(records) {
    var node = el.chartCompare;
    if (!node) return;
    var cmp = S.comparePeriods(records, { days: trendDays });

    if (cmp.current === 0 && cmp.previous === 0) {
      node.hidden = true;
      node.textContent = '';
      return;
    }

    node.textContent = '';
    node.hidden = false;

    if (cmp.previous === 0) {
      node.appendChild(document.createTextNode('较前 ' + trendDays + ' 天：之前没有记录，暂时无法对比'));
      return;
    }

    var pct = Math.round(((cmp.current - cmp.previous) / cmp.previous) * 100);
    var trendClass = pct > 0 ? 'up' : (pct < 0 ? 'down' : '');
    var arrow = pct > 0 ? '↑' : (pct < 0 ? '↓' : '→');

    node.appendChild(document.createTextNode('较前 ' + trendDays + ' 天 '));
    node.appendChild(h('span', { 'class': trendClass, text: arrow + ' ' + Math.abs(pct) + '%' }));
    node.appendChild(document.createTextNode(
      '（' + S.formatMinutes(cmp.previous) + ' → ' + S.formatMinutes(cmp.current) + '）'
    ));
  }

  function renderTrend() {
    var host = el.trend;
    if (!host) return;
    host.textContent = '';

    var records = S.filterRecords(state.records, { subject: filters.subject, range: 'all' });
    var series = S.trendSeries(records, { days: trendDays });
    var totals = series.reduce(function (sum, item) { return sum + item.total; }, 0);
    var maxDay = series.reduce(function (max, item) { return Math.max(max, item.total); }, 0);

    var scope = filters.subject === 'all' ? '全部科目' : S.subjectById(filters.subject).name;
    el.chartMeta.textContent = totals
      ? scope + ' · 最近 ' + trendDays + ' 天 · 合计 ' + S.formatMinutes(totals) +
        ' · 日均 ' + S.formatMinutes(Math.round(totals / trendDays))
      : scope + ' · 最近 ' + trendDays + ' 天';

    renderCompare(records);

    if (maxDay === 0) {
      host.appendChild(h('p', {
        'class': 'chart-empty',
        text: '最近 ' + trendDays + ' 天还没有记录，先记一条吧。'
      }));
      return;
    }

    var width = Math.max(260, host.clientWidth || 620);
    // 手机屏幕矮，图表压到 156px，少占一屏
    var height = width < 560 ? 156 : 180;
    var padL = 36;
    var padR = 10;
    var padT = 12;
    var padB = 24;
    var plotW = width - padL - padR;
    var plotH = height - padT - padB;
    var top = niceCeil(maxDay);

    var svg = svgEl('svg', {
      width: width,
      height: height,
      viewBox: '0 0 ' + width + ' ' + height,
      'class': 'trend-svg',
      role: 'img',
      'aria-label': '最近 ' + trendDays + ' 天每日学习时长柱状图，合计 ' + S.formatMinutes(totals)
    });

    // 横向网格 + 纵轴刻度
    [0, top / 2, top].forEach(function (value) {
      var y = padT + plotH - (value / top) * plotH;
      svg.appendChild(svgEl('line', {
        x1: padL, x2: width - padR, y1: y, y2: y,
        'class': value === 0 ? 'axis-base' : 'grid-line'
      }));
      var label = svgEl('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', 'class': 'axis-text' });
      label.textContent = axisLabel(value);
      svg.appendChild(label);
    });

    var slot = plotW / series.length;
    var barW = Math.max(3, Math.min(slot * 0.62, 28));

    series.forEach(function (item, index) {
      var centerX = padL + slot * index + slot / 2;
      var x = centerX - barW / 2;
      var y = padT + plotH;

      // 堆叠柱：从下往上按科目顺序堆，颜色即科目色
      item.bySubject.forEach(function (subject) {
        if (!subject.minutes) return;
        var segH = (subject.minutes / top) * plotH;
        y -= segH;
        svg.appendChild(svgEl('rect', {
          x: x, y: y, width: barW, height: Math.max(segH, 1),
          rx: Math.min(3, barW / 3),
          fill: subject.color,
          'class': 'bar-seg'
        }));
      });

      // 透明命中区 + 原生 tooltip（无需额外 JS）
      var tip = svgEl('title', {});
      var detail = item.bySubject
        .filter(function (s) { return s.minutes > 0; })
        .map(function (s) { return s.name + ' ' + S.formatMinutes(s.minutes); })
        .join('，');
      tip.textContent = item.date + ' · 共 ' + S.formatMinutes(item.total) + (detail ? '\n' + detail : '');
      var hit = svgEl('rect', {
        x: padL + slot * index, y: padT, width: slot, height: plotH,
        fill: 'transparent', 'class': 'bar-hit'
      });
      hit.appendChild(tip);
      svg.appendChild(hit);

      // 横轴日期：7 天全标，30 天每 5 天标一次（并保证最后一天有标）
      var showLabel = series.length <= 7 || index % 5 === 0 || index === series.length - 1;
      if (showLabel) {
        var date = S.parseDate(item.date);
        var dateLabel = svgEl('text', { x: centerX, y: height - 8, 'text-anchor': 'middle', 'class': 'axis-text' });
        dateLabel.textContent = date ? (date.getMonth() + 1) + '/' + date.getDate() : item.date;
        svg.appendChild(dateLabel);
      }
    });

    host.appendChild(svg);
  }

  /* ------------------------------------------------------------------ *
   * 表单
   * ------------------------------------------------------------------ */

  // 表单快照：用于判断"正在编辑但没保存"的情况，避免切记录时静默丢输入
  var formSnapshot = '';

  function formSignature() {
    return [
      formSubject,
      el.date.value,
      el.minutes.value,
      el.content.value,
      el.tagsInput.value,
      el.reviewInput.checked ? '1' : '0',
      JSON.stringify(collectExtra()),
      formImages.join(',')
    ].join('\u0000');
  }

  function takeFormSnapshot() {
    formSnapshot = formSignature();
  }

  function isFormDirty() {
    return formSignature() !== formSnapshot;
  }

  function setInvalid(control, invalid) {
    if (!control) return;
    control.classList.toggle('invalid', invalid);
    control.setAttribute('aria-invalid', invalid ? 'true' : 'false');
  }

  /* ---------- 差异化字段（按江西专升本知识点配置） ---------- */

  /** 按当前科目渲染差异化控件（下拉 / 数字 / 文本），values 用于编辑时回填 */
  function buildExtraFields(subject, values) {
    var source = values || {};
    el.extraFields.textContent = '';

    S.extraFieldsOf(subject).forEach(function (field) {
      var inputId = 'extra-' + field.key;
      var control;

      if (field.type === 'select') {
        control = h('select', {
          id: inputId,
          'data-extra-key': field.key,
          'aria-describedby': 'err-extra-' + field.key
        });
        control.appendChild(h('option', { value: '', text: '请选择' }));
        (field.options || []).forEach(function (option) {
          var node = h('option', { value: option, text: option });
          if (source[field.key] === option) node.selected = true;
          control.appendChild(node);
        });
      } else {
        var attrs = {
          id: inputId,
          type: field.type === 'number' ? 'number' : 'text',
          placeholder: field.placeholder || '',
          'data-extra-key': field.key,
          'aria-describedby': 'err-extra-' + field.key
        };
        if (field.type === 'number') {
          attrs.min = '0';
          attrs.max = '9999';
          attrs.step = '1';
          attrs.inputmode = 'numeric';
        } else {
          attrs.maxlength = '60';
        }
        control = h('input', attrs);
        control.value = source[field.key] == null ? '' : String(source[field.key]);
      }

      el.extraFields.appendChild(h('div', { 'class': 'field' }, [
        h('label', { 'class': 'label', 'for': inputId, text: field.label }),
        control,
        h('p', { 'class': 'err', id: 'err-extra-' + field.key, 'aria-live': 'polite', hidden: true })
      ]));
    });
  }

  /** 收集表单里的差异化字段（原样字符串，交给数据层校验） */
  function collectExtra() {
    var out = {};
    var controls = el.extraFields.querySelectorAll('[data-extra-key]');
    Array.prototype.forEach.call(controls, function (control) {
      out[control.getAttribute('data-extra-key')] = control.value;
    });
    return out;
  }

  function clearExtraErrors() {
    var nodes = el.extraFields.querySelectorAll('.err');
    Array.prototype.forEach.call(nodes, function (node) {
      node.hidden = true;
      node.textContent = '';
    });
    var controls = el.extraFields.querySelectorAll('[data-extra-key]');
    Array.prototype.forEach.call(controls, function (control) { setInvalid(control, false); });
  }

  function clearErrors() {
    Object.keys(errors).forEach(function (key) {
      errors[key].hidden = true;
      errors[key].textContent = '';
    });
    clearExtraErrors();
    setInvalid(el.date, false);
    setInvalid(el.minutes, false);
    setInvalid(el.content, false);
    setInvalid(el.tagsInput, false);
  }

  function showErrors(errorMap) {
    var firstField = null;

    Object.keys(errorMap).forEach(function (key) {
      if (key.indexOf('extra:') === 0) {
        var extraKey = key.slice('extra:'.length);
        var node = document.getElementById('err-extra-' + extraKey);
        var control = el.extraFields.querySelector('[data-extra-key="' + extraKey + '"]');
        if (node) {
          node.textContent = errorMap[key];
          node.hidden = false;
        }
        if (control) setInvalid(control, true);
        if (!firstField) firstField = key;
        return;
      }
      var target = errors[key];
      if (!target) return;
      target.textContent = errorMap[key];
      target.hidden = false;
      if (!firstField) firstField = key;
    });

    setInvalid(el.date, Boolean(errorMap.date));
    setInvalid(el.minutes, Boolean(errorMap.minutes));
    setInvalid(el.content, Boolean(errorMap.content));
    setInvalid(el.tagsInput, Boolean(errorMap.tags));

    if (firstField === 'date') el.date.focus();
    else if (firstField === 'minutes') el.minutes.focus();
    else if (firstField === 'content') el.content.focus();
    else if (firstField && firstField.indexOf('extra:') === 0) {
      var focusControl = el.extraFields.querySelector('[data-extra-key="' + firstField.slice('extra:'.length) + '"]');
      if (focusControl) focusControl.focus();
    }
  }

  /** 移动端：折叠/展开录入表单（桌面上按钮隐藏，函数调用无副作用） */
  function setFormCollapsed(collapsed) {
    if (!el.formCard || !el.formToggle) return;
    el.formCard.classList.toggle('collapsed', collapsed);
    el.formToggle.setAttribute('aria-expanded', String(!collapsed));
    el.formToggle.textContent = collapsed ? '展开' : '收起';
  }

  function isFormCollapsed() {
    return Boolean(el.formCard && el.formCard.classList.contains('collapsed'));
  }

  function resetForm() {
    editingId = null;
    subjectBeforeEdit = null;
    el.formTitle.textContent = '新增记录';
    el.submit.textContent = '保存记录';
    el.cancel.hidden = true;
    el.content.value = '';
    el.minutes.value = '';
    el.date.value = S.todayString();
    el.tagsInput.value = '';
    el.reviewInput.checked = false;
    formImages = [];
    renderImageStrip();
    buildExtraFields(formSubject, {});
    clearErrors();
    takeFormSnapshot();
  }

  function cancelEdit() {
    if (subjectBeforeEdit) formSubject = subjectBeforeEdit;
    syncSubjectChips();

    // 编辑中途取消：把本次新加、但没有任何记录引用的图片清掉，避免孤儿占空间
    if (imageSupported && formImages.length) {
      var referenced = Object.create(null);
      state.records.forEach(function (record) {
        (Array.isArray(record.images) ? record.images : []).forEach(function (id) { referenced[id] = true; });
      });
      var orphans = formImages.filter(function (id) { return !referenced[id]; });
      if (orphans.length) StudyFiles.removeMany(orphans).catch(function () { /* 忽略 */ });
    }

    resetForm();
    render(); // 清掉列表里的"编辑中"高亮
    showToast('已取消编辑');
  }

  function startEdit(id) {
    if (isFormCollapsed()) setFormCollapsed(false);
    var record = state.records.filter(function (r) { return r.id === id; })[0];
    if (!record) { showToast('这条记录已不存在'); render(); return; }

    // 正在编辑另一条且已改动：明确询问，别静默丢弃
    if (editingId && editingId !== id && isFormDirty()) {
      if (!window.confirm('当前正在编辑的内容还没有保存，确定要放弃并编辑另一条吗？')) return;
    }

    if (!editingId) subjectBeforeEdit = formSubject;
    editingId = id;
    formSubject = record.subject;
    syncSubjectChips();
    buildExtraFields(formSubject, record.extra || {});
    clearErrors();
    el.date.value = record.date;
    el.minutes.value = String(record.minutes);
    el.content.value = record.content || '';
    el.tagsInput.value = Array.isArray(record.tags) ? record.tags.join('，') : '';
    el.reviewInput.checked = Boolean(record.reviewAt);
    formImages = Array.isArray(record.images) ? record.images.slice() : [];
    renderImageStrip();
    el.formTitle.textContent = '编辑记录';
    el.submit.textContent = '保存修改';
    el.cancel.hidden = false;
    takeFormSnapshot();
    render(); // 列表里把正在编辑的这条高亮出来

    el.form.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    el.content.focus();
    el.content.setSelectionRange(el.content.value.length, el.content.value.length);
  }

  /**
   * 写入存储成功后才更新内存中的 state。
   * 失败返回错误文案且不改 state —— 绝不能出现"提示已保存但实际没写进去"。
   * @returns {string} 空字符串表示成功
   */
  function persist(nextState) {
    var result = S.saveState(store, nextState);
    if (!result.ok) return result.error || '保存失败：本地存储不可用';
    state = nextState;
    return '';
  }

  function onSubmit(event) {
    event.preventDefault();
    clearErrors();

    // 写入前先与存储对齐：避免另一个标签页/后台恢复的旧内存状态把已删除的记录写回去
    reloadStateFromStorage();
    if (editingId && !state.records.some(function (r) { return r.id === editingId; })) {
      resetForm();
      render();
      showErrors({ form: '这条记录已在其它窗口被删除，请重新填写。' });
      return;
    }

    var input = {
      subject: formSubject,
      date: el.date.value,
      minutes: el.minutes.value,
      content: el.content.value,
      extra: collectExtra(),
      tags: el.tagsInput.value,
      images: formImages.slice(),
      review: el.reviewInput.checked
    };
    var wasEdit = Boolean(editingId);
    var oldRecord = wasEdit ? state.records.filter(function (r) { return r.id === editingId; })[0] : null;
    var result = wasEdit ? S.updateRecord(state, editingId, input) : S.addRecord(state, input);

    if (!result.ok) {
      showErrors(result.errors);
      return;
    }

    var saveError = persist(result.state);
    if (saveError) {
      showErrors({ form: saveError + '。当前输入已保留，请先导出备份或清理浏览器空间后重试。' });
      return;
    }

    markOnboarded();

    // 编辑时被移除的旧图片：数据已保存，可以立刻清理
    if (imageSupported && oldRecord && Array.isArray(oldRecord.images)) {
      var kept = formImages;
      var removed = oldRecord.images.filter(function (imgId) { return kept.indexOf(imgId) === -1; });
      if (removed.length) StudyFiles.removeMany(removed).catch(function () { /* 忽略 */ });
    }

    // 先回到新增态再渲染，否则列表上会残留"编辑中"高亮
    resetForm();
    render();
    showToast(wasEdit ? '修改已保存' : '记录已保存');
  }

  function removeRecord(id) {
    // 与存储对齐后再删，避免旧状态把别处已删的记录带回来
    reloadStateFromStorage();
    var record = state.records.filter(function (r) { return r.id === id; })[0];
    if (!record) { showToast('这条记录已经在别处被删除'); render(); return; }
    var subject = S.subjectById(record.subject);
    var name = subject ? subject.name : '';
    if (!window.confirm('确定删除这条记录吗？\n\n' + dateLabel(record.date) + ' · ' + name + ' · ' + S.formatMinutes(record.minutes) + (record.content ? '\n' + record.content : '') + '\n\n删除后不可恢复。')) {
      return;
    }
    var result = S.deleteRecord(state, id);
    if (!result.removed) { showToast('记录不存在'); render(); return; }

    var saveError = persist(result.state);
    if (saveError) { showToast(saveError + '，记录未删除'); return; }

    // 二次确认：存储里必须真的没有这条了，防止"界面删了、数据还在"
    var stillStored = S.loadState(store).records.some(function (r) { return r.id === id; });
    if (stillStored) {
      reloadStateFromStorage();
      render();
      showToast('删除未写入本地存储，请检查浏览器存储空间或隐私模式');
      return;
    }

    if (editingId === id) {
      // 删的正是编辑中的那条：走取消编辑，顺带把科目还原成编辑前的选择
      if (subjectBeforeEdit) formSubject = subjectBeforeEdit;
      syncSubjectChips();
      resetForm();
    }
    render();

    // 图片延迟 6.5 秒清理：撤销窗口内恢复记录时图片还在
    scheduleImageCleanup(record.images);

    // 误删是真实痛点：给 6 秒撤销窗口，按原 id / 原时间戳放回去
    var removedRecord = record;
    showToast('已删除 1 条记录', {
      label: '撤销',
      onClick: function () {
        cancelImageCleanup();
        reloadStateFromStorage();
        var restored = S.restoreRecord(state, removedRecord);
        if (!restored.ok) { showToast(restored.error); return; }
        var error = persist(restored.state);
        if (error) { showToast(error); return; }
        render();
        showToast('已恢复这条记录');
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 备份 / 导入 / 清空 / 示例
   * ------------------------------------------------------------------ */

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'application/json') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }

  /** 收集所有被记录引用的图片，转成 dataUrl 映射（导出时内嵌进 JSON） */
  function collectAttachments() {
    if (!imageSupported) return Promise.resolve({});
    var ids = [];
    state.records.forEach(function (record) {
      (Array.isArray(record.images) ? record.images : []).forEach(function (id) {
        if (ids.indexOf(id) === -1) ids.push(id);
      });
    });
    if (!ids.length) return Promise.resolve({});

    var map = {};
    return Promise.all(ids.map(function (id) {
      return StudyFiles.get(id).then(function (blob) {
        if (!blob) return null;
        return new Promise(function (resolve) {
          var reader = new FileReader();
          reader.onload = function () { map[id] = String(reader.result); resolve(); };
          reader.onerror = function () { resolve(); };
          reader.readAsDataURL(blob);
        });
      }).catch(function () { return null; });
    })).then(function () { return map; });
  }

  /** 导入备份时把内嵌图片写回 IndexedDB */
  function restoreAttachments(attachments) {
    if (!imageSupported || !attachments || !attachments.length) return Promise.resolve(0);
    var written = 0;
    return Promise.all(attachments.map(function (item) {
      return fetch(item.dataUrl).then(function (response) {
        return response.blob();
      }).then(function (blob) {
        return StudyFiles.put(item.id, blob).then(function () { written += 1; });
      }).catch(function () { return null; });
    })).then(function () { return written; });
  }

  function exportBackup() {
    if (!state.records.length) {
      showToast('还没有记录可以导出');
      return;
    }
    el.exportBtn.disabled = true;
    collectAttachments().then(function (attachments) {
      el.exportBtn.disabled = false;
      var filename = '学习记录-' + S.todayString() + '.json';
      download(filename, S.exportJSON(state, attachments));
      var imageCount = Object.keys(attachments).length;
      showToast('已导出 ' + state.records.length + ' 条记录' +
        (imageCount ? '（含 ' + imageCount + ' 张图片）' : ''));
    }).catch(function () {
      el.exportBtn.disabled = false;
      showToast('导出失败，请重试');
    });
  }

  /** 导出 CSV：给 Excel / 复盘表格用，带 BOM 保证中文不乱码 */
  function exportCSV() {
    if (!state.records.length) {
      showToast('还没有记录可以导出');
      return;
    }
    var sorted = S.filterRecords(state.records, { range: 'all' });
    download('学习记录-' + S.todayString() + '.csv', S.toCSV(sorted), 'text/csv');
    showToast('已导出 CSV（' + sorted.length + ' 条，可直接用 Excel 打开）');
  }

  function importBackup(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { showToast('文件读取失败，请重试'); };
    reader.onload = function () {
      var parsed = S.importJSON(String(reader.result || ''));
      if (!parsed.ok) {
        showToast('导入失败：' + parsed.error);
        return;
      }
      var message = '将用文件中的 ' + parsed.count + ' 条记录替换当前 ' + state.records.length + ' 条记录，确定继续吗？';
      if (!window.confirm(message)) return;

      var saveError = persist(parsed.state);
      if (saveError) { showToast(saveError); return; }
      markOnboarded();

      // 导入的数据可能不在当前筛选范围内，重置筛选以免误以为导入失败
      resetFilters();
      resetForm();
      render();

      var imageCount = Array.isArray(parsed.attachments) ? parsed.attachments.length : 0;
      restoreAttachments(parsed.attachments).then(function (written) {
        render();
        showToast('已导入 ' + parsed.count + ' 条记录' +
          (written ? '（含 ' + written + ' 张图片）' : (imageCount ? '（部分图片恢复失败）' : '')));
      });
    };
    reader.readAsText(file, 'utf-8');
  }

  function clearAll() {
    reloadStateFromStorage();
    if (!state.records.length) { showToast('当前没有数据'); return; }
    if (!window.confirm('确定清空全部 ' + state.records.length + ' 条记录吗？\n建议先「导出备份」，此操作不可恢复。')) return;

    var previous = state;
    var count = state.records.length;
    var allImages = [];
    state.records.forEach(function (record) {
      (Array.isArray(record.images) ? record.images : []).forEach(function (id) { allImages.push(id); });
    });

    var saveError = persist(S.emptyState());
    if (saveError) {
      state = previous;
      showToast(saveError + '，数据未清空');
      return;
    }

    // 二次确认：存储里确实清空了
    if (S.loadState(store).records.length) {
      reloadStateFromStorage();
      render();
      showToast('清空未写入本地存储，请检查浏览器存储空间或隐私模式');
      return;
    }

    markOnboarded();
    resetForm();
    render();
    scheduleImageCleanup(allImages);
    showToast('已清空 ' + count + ' 条记录', {
      label: '撤销',
      onClick: function () {
        reloadStateFromStorage();
        if (state.records.length) { showToast('已经有新记录，无法撤销清空'); return; }
        cancelImageCleanup();
        var error = persist(previous);
        if (error) { showToast(error); return; }
        render();
        showToast('已恢复 ' + count + ' 条记录');
      }
    });
  }

  function loadSample() {
    reloadStateFromStorage();
    if (state.records.length) {
      render();
      showToast('已经有记录了，示例数据没有载入');
      return;
    }
    var samples = [
      {
        subject: 'math', daysAgo: 0, minutes: 90,
        content: '一元函数微分学：复合函数求导 12 题，错题 2 道',
        extra: { chapter: '一元函数微分学', mistakes: 2 },
        tags: '错题, 求导'
      },
      {
        subject: 'english', daysAgo: 0, minutes: 40,
        content: '词汇与语法：背单词 40 个，语法专项 20 题',
        extra: { module: '词汇与语法', vocab: 40 },
        tags: '单词'
      },
      {
        subject: 'politics', daysAgo: 1, minutes: 35,
        content: '习近平新时代中国特色社会主义思想概论：背 5 个考点',
        extra: { module: '习近平新时代中国特色社会主义思想概论', points: 5 },
        tags: '背诵'
      },
      {
        subject: 'cs', daysAgo: 1, minutes: 60,
        content: 'Excel 电子表格：函数与图表，操作题 10 道',
        extra: { module: 'Excel 电子表格', problems: 10 },
        tags: '操作题'
      },
      {
        subject: 'math', daysAgo: 2, minutes: 45,
        content: '函数、极限与连续：等价无穷小替换 8 题',
        extra: { chapter: '函数、极限与连续', mistakes: 3 },
        tags: '错题'
      }
    ];
    var next = state;
    samples.forEach(function (sample) {
      var d = new Date();
      d.setDate(d.getDate() - sample.daysAgo);
      var result = S.addRecord(next, {
        subject: sample.subject,
        date: S.toDateString(d),
        minutes: sample.minutes,
        content: sample.content,
        extra: sample.extra,
        tags: sample.tags
      });
      if (result.ok) next = result.state;
    });
    var saveError = persist(next);
    if (saveError) { showToast(saveError); return; }
    markOnboarded();
    render();
    showToast('已载入 ' + samples.length + ' 条示例记录');
  }

  /** 套用当前科目的记录模板（有内容时追加，没内容时直接填入） */
  function applyTemplate() {
    var template = S.TEMPLATES[formSubject];
    var subject = S.subjectById(formSubject);
    if (!template) return;
    var current = el.content.value.trim();
    el.content.value = current ? current + '\n' + template : template;
    el.content.focus();
    var end = el.content.value.length;
    el.content.setSelectionRange(end, end);
    showToast('已套用「' + (subject ? subject.name : '') + '」模板，填掉 __ 即可');
  }

  /* ---------- 周报弹窗 ---------- */

  function openReport() {
    el.reportText.textContent = S.weeklyReport(state.records, { days: 7, examDate: settings.examDate });
    el.reportHint.textContent = '可直接粘贴到日记 / 复盘文档里';
    if (typeof el.reportDialog.showModal === 'function') el.reportDialog.showModal();
    else el.reportDialog.setAttribute('open', '');
  }

  function closeReport() {
    if (typeof el.reportDialog.close === 'function') el.reportDialog.close();
    else el.reportDialog.removeAttribute('open');
  }

  function copyReport() {
    var text = el.reportText.textContent;

    function done() {
      el.reportHint.textContent = '已复制到剪贴板';
      showToast('周报已复制');
    }

    function fallback() {
      var range = document.createRange();
      range.selectNodeContents(el.reportText);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      selection.removeAllRanges();
      if (ok) done();
      else el.reportHint.textContent = '自动复制失败，请手动选中文字复制';
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  /* ---------- 每日目标 / 考试日期 ---------- */

  function saveGoal() {
    var value = Number(el.goalInput.value);
    // 注意：两个设置要一起存，否则保存其中一个会把另一个重置掉
    var result = S.saveSettings(store, { dailyGoal: value, examDate: settings.examDate });
    if (!result.ok) { showToast(result.error); return; }
    settings = result.settings;
    el.goalInput.value = String(settings.dailyGoal);
    render();
    showToast('每日目标已设为 ' + S.formatMinutes(settings.dailyGoal));
  }

  function saveExamDate() {
    var value = el.examInput.value;
    var result = S.saveSettings(store, { dailyGoal: settings.dailyGoal, examDate: value });
    if (!result.ok) { showToast(result.error); return; }
    settings = result.settings;
    el.examInput.value = settings.examDate;
    renderExamPill();
    var days = settings.examDate ? S.daysUntil(settings.examDate) : null;
    if (days === null) showToast('已清除考试日期');
    else if (days >= 0) showToast('距考试还有 ' + days + ' 天');
    else showToast('考试日期已过');
  }

  /* ------------------------------------------------------------------ *
   * 事件绑定
   * ------------------------------------------------------------------ */

  el.form.addEventListener('submit', onSubmit);
  el.cancel.addEventListener('click', cancelEdit);
  el.formToggle.addEventListener('click', function () {
    setFormCollapsed(!isFormCollapsed());
  });
  el.templateBtn.addEventListener('click', applyTemplate);
  el.goalInput.addEventListener('change', saveGoal);
  el.examInput.addEventListener('change', saveExamDate);
  el.reportBtn.addEventListener('click', openReport);
  el.reportClose.addEventListener('click', closeReport);
  el.reportCopy.addEventListener('click', copyReport);
  el.reportDialog.addEventListener('click', function (event) {
    if (event.target === el.reportDialog) closeReport();
  });
  el.imageBtn.addEventListener('click', function () { el.imageInput.click(); });
  el.imageInput.addEventListener('change', function () {
    handleImageFiles(el.imageInput.files);
    el.imageInput.value = '';
  });
  el.imageClose.addEventListener('click', closeImageViewer);
  el.imageDialog.addEventListener('click', function (event) {
    if (event.target === el.imageDialog) closeImageViewer();
  });
  // 对话框按 Esc 关闭时浏览器不会走 closeImageViewer，这里兜底释放 objectURL
  el.imageDialog.addEventListener('close', function () {
    if (viewerUrl) {
      URL.revokeObjectURL(viewerUrl);
      viewerUrl = null;
    }
    el.imageViewer.removeAttribute('src');
  });
  el.exportBtn.addEventListener('click', exportBackup);
  el.importBtn.addEventListener('click', function () { el.importInput.click(); });
  el.importInput.addEventListener('change', function () {
    var file = el.importInput.files && el.importInput.files[0];
    el.importInput.value = '';
    importBackup(file);
  });
  el.clearBtn.addEventListener('click', clearAll);
  el.chartRange.addEventListener('click', function (event) {
    var btn = event.target.closest('button[data-days]');
    if (!btn) return;
    trendDays = Number(btn.getAttribute('data-days')) === 30 ? 30 : 7;
    syncChartRange();
    renderTrend();
  });

  // 窗口宽度变化后 SVG 需要按新宽度重画（柱宽/字号才不会挤在一起）
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(renderTrend, 150);
  });
  el.filterRange.addEventListener('click', function (event) {
    var btn = event.target.closest('button[data-range]');
    if (!btn) return;
    filters.range = btn.getAttribute('data-range');
    render();
  });

  // 搜索：输入停下 150ms 再重渲染，避免每敲一个字就重建整棵树
  var searchTimer = null;
  el.searchInput.addEventListener('input', function () {
    var value = el.searchInput.value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(function () {
      filters.keyword = value.trim();
      render();
    }, 150);
  });

  // 常用时长快捷按钮
  el.quickMinutes.addEventListener('click', function (event) {
    var btn = event.target.closest('button[data-minutes]');
    if (!btn) return;
    el.minutes.value = btn.getAttribute('data-minutes');
    clearErrors();
    el.minutes.focus();
  });

  el.csvBtn.addEventListener('click', exportCSV);

  // toast 上的"撤销"按钮
  el.toastAction.addEventListener('click', function () {
    var handler = toastActionHandler;
    hideToast();
    if (handler) handler();
  });

  // Ctrl / Cmd + Enter 保存（写长内容时不用去够按钮）
  el.form.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
      else el.submit.click();
    }
  });

  // 多标签页同步：另一个窗口改了数据就重新读一遍，避免互相覆盖
  window.addEventListener('storage', function (event) {
    if (event.key && event.key !== S.STORAGE_KEY) return;
    var reloaded = S.loadState(store);
    state = { version: reloaded.version, records: reloaded.records };
    if (editingId && !state.records.some(function (r) { return r.id === editingId; })) {
      resetForm();
      showToast('正在编辑的记录已在其它窗口被删除');
    }
    showLoadWarning(reloaded);
    render();
  });

  // 手机切回页面 / 从后台恢复时重新读存储：防止冻结的旧页面状态把删掉的记录写回去
  function syncWhenVisible() {
    if (document.hidden) return;
    var reloaded = reloadStateFromStorage();
    if (editingId && !state.records.some(function (r) { return r.id === editingId; })) {
      resetForm();
      showToast('正在编辑的记录已在别处被删除');
    }
    showLoadWarning(reloaded);
    render();
  }

  document.addEventListener('visibilitychange', syncWhenVisible);

  // 从浏览器后退缓存（bfcache）恢复时也要同步一次
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) syncWhenVisible();
  });

  // Esc 取消编辑（比去找"取消编辑"按钮顺手）
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && editingId) {
      event.preventDefault();
      cancelEdit();
    }
  });

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */

  el.content.maxLength = S.MAX_CONTENT; // 上限只在 store.js 定义一次
  el.date.value = S.todayString();
  el.date.max = S.todayString();
  buildSubjectChips();
  buildFilterChips();
  buildExtraFields(formSubject, {});
  buildLegend();
  syncChartRange();
  el.goalInput.value = String(settings.dailyGoal);
  el.examInput.value = settings.examDate;

  if (!imageSupported) {
    el.imageBtn.disabled = true;
    el.imageBtn.textContent = '当前浏览器不支持图片';
    el.imageBtn.title = '需要 IndexedDB 支持（Chrome / Edge / Firefox / Safari 新版本均可）';
  }
  renderImageStrip();

  takeFormSnapshot();
  // 已经有数据的老用户视为"已 onboard"，清空后不再出现示例数据按钮
  if (state.records.length) markOnboarded();
  showLoadWarning(state);
  render();

  // PWA manifest：只在 http/https 下挂载（file:// 会因 CORS 被拒，避免控制台报错）
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    var manifestLink = document.createElement('link');
    manifestLink.rel = 'manifest';
    manifestLink.href = 'manifest.json';
    document.head.appendChild(manifestLink);
  }

  // 离线缓存：只在 https / localhost 下注册（局域网 http 不是安全上下文，会静默跳过）
  if ('serviceWorker' in navigator) {
    var swSecure = location.protocol === 'https:' ||
      location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (swSecure) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* 离线失败不影响使用 */ });
      });
    }
  }
})();
