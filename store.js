/**
 * store.js —— 学习记录的数据层（核心阶段）
 *
 * 设计原则：
 * 1. 纯函数 + 单一数据源（state），不碰 DOM、不碰 window，方便单独测试和日后迁移到后端。
 * 2. 同时支持浏览器（window.StudyStore）与 Node（module.exports），便于跑自动化测试。
 * 3. 存储介质由调用方传入（localStorage 或内存对象），核心逻辑不关心存储细节。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.StudyStore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 四大科目：核心阶段只维护 id / 名称 / 颜色。加科目改这里即可（页面标题栏文案在 index.html 里同步） */
  var SUBJECTS = [
    { id: 'math', name: '高数', color: '#4c6ef5' },
    { id: 'english', name: '英语', color: '#12b886' },
    { id: 'politics', name: '政治', color: '#f08c00' },
    { id: 'cs', name: '信息技术', color: '#7048e8' }
  ];

  /**
   * 四科的差异化字段：只定义字段名与类型，不写死在表单里。
   * 加字段 = 在这里加一项；表单会自动多出一个输入框/下拉，列表/CSV/周报也会自动带上。
   *
   * 知识点按「江西专升本」考纲组织：
   *  - 政治 / 英语 / 信息技术 → 公共基础课（三门合卷）
   *  - 高数 → 理工类专业基础及技能知识课
   * 如果今年考纲变了，改这里的 options 即可，不用动任何界面代码。
   */
  var EXTRA_FIELDS = {
    math: [
      {
        key: 'chapter',
        label: '章节',
        type: 'select',
        options: [
          '函数、极限与连续',
          '一元函数微分学',
          '一元函数积分学',
          '常微分方程',
          '向量代数与空间解析几何',
          '多元函数微分学',
          '二重积分',
          '无穷级数'
        ]
      },
      { key: 'mistakes', label: '错题数', type: 'number', unit: '道', placeholder: '2' }
    ],
    english: [
      {
        key: 'module',
        label: '题型',
        type: 'select',
        options: ['词汇与语法', '阅读理解', '完形填空', '翻译（英汉互译）', '写作']
      },
      { key: 'vocab', label: '词汇量', type: 'number', unit: '个', placeholder: '40' }
    ],
    politics: [
      {
        key: 'module',
        label: '模块',
        type: 'select',
        options: [
          '思想道德与法治',
          '毛泽东思想和中国特色社会主义理论体系概论',
          '习近平新时代中国特色社会主义思想概论',
          '时事政治'
        ]
      },
      { key: 'points', label: '考点数', type: 'number', unit: '个', placeholder: '5' }
    ],
    cs: [
      {
        key: 'module',
        label: '模块',
        type: 'select',
        options: [
          '计算机基础知识',
          '操作系统（Windows）',
          'Word 文字处理',
          'Excel 电子表格',
          'PowerPoint 演示文稿',
          '计算机网络与 Internet',
          '多媒体技术',
          '信息安全',
          '数据库基础',
          '程序设计基础'
        ]
      },
      { key: 'problems', label: '做题数', type: 'number', unit: '道', placeholder: '3' }
    ]
  };

  /** 记录模板：选中科目后一键带出内容骨架（按江西专升本题型写） */
  var TEMPLATES = {
    math: '【高数】章节：__；完成 __ 题，错题 __ 道；卡住的地方：',
    english: '【英语】题型：__；背单词 __ 个 / 阅读 __ 篇；错题原因：',
    politics: '【政治】模块：__；背诵 __ 个考点；易混点：',
    cs: '【信息技术】模块：__；练习 __ 题；不熟的操作：'
  };

  /** 间隔重复的复习节奏（天） */
  var REVIEW_STEPS = [1, 3, 7, 15];
  var MAX_TAGS = 5;
  var MAX_IMAGES = 3;
  var MAX_TAG_LENGTH = 12;
  var MAX_EXTRA_LENGTH = 60;

  var STORAGE_KEY = 'study-log:v1';
  var SETTINGS_KEY = 'study-log:settings';
  var SCHEMA_VERSION = 1;
  var MAX_CONTENT = 2000;
  var MAX_MINUTES = 1440; // 单条记录最长 24 小时，防止误输入
  // 默认考试日期：江西专升本 2027-03-29（可在页脚改；改这里对新用户生效）
  var DEFAULT_SETTINGS = { dailyGoal: 90, examDate: '2027-03-29' };

  /* ------------------------------------------------------------------ */
  /* 基础工具                                                             */
  /* ------------------------------------------------------------------ */

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function subjectById(id) {
    for (var i = 0; i < SUBJECTS.length; i++) {
      if (SUBJECTS[i].id === id) return SUBJECTS[i];
    }
    return null;
  }

  /** 本地时区的 YYYY-MM-DD，避免 toISOString 造成的时区偏移 */
  function toDateString(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function todayString() {
    return toDateString(new Date());
  }

  /** 严格解析 YYYY-MM-DD，非法日期（如 2025-02-30）返回 null */
  function parseDate(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || '');
    if (!m) return null;
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  function createId() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch (e) {
      /* 忽略：走下面的兜底 */
    }
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function emptyState() {
    return { version: SCHEMA_VERSION, records: [] };
  }

  function asState(state) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.records)) return emptyState();
    return { version: SCHEMA_VERSION, records: state.records };
  }

  /* ------------------------------------------------------------------ */
  /* 校验                                                                 */
  /* ------------------------------------------------------------------ */

  function normalize(input) {
    input = input || {};
    var rawMinutes = input.minutes;
    if (typeof rawMinutes === 'string') {
      var t = rawMinutes.trim();
      rawMinutes = t === '' ? NaN : Number(t);
    } else if (typeof rawMinutes !== 'number') {
      // null / undefined / true / [] 等都不算合法时长
      rawMinutes = NaN;
    }
    return {
      subject: input.subject == null ? '' : String(input.subject).trim(),
      date: input.date == null ? '' : String(input.date).trim(),
      minutes: rawMinutes,
      content: input.content == null ? '' : String(input.content).replace(/\r\n/g, '\n').trim()
    };
  }

  /** 标签规整：支持数组或字符串（逗号/顿号/分号/空格分隔），去重、限量、限长 */
  function normalizeTags(input) {
    var raw = [];
    if (Array.isArray(input)) raw = input;
    else if (typeof input === 'string') raw = input.split(/[,，、;；\s]+/);
    else if (input != null) raw = [String(input)];

    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < raw.length; i++) {
      var tag = String(raw[i] == null ? '' : raw[i]).trim();
      if (!tag) continue;
      if (tag.length > MAX_TAG_LENGTH) tag = tag.slice(0, MAX_TAG_LENGTH);
      if (seen[tag]) continue;
      seen[tag] = true;
      out.push(tag);
      if (out.length >= MAX_TAGS) break;
    }
    return out;
  }

  /** 返回某科目定义的差异化字段 */
  function extraFieldsOf(subject) {
    return EXTRA_FIELDS[subject] || [];
  }

  /**
   * 图片附件只存 id 引用（二进制在 IndexedDB，见 files.js），每條记录最多 3 张。
   * @param {Array|string} input
   */
  function normalizeImages(input) {
    if (!Array.isArray(input)) return [];
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < input.length; i++) {
      var id = String(input[i] == null ? '' : input[i]).trim();
      if (!id || id.length > 80 || seen[id]) continue;
      seen[id] = true;
      out.push(id);
      if (out.length >= MAX_IMAGES) break;
    }
    return out;
  }

  /**
   * 校验并规整科目的差异化字段
   * @returns {{ok:boolean, errors:Object, value:Object}}
   */
  function validateExtra(subject, input) {
    var fields = extraFieldsOf(subject);
    var source = input && typeof input === 'object' ? input : {};
    var errors = {};
    var value = {};

    fields.forEach(function (field) {
      var raw = source[field.key];
      var text = raw == null ? '' : String(raw).trim();
      if (!text) return;
      if (field.type === 'number') {
        var num = Number(text);
        if (!isFinite(num) || Math.floor(num) !== num || num < 0 || num > 9999) {
          errors[field.key] = field.label + '需填 0 ~ 9999 的整数';
          return;
        }
        value[field.key] = num;
        return;
      }
      if (field.type === 'select') {
        // 知识点必须是配置里的选项之一，避免手抖/旧数据污染统计
        if (field.options.indexOf(text) === -1) {
          errors[field.key] = '请选择有效的' + field.label;
          return;
        }
        value[field.key] = text;
        return;
      }
      if (text.length > MAX_EXTRA_LENGTH) {
        errors[field.key] = field.label + '不能超过 ' + MAX_EXTRA_LENGTH + ' 字';
        return;
      }
      value[field.key] = text;
    });

    return { ok: Object.keys(errors).length === 0, errors: errors, value: value };
  }

  /** 把差异化字段拼成可读文本，例如「章节 第3章 · 错题 2」 */
  function extraSummary(record) {
    if (!record || !record.extra) return [];
    var fields = extraFieldsOf(record.subject);
    var out = [];
    fields.forEach(function (field) {
      var value = record.extra[field.key];
      if (value == null || value === '') return;
      out.push(field.label + ' ' + value);
    });
    return out;
  }

  function nextReviewDate(baseDate, step) {
    var base = parseDate(baseDate);
    if (!base) return '';
    var days = REVIEW_STEPS[Math.max(0, Math.min(REVIEW_STEPS.length - 1, step))];
    return toDateString(new Date(base.getFullYear(), base.getMonth(), base.getDate() + days));
  }

  /**
   * 校验并规整输入
   * @returns {{ok:boolean, errors:Object<string,string>, value:Object}}
   */
  function validate(input) {
    var v = normalize(input);
    var errors = {};

    if (!subjectById(v.subject)) {
      errors.subject = '请选择科目';
    }
    if (!parseDate(v.date)) {
      errors.date = '请选择有效的日期';
    } else if (v.date > todayString()) {
      // 未来日期的记录会让「本周 / 本月 / 学习天数」失真，直接不放行
      errors.date = '日期不能晚于今天';
    }
    if (!isFinite(v.minutes) || Math.floor(v.minutes) !== v.minutes) {
      errors.minutes = '时长需填写整数分钟';
    } else if (v.minutes < 1 || v.minutes > MAX_MINUTES) {
      errors.minutes = '时长需在 1 ~ 1440 分钟之间';
    }
    if (v.content.length > MAX_CONTENT) {
      errors.content = '学习内容不能超过 ' + MAX_CONTENT + ' 字';
    }

    var extraChecked = validateExtra(v.subject, input && input.extra);
    if (!extraChecked.ok) {
      Object.keys(extraChecked.errors).forEach(function (key) {
        errors['extra:' + key] = extraChecked.errors[key];
      });
    }
    v.extra = extraChecked.value;
    v.tags = normalizeTags(input && input.tags);
    v.images = normalizeImages(input && input.images);
    v.review = Boolean(input && input.review);

    return { ok: Object.keys(errors).length === 0, errors: errors, value: v };
  }

  /* ------------------------------------------------------------------ */
  /* 增删改                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * 新增一条记录
   * @param {Object} state
   * @param {Object} input {subject, date, minutes, content, extra, tags, review}
   * @param {Date} [now] 便于测试注入时间
   */
  function addRecord(state, input, now) {
    var checked = validate(input);
    if (!checked.ok) return { ok: false, errors: checked.errors, state: state };

    var ts = (now || new Date()).toISOString();
    var value = checked.value;
    var record = {
      id: createId(),
      subject: value.subject,
      date: value.date,
      minutes: value.minutes,
      content: value.content,
      extra: value.extra,
      tags: value.tags,
      images: value.images,
      reviewStep: value.review ? 0 : -1,
      reviewAt: value.review ? nextReviewDate(value.date, 0) : '',
      createdAt: ts,
      updatedAt: ts
    };
    var next = asState(state);
    return {
      ok: true,
      record: record,
      state: { version: SCHEMA_VERSION, records: next.records.concat([record]) }
    };
  }

  /** 修改一条记录（id / createdAt 保持不变） */
  function updateRecord(state, id, input, now) {
    var current = asState(state);
    var index = -1;
    for (var i = 0; i < current.records.length; i++) {
      if (current.records[i].id === id) { index = i; break; }
    }
    if (index === -1) return { ok: false, errors: { form: '记录不存在，可能已被删除' }, state: state };

    var checked = validate(input);
    if (!checked.ok) return { ok: false, errors: checked.errors, state: state };

    var old = current.records[index];
    var value = checked.value;

    // 复习计划：原本就在计划里且已排期，改内容时不重置节奏；否则按当前选择重新排
    var keepReview = value.review && old.reviewAt && old.reviewStep >= 0;
    var reviewStep = value.review ? (keepReview ? old.reviewStep : 0) : -1;
    var reviewAt = value.review
      ? (keepReview ? old.reviewAt : nextReviewDate(value.date, 0))
      : '';

    var record = {
      id: old.id,
      subject: value.subject,
      date: value.date,
      minutes: value.minutes,
      content: value.content,
      extra: value.extra,
      tags: value.tags,
      images: value.images,
      reviewStep: reviewStep,
      reviewAt: reviewAt,
      createdAt: old.createdAt,
      updatedAt: (now || new Date()).toISOString()
    };
    var records = current.records.slice();
    records[index] = record;
    return { ok: true, record: record, state: { version: SCHEMA_VERSION, records: records } };
  }

  /** 删除一条记录 */
  function deleteRecord(state, id) {
    var current = asState(state);
    var records = current.records.filter(function (r) { return r.id !== id; });
    return {
      state: { version: SCHEMA_VERSION, records: records },
      removed: records.length !== current.records.length
    };
  }

  /**
   * 撤销删除：把删掉的那条按原样（保留 id 与时间戳）放回去。
   * 已存在同 id 或记录本身非法时拒绝，避免重复插入。
   */
  function restoreRecord(state, record) {
    var current = asState(state);
    if (!record || typeof record !== 'object' || !record.id) {
      return { ok: false, state: current, error: '记录无效，无法恢复' };
    }
    if (current.records.some(function (r) { return r.id === record.id; })) {
      return { ok: false, state: current, error: '记录已存在' };
    }
    var checked = validate(record);
    if (!checked.ok) {
      return { ok: false, state: current, error: '记录内容不完整，无法恢复' };
    }
    return {
      ok: true,
      record: record,
      state: { version: SCHEMA_VERSION, records: current.records.concat([record]) }
    };
  }

  /* ------------------------------------------------------------------ */
  /* 查询 / 筛选 / 统计                                                    */
  /* ------------------------------------------------------------------ */

  function compareRecords(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    var at = String(a.createdAt || '');
    var bt = String(b.createdAt || '');
    if (at !== bt) return at < bt ? 1 : -1;
    return 0;
  }

  /** 时间范围的起点（当天含）；range=all 返回 null */
  function rangeStart(range, today) {
    var base = parseDate(today || todayString());
    if (!base) return null;
    if (range === 'week') {
      var dow = (base.getDay() + 6) % 7; // 周一为 0
      return toDateString(new Date(base.getFullYear(), base.getMonth(), base.getDate() - dow));
    }
    if (range === 'month') {
      return toDateString(new Date(base.getFullYear(), base.getMonth(), 1));
    }
    return null;
  }

  /**
   * 按科目 + 时间范围 + 关键词 + 标签筛选，结果按日期倒序
   * @param {Array} records
   * @param {{subject?:string, range?:'all'|'week'|'month', keyword?:string, tag?:string, today?:string}} options
   */
  function filterRecords(records, options) {
    var opts = options || {};
    var subject = opts.subject || 'all';
    var range = opts.range || 'all';
    var start = rangeStart(range, opts.today || todayString());
    var keyword = opts.keyword == null ? '' : String(opts.keyword).trim().toLowerCase();
    var tag = opts.tag == null ? '' : String(opts.tag).trim();

    return (records || [])
      .filter(function (r) {
        if (!r || !parseDate(r.date)) return false;
        if (subject !== 'all' && r.subject !== subject) return false;
        if (start && r.date < start) return false;
        if (tag && !(Array.isArray(r.tags) && r.tags.indexOf(tag) !== -1)) return false;
        if (keyword) {
          var subjectName = (subjectById(r.subject) || {}).name || '';
          var extraText = extraSummary(r).join(' ');
          var tagText = Array.isArray(r.tags) ? r.tags.join(' ') : '';
          var haystack = [r.content || '', subjectName, r.date, extraText, tagText].join('\n').toLowerCase();
          if (haystack.indexOf(keyword) === -1) return false;
        }
        return true;
      })
      .sort(compareRecords);
  }

  /** 标签统计：跨科目汇总每个标签的时长与次数，按总时长倒序 */
  function tagStats(records) {
    var map = Object.create(null);
    (records || []).forEach(function (r) {
      if (!r || !Array.isArray(r.tags)) return;
      var minutes = isFinite(r.minutes) ? r.minutes : 0;
      r.tags.forEach(function (tag) {
        if (!tag) return;
        if (!map[tag]) map[tag] = { tag: tag, minutes: 0, count: 0 };
        map[tag].minutes += minutes;
        map[tag].count += 1;
      });
    });
    return Object.keys(map)
      .map(function (tag) { return map[tag]; })
      .sort(function (a, b) {
        if (b.minutes !== a.minutes) return b.minutes - a.minutes;
        return a.tag < b.tag ? -1 : (a.tag > b.tag ? 1 : 0);
      });
  }

  /* ------------------------------------------------------------------ */
  /* 复习（间隔重复 1 / 3 / 7 / 15 天）                                      */
  /* ------------------------------------------------------------------ */

  /** 今天该复习的记录（含逾期未复习的），按到期日升序 */
  function dueReviews(records, today) {
    var day = today || todayString();
    return (records || [])
      .filter(function (r) {
        return r && r.reviewAt && parseDate(r.reviewAt) && r.reviewAt <= day;
      })
      .sort(function (a, b) {
        if (a.reviewAt !== b.reviewAt) return a.reviewAt < b.reviewAt ? -1 : 1;
        return a.date < b.date ? 1 : -1;
      });
  }

  /**
   * 完成一次复习：推进到下一个间隔；走完 1/3/7/15 后退出复习计划。
   * @returns {{ok:boolean, state:Object, record:Object, done:boolean}}
   */
  function completeReview(state, id, today) {
    var current = asState(state);
    var day = today || todayString();
    var index = -1;
    for (var i = 0; i < current.records.length; i++) {
      if (current.records[i].id === id) { index = i; break; }
    }
    if (index === -1) return { ok: false, state: current, error: '记录不存在' };

    var old = current.records[index];
    if (!old.reviewAt) return { ok: false, state: current, error: '这条记录不在复习计划里' };

    var nextStep = (Number(old.reviewStep) || 0) + 1;
    var finished = nextStep >= REVIEW_STEPS.length;
    var record = Object.assign({}, old, {
      reviewStep: finished ? -1 : nextStep,
      reviewAt: finished ? '' : nextReviewDate(day, nextStep),
      updatedAt: new Date().toISOString()
    });
    var records = current.records.slice();
    records[index] = record;
    return { ok: true, state: { version: SCHEMA_VERSION, records: records }, record: record, done: finished };
  }

  /** 把一条记录加入 / 移出复习计划 */
  function setReview(state, id, enabled) {
    var current = asState(state);
    var index = -1;
    for (var i = 0; i < current.records.length; i++) {
      if (current.records[i].id === id) { index = i; break; }
    }
    if (index === -1) return { ok: false, state: current, error: '记录不存在' };

    var old = current.records[index];
    var record = Object.assign({}, old, {
      reviewStep: enabled === false || !enabled ? -1 : 0,
      reviewAt: enabled === false || !enabled ? '' : nextReviewDate(old.date, 0),
      updatedAt: new Date().toISOString()
    });
    var records = current.records.slice();
    records[index] = record;
    return { ok: true, state: { version: SCHEMA_VERSION, records: records }, record: record };
  }

  /**
   * 连续打卡天数：从今天往前数，遇到没记录的日子就停。
   * 今天还没记录不算断（今天还有机会），从昨天开始数。
   */
  function streakDays(records, today) {
    var set = Object.create(null);
    (records || []).forEach(function (r) {
      if (r && parseDate(r.date)) set[r.date] = true;
    });

    var base = parseDate(today || todayString());
    if (!base) base = new Date();
    var cursor = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    if (!set[toDateString(cursor)]) cursor.setDate(cursor.getDate() - 1);

    var count = 0;
    while (set[toDateString(cursor)]) {
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
      if (count > 3660) break; // 十年封顶，纯属防御
    }
    return count;
  }

  /**
   * 最近 N 天 vs 前 N 天的时长对比（趋势图上的"较前 7 天"）
   * @returns {{current:number, previous:number, delta:number}}
   */
  function comparePeriods(records, options) {
    var opts = options || {};
    var days = Math.max(1, Math.min(366, Math.floor(Number(opts.days)) || 7));
    var end = parseDate(opts.endDate || todayString()) || new Date();
    var startOfCurrent = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1));
    var startOfPrevious = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days * 2 - 1));
    var currentStart = toDateString(startOfCurrent);
    var previousStart = toDateString(startOfPrevious);

    var current = 0;
    var previous = 0;
    (records || []).forEach(function (r) {
      if (!r || !parseDate(r.date) || !isFinite(r.minutes)) return;
      if (r.date >= currentStart) current += r.minutes;
      else if (r.date >= previousStart) previous += r.minutes;
    });

    return { current: current, previous: previous, delta: current - previous };
  }

  /** 把记录导出成 CSV（带 BOM，Excel 双击直接正确显示中文） */
  function toCSV(records) {
    var header = ['日期', '科目', '时长(分钟)', '标签', '学习内容', '其他字段'];
    function escapeCell(value) {
      var text = value == null ? '' : String(value);
      if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
      return text;
    }
    var lines = [header.join(',')];
    (records || []).forEach(function (r) {
      lines.push([
        escapeCell(r.date),
        escapeCell(subjectNameOf(r.subject)),
        escapeCell(r.minutes),
        escapeCell(Array.isArray(r.tags) ? r.tags.join(' / ') : ''),
        escapeCell(r.content),
        escapeCell(extraSummary(r).join('；'))
      ].join(','));
    });
    return '\ufeff' + lines.join('\r\n') + '\r\n';
  }

  function subjectNameOf(id) {
    var found = subjectById(id);
    return found ? found.name : '未知';
  }

  /** 汇总：总时长、记录数、学习天数、分科目统计 */
  function summarize(records) {
    var list = records || [];
    var totalMinutes = 0;
    var validCount = 0;
    var days = {};
    var perSubject = {};
    var i;

    for (i = 0; i < SUBJECTS.length; i++) {
      perSubject[SUBJECTS[i].id] = { id: SUBJECTS[i].id, name: SUBJECTS[i].name, color: SUBJECTS[i].color, count: 0, minutes: 0 };
    }

    for (i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || !isFinite(r.minutes)) continue;
      validCount += 1;
      totalMinutes += r.minutes;
      if (r.date) days[r.date] = true;
      if (perSubject[r.subject]) {
        perSubject[r.subject].count += 1;
        perSubject[r.subject].minutes += r.minutes;
      }
    }

    return {
      count: validCount,
      totalMinutes: totalMinutes,
      dayCount: Object.keys(days).length,
      bySubject: SUBJECTS.map(function (s) { return perSubject[s.id]; })
    };
  }

  /** 取某科目定义里的知识点下拉字段（目前每科一个） */
  function knowledgeFieldOf(subjectId) {
    var fields = extraFieldsOf(subjectId);
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].type === 'select') return fields[i];
    }
    return null;
  }

  /** 所有「数字型」差异化字段的元信息（key → { label, unit, subjectId }） */
  function numericExtraMeta() {
    var meta = {};
    SUBJECTS.forEach(function (subject) {
      extraFieldsOf(subject.id).forEach(function (field) {
        if (field.type !== 'number') return;
        meta[field.key] = { key: field.key, label: field.label, unit: field.unit || '', subjectId: subject.id };
      });
    });
    return meta;
  }

  /**
   * 各科累计指标：时长 / 条数 + 所有数字型 extra 的累计值。
   * 例如「累计背单词 1200 个」「错题 37 道」——数据本来就在记录里，只是以前没聚合。
   */
  function subjectTotals(records) {
    var list = records || [];
    var perSubject = {};
    SUBJECTS.forEach(function (subject) {
      perSubject[subject.id] = {
        id: subject.id, name: subject.name, color: subject.color,
        minutes: 0, count: 0, extras: {}
      };
    });

    var validCount = 0;
    var totalMinutes = 0;

    list.forEach(function (record) {
      if (!record || !perSubject[record.subject] || !isFinite(record.minutes)) return;
      var bucket = perSubject[record.subject];
      validCount += 1;
      totalMinutes += record.minutes;
      bucket.minutes += record.minutes;
      bucket.count += 1;
      if (!record.extra || typeof record.extra !== 'object') return;
      Object.keys(record.extra).forEach(function (key) {
        var value = record.extra[key];
        if (typeof value !== 'number' || !isFinite(value)) return;
        bucket.extras[key] = (bucket.extras[key] || 0) + value;
      });
    });

    var overall = {};
    SUBJECTS.forEach(function (subject) {
      var extras = perSubject[subject.id].extras;
      Object.keys(extras).forEach(function (key) {
        overall[key] = (overall[key] || 0) + extras[key];
      });
    });

    return {
      minutes: totalMinutes,
      count: validCount,
      bySubject: SUBJECTS.map(function (s) { return perSubject[s.id]; }),
      extras: overall,
      meta: numericExtraMeta()
    };
  }

  /**
   * 知识点分布：按「科目 + 知识点」汇总时长 / 条数 / 数字型 extra。
   * @returns {{groups:Array, total:number}}
   */
  function knowledgeStats(records) {
    var list = records || [];
    var groups = [];
    var byId = {};

    SUBJECTS.forEach(function (subject) {
      var field = knowledgeFieldOf(subject.id);
      if (!field) return;
      var group = {
        id: subject.id,
        name: subject.name,
        color: subject.color,
        fieldLabel: field.label,
        items: [],
        _map: Object.create(null)
      };
      groups.push(group);
      byId[subject.id] = group;
    });

    list.forEach(function (record) {
      if (!record || !isFinite(record.minutes)) return;
      var group = byId[record.subject];
      if (!group) return;
      var field = knowledgeFieldOf(record.subject);
      var value = record.extra && field ? record.extra[field.key] : '';
      if (!value) return;

      var item = group._map[value];
      if (!item) {
        item = { value: String(value), minutes: 0, count: 0, extras: {} };
        group._map[value] = item;
        group.items.push(item);
      }
      item.minutes += record.minutes;
      item.count += 1;
      if (record.extra && typeof record.extra === 'object') {
        Object.keys(record.extra).forEach(function (key) {
          var v = record.extra[key];
          if (typeof v !== 'number' || !isFinite(v)) return;
          item.extras[key] = (item.extras[key] || 0) + v;
        });
      }
    });

    var total = 0;
    groups.forEach(function (group) {
      group.items.sort(function (a, b) {
        if (b.minutes !== a.minutes) return b.minutes - a.minutes;
        return a.value < b.value ? -1 : 1;
      });
      group.items.forEach(function (item) {
        total += item.minutes;
        item.maxInGroup = group.items[0].minutes;
      });
      delete group._map;
    });

    return { groups: groups.filter(function (g) { return g.items.length > 0; }), total: total };
  }

  /**
   * 生成"最近 N 天"的每日学习时长序列（图表用，纯数据、不碰 DOM）。
   * 缺失的日期补 0，保证柱状图的横轴是连续的，不会因为没学习就断开。
   * @param {Array} records 已按科目筛选过的记录
   * @param {{days?:number, endDate?:string}} options
   * @returns {Array<{date:string, total:number, bySubject:Array}>}
   */
  function trendSeries(records, options) {
    var opts = options || {};
    var days = Math.max(1, Math.min(366, Math.floor(Number(opts.days)) || 7));
    var end = parseDate(opts.endDate || todayString());
    if (!end) end = new Date();

    var byDate = Object.create(null);
    (records || []).forEach(function (r) {
      if (!r || !parseDate(r.date) || !isFinite(r.minutes)) return;
      if (!byDate[r.date]) byDate[r.date] = Object.create(null);
      byDate[r.date][r.subject] = (byDate[r.date][r.subject] || 0) + r.minutes;
    });

    var series = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
      var key = toDateString(d);
      var bucket = byDate[key] || {};
      var total = 0;
      var bySubject = SUBJECTS.map(function (s) {
        var minutes = bucket[s.id] || 0;
        total += minutes;
        return { id: s.id, name: s.name, color: s.color, minutes: minutes };
      });
      series.push({ date: key, total: total, bySubject: bySubject });
    }
    return series;
  }

  /** 把分钟格式化成「1 小时 20 分钟」 */
  function formatMinutes(minutes) {
    var m = Math.round(Number(minutes) || 0);
    if (m <= 0) return '0 分钟';
    if (m < 60) return m + ' 分钟';
    var h = Math.floor(m / 60);
    var rest = m % 60;
    return rest ? h + ' 小时 ' + rest + ' 分钟' : h + ' 小时';
  }

  /* ------------------------------------------------------------------ */
  /* 持久化 / 备份                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * 把存储里的原始数组整理成合法记录。
   * 原则是「能修就修，修不了才丢」：内容超长会截断保留，而不是整条丢弃；
   * 未来日期保留（可能是换过系统时钟），避免读一次就丢数据。
   * @returns {{records:Array, dropped:number}}
   */
  function sanitizeRecords(list) {
    var out = [];
    var seen = Object.create(null); // 不用普通对象，避免 __proto__ 之类的 id 误判重复
    var dropped = 0;
    var now = new Date().toISOString();
    var i;

    for (i = 0; i < list.length; i++) {
      var raw = list[i];
      if (!raw || typeof raw !== 'object') { dropped += 1; continue; }
      if (!subjectById(raw.subject) || !parseDate(raw.date)) { dropped += 1; continue; }

      var minutes = typeof raw.minutes === 'string' ? Number(raw.minutes.trim()) : raw.minutes;
      if (!isFinite(minutes) || Math.floor(minutes) !== minutes || minutes < 1 || minutes > MAX_MINUTES) {
        dropped += 1;
        continue;
      }

      var content = raw.content == null ? '' : String(raw.content);
      if (content.length > MAX_CONTENT) content = content.slice(0, MAX_CONTENT);

      var id = typeof raw.id === 'string' && raw.id ? raw.id : createId();
      if (seen[id]) id = createId();
      seen[id] = true;

      var extraChecked = validateExtra(raw.subject, raw.extra);
      var reviewAt = typeof raw.reviewAt === 'string' && parseDate(raw.reviewAt) ? raw.reviewAt : '';
      var reviewStep = reviewAt && isFinite(raw.reviewStep) ? Math.max(0, Math.min(REVIEW_STEPS.length - 1, Math.floor(raw.reviewStep))) : -1;

      out.push({
        id: id,
        subject: raw.subject,
        date: raw.date,
        minutes: minutes,
        content: content.trim(),
        extra: extraChecked.value,
        tags: normalizeTags(raw.tags),
        images: normalizeImages(raw.images),
        reviewStep: reviewStep,
        reviewAt: reviewAt,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
      });
    }
    return { records: out, dropped: dropped };
  }

  /* ------------------------------------------------------------------ */
  /* 设置（每日目标 / 考试日期）                                             */
  /* ------------------------------------------------------------------ */

  function normalizeSettings(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    var goal = Number(source.dailyGoal);
    if (!isFinite(goal) || Math.floor(goal) !== goal || goal < 10 || goal > MAX_MINUTES) {
      goal = DEFAULT_SETTINGS.dailyGoal;
    }
    // 未设置过 → 用默认考试日期；显式清空（空字符串/非法值）→ 空
    var examDate = '';
    if (typeof source.examDate === 'undefined') {
      examDate = DEFAULT_SETTINGS.examDate;
    } else if (typeof source.examDate === 'string' && parseDate(source.examDate)) {
      examDate = source.examDate;
    }
    return { dailyGoal: goal, examDate: examDate };
  }

  /** 距目标日期还有几天（今天=0，过去为负）；日期非法返回 null */
  function daysUntil(dateStr, today) {
    var target = parseDate(dateStr);
    var base = parseDate(today || todayString());
    if (!target || !base) return null;
    var targetMs = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
    var baseMs = Date.UTC(base.getFullYear(), base.getMonth(), base.getDate());
    return Math.round((targetMs - baseMs) / 86400000);
  }

  /** 设置对象是否为空（用于界面判断是否要提示"去设置考试日期"） */
  function settingsConfigured(settings) {
    var normalized = normalizeSettings(settings);
    return Boolean(normalized.examDate);
  }

  function loadSettings(storage) {
    try {
      if (!storage) return normalizeSettings(null);
      var raw = storage.getItem(SETTINGS_KEY);
      if (!raw) return normalizeSettings(null);
      return normalizeSettings(JSON.parse(raw));
    } catch (e) {
      return normalizeSettings(null);
    }
  }

  function saveSettings(storage, settings) {
    try {
      if (!storage) return { ok: false, error: '当前环境不支持本地存储' };
      storage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
      return { ok: true, settings: normalizeSettings(settings) };
    } catch (e) {
      return { ok: false, error: '保存失败：' + (e && e.message ? e.message : '存储不可用') };
    }
  }

  /* ------------------------------------------------------------------ */
  /* 周报（可直接复制的一段文字）                                            */
  /* ------------------------------------------------------------------ */

  function percent(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  }

  /**
   * 生成最近 N 天的复盘文字
   * @param {Array} records
   * @param {{days?:number, today?:string}} options
   */
  function weeklyReport(records, options) {
    var opts = options || {};
    var days = Math.max(1, Math.min(31, Math.floor(Number(opts.days)) || 7));
    var today = opts.today || todayString();
    var series = trendSeries(records, { days: days, endDate: today });
    var startDate = series.length ? series[0].date : today;

    var totalMinutes = 0;
    var dayCount = 0;
    var best = null;
    var perSubject = {};
    series.forEach(function (day) {
      totalMinutes += day.total;
      if (day.total > 0) dayCount += 1;
      if (!best || day.total > best.total) best = day;
      day.bySubject.forEach(function (subject) {
        if (!perSubject[subject.id]) perSubject[subject.id] = { name: subject.name, minutes: 0 };
        perSubject[subject.id].minutes += subject.minutes;
      });
    });

    var inWindow = recordsBetween(records, startDate, today);
    var subjectList = SUBJECTS
      .map(function (s) { return { name: s.name, minutes: perSubject[s.id] ? perSubject[s.id].minutes : 0 }; })
      .filter(function (s) { return s.minutes > 0; })
      .sort(function (a, b) { return b.minutes - a.minutes; });

    var lines = [];
    lines.push('【学习周报】' + shortDate(startDate) + ' ~ ' + shortDate(today));
    lines.push('本阶段学习 ' + formatMinutes(totalMinutes) + '，共 ' + inWindow.length + ' 条记录，覆盖 ' + dayCount + ' 天。');
    if (dayCount > 0) {
      lines.push('日均 ' + formatMinutes(Math.round(totalMinutes / days)) + '，连续打卡 ' + streakDays(inWindow, today) + ' 天。');
    }
    if (subjectList.length) {
      lines.push('科目分布：' + subjectList.map(function (s) {
        return s.name + ' ' + formatMinutes(s.minutes) + '（' + percent(s.minutes, totalMinutes) + '%）';
      }).join('｜'));
    }
    if (best && best.total > 0) {
      lines.push('最投入的一天：' + shortDate(best.date) + '，' + formatMinutes(best.total) + '。');
    }

    // 对比要基于全部记录：inWindow 已经裁掉了上一期，用它对比永远是 0
    var cmp = comparePeriods(records, { days: days, endDate: today });
    if (cmp.previous === 0) {
      if (totalMinutes > 0) lines.push('较前 ' + days + ' 天：之前没有记录，无法对比。');
    } else if (cmp.delta > 0) {
      lines.push('较前 ' + days + ' 天：多学了 ' + formatMinutes(cmp.delta) + '。');
    } else if (cmp.delta < 0) {
      lines.push('较前 ' + days + ' 天：少了 ' + formatMinutes(-cmp.delta) + '，注意别断档。');
    } else {
      lines.push('较前 ' + days + ' 天：时长持平。');
    }

    var tags = tagStats(inWindow).slice(0, 5);
    if (tags.length) {
      lines.push('高频标签：' + tags.map(function (t) { return t.tag + '（' + t.count + ' 次）'; }).join('、'));
    }

    var due = dueReviews(records, today).length;
    lines.push(due > 0 ? '待复习：' + due + ' 条。' : '待复习：暂无。');

    var toExam = opts.examDate ? daysUntil(opts.examDate, today) : null;
    if (toExam !== null && toExam >= 0) {
      lines.push('距考试还有 ' + toExam + ' 天。');
    }

    return lines.join('\n');
  }

  /** 内部用：按日期区间取记录（含首尾） */
  function recordsBetween(records, start, end) {
    return (records || []).filter(function (r) {
      return r && parseDate(r.date) && r.date >= start && r.date <= end;
    });
  }

  function shortDate(dateStr) {
    var d = parseDate(dateStr);
    if (!d) return dateStr;
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  /**
   * 从存储读取；数据损坏时安全降级为空数据，不抛异常。
   * 返回值额外带 dropped（被丢弃的条数），界面应据此提示用户，而不是默默吞掉。
   */
  function loadState(storage) {
    try {
      if (!storage) return { version: SCHEMA_VERSION, records: [], dropped: 0 };
      var raw = storage.getItem(STORAGE_KEY);
      if (!raw) return { version: SCHEMA_VERSION, records: [], dropped: 0 };
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.records)) {
        return { version: SCHEMA_VERSION, records: [], dropped: 0, corrupt: true };
      }
      var result = sanitizeRecords(data.records);
      return { version: SCHEMA_VERSION, records: result.records, dropped: result.dropped };
    } catch (e) {
      return { version: SCHEMA_VERSION, records: [], dropped: 0, corrupt: true };
    }
  }

  /** 写入存储；失败（配额/隐私模式）返回错误而不是崩溃 */
  function saveState(storage, state) {
    try {
      if (!storage) return { ok: false, error: '当前环境不支持本地存储' };
      storage.setItem(STORAGE_KEY, JSON.stringify(asState(state)));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: '保存失败：' + (e && e.message ? e.message : '存储不可用') };
    }
  }

  /**
   * 导出为可读 JSON（备份用）。
   * @param {Object} state
   * @param {Object<string,string>} [attachments] id → dataUrl 映射；传了就把图片内嵌进备份，
   *        换设备导入时才不会丢图（不传则只导出记录本身，兼容旧调用）。
   */
  function exportJSON(state, attachments) {
    var current = asState(state);
    var payload = {
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      records: current.records
    };

    if (attachments && typeof attachments === 'object') {
      var images = [];
      Object.keys(attachments).forEach(function (id) {
        var dataUrl = attachments[id];
        if (typeof dataUrl === 'string' && dataUrl.indexOf('data:image/') === 0) {
          images.push({ id: id, dataUrl: dataUrl });
        }
      });
      payload.attachments = images;
    }

    return JSON.stringify(payload, null, 2);
  }

  /**
   * 导入：整份替换（覆盖导入），并逐条校验。
   * 备份里内嵌的图片会作为 attachments 返回，由界面写回 IndexedDB。
   */
  function importJSON(text) {
    var data;
    try {
      data = JSON.parse(String(text));
    } catch (e) {
      return { ok: false, error: '文件不是有效的 JSON' };
    }

    var raw = null;
    if (Array.isArray(data)) raw = data;
    else if (data && Array.isArray(data.records)) raw = data.records;
    if (!raw) return { ok: false, error: '文件格式不正确：应包含 records 数组' };

    for (var i = 0; i < raw.length; i++) {
      var checked = validate(raw[i]);
      if (!checked.ok) {
        var field = Object.keys(checked.errors)[0];
        return { ok: false, error: '第 ' + (i + 1) + ' 条记录无效（' + checked.errors[field] + '）' };
      }
    }

    var attachments = [];
    if (data && Array.isArray(data.attachments)) {
      data.attachments.forEach(function (item) {
        if (!item || typeof item.id !== 'string' || typeof item.dataUrl !== 'string') return;
        if (item.dataUrl.indexOf('data:image/') !== 0) return;
        attachments.push({ id: item.id, dataUrl: item.dataUrl });
      });
    }

    return {
      ok: true,
      count: raw.length,
      attachments: attachments,
      state: { version: SCHEMA_VERSION, records: sanitizeRecords(raw).records }
    };
  }

  return {
    SUBJECTS: SUBJECTS,
    EXTRA_FIELDS: EXTRA_FIELDS,
    TEMPLATES: TEMPLATES,
    REVIEW_STEPS: REVIEW_STEPS,
    MAX_TAGS: MAX_TAGS,
    MAX_TAG_LENGTH: MAX_TAG_LENGTH,
    MAX_IMAGES: MAX_IMAGES,
    STORAGE_KEY: STORAGE_KEY,
    SETTINGS_KEY: SETTINGS_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    MAX_CONTENT: MAX_CONTENT,
    MAX_MINUTES: MAX_MINUTES,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    subjectById: subjectById,
    toDateString: toDateString,
    todayString: todayString,
    parseDate: parseDate,
    emptyState: emptyState,
    validate: validate,
    validateExtra: validateExtra,
    normalizeImages: normalizeImages,
    extraFieldsOf: extraFieldsOf,
    extraSummary: extraSummary,
    normalizeTags: normalizeTags,
    nextReviewDate: nextReviewDate,
    addRecord: addRecord,
    updateRecord: updateRecord,
    deleteRecord: deleteRecord,
    restoreRecord: restoreRecord,
    filterRecords: filterRecords,
    rangeStart: rangeStart,
    streakDays: streakDays,
    comparePeriods: comparePeriods,
    summarize: summarize,
    subjectTotals: subjectTotals,
    knowledgeStats: knowledgeStats,
    knowledgeFieldOf: knowledgeFieldOf,
    trendSeries: trendSeries,
    tagStats: tagStats,
    dueReviews: dueReviews,
    completeReview: completeReview,
    setReview: setReview,
    weeklyReport: weeklyReport,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    settingsConfigured: settingsConfigured,
    daysUntil: daysUntil,
    toCSV: toCSV,
    formatMinutes: formatMinutes,
    loadState: loadState,
    saveState: saveState,
    exportJSON: exportJSON,
    importJSON: importJSON
  };
});
