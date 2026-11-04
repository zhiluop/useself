/**
 * sub2api 用量 — Surge 面板脚本
 *
 * 数据来源（sub2api 仪表盘接口，一次请求拿到今日 + 累计 + Top 模型）:
 *   admin 模式: GET /api/v1/admin/dashboard/snapshot-v2  +  /api/v1/admin/dashboard/trend
 *   user  模式: GET /api/v1/usage/dashboard/snapshot-v2  +  /api/v1/usage/dashboard/trend
 *
 * 今日边界与近 14 日走势都由服务端按 tz 参数计算（start_date / end_date / timezone），
 * 不依赖设备本地时区，夏令时切换日也不会错位。
 *
 * module argument:
 *   url=https://sub2api.example.com   sub2api 地址（可带 /api/v1，默认 http://127.0.0.1:8080）
 *   key=adm_sc_xxxx                  管理员访问密钥，走 x-api-key（推荐）
 *   token=<JWT>                      管理员/用户 JWT，走 Authorization: Bearer
 *   mode=admin|user                  默认 admin
 *   cost=actual|standard             计费口径，默认 actual（实际扣除）
 *   icon=dollarsign.circle           面板图标 (SF Symbol)
 *   tz=Asia/Shanghai                 今日/近 14 日边界时区，默认 Asia/Shanghai
 */

const $env = (() => {
  if (typeof $argument !== 'undefined' && typeof $httpClient !== 'undefined') {
    // Surge
    const args = {};
    String($argument || '')
      .split('&')
      .filter(Boolean)
      .forEach((kv) => {
        const idx = kv.indexOf('=');
        if (idx > 0) args[kv.slice(0, idx)] = decodeURIComponent(kv.slice(idx + 1));
      });
    return { platform: 'Surge', args };
  }
  return { platform: 'unknown', args: {} };
})();

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';
const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
const TITLE = 'sub2api 用量';
const REQUEST_TIMEOUT_SECONDS = 10;
const WEEK_DAYS = 14;

const ICON = arg('icon') || 'dollarsign.circle';
const TIME_ZONE = arg('tz') || DEFAULT_TIME_ZONE;
const MODE = String(arg('mode') || 'admin').toLowerCase() === 'user' ? 'user' : 'admin';
const COST_MODE = String(arg('cost') || 'actual').toLowerCase() === 'standard' ? 'standard' : 'actual';
const API_BASE = normalizeApiBase(arg('url') || DEFAULT_BASE_URL);
const ADMIN_KEY = arg('key') || '';
const TOKEN = arg('token') || '';
const TIME_ZONE_ERROR = getTimeZoneError(TIME_ZONE);
// $trigger: "button"（点击面板刷新按钮）/ "auto-interval"（定时自动刷新）
const TRIGGER = typeof $trigger !== 'undefined' && $trigger ? $trigger : 'auto-interval';

function arg(name) {
  return $env.args[name];
}

function number(value) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

function repeat(text, times) {
  let out = '';
  for (let i = 0; i < times; i += 1) out += text;
  return out;
}

// ==================== 地址与时区 ====================

function normalizeApiBase(raw) {
  let base = String(raw || '').trim().replace(/\/+$/, '');
  if (!base) base = DEFAULT_BASE_URL;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(base)) base = `http://${base}`;
  // 允许直接粘贴 /api/v1/admin/dashboard 之类的地址
  base = base.replace(/\/(admin|usage)(\/dashboard)?$/i, '');
  if (!/\/api\/v1$/i.test(base)) base += '/api/v1';
  return base;
}

function createDateFormatter(tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

function readDatePart(parts, type) {
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index].type === type) return Number(parts[index].value);
  }
  throw new Error(`无法获取时区日期中的 ${type} 字段`);
}

function getTimeZoneError(tz) {
  try {
    createDateFormatter(tz).formatToParts(new Date(0));
    return null;
  } catch (e) {
    return `时区无效或不受支持: ${tz}`;
  }
}

function pad2(value) {
  return value < 10 ? `0${value}` : String(value);
}

// 该时刻在 tz 下的日历日期（YYYY-MM-DD）
function dateString(date, tz) {
  const parts = createDateFormatter(tz).formatToParts(date);
  return `${readDatePart(parts, 'year')}-${pad2(readDatePart(parts, 'month'))}-${pad2(readDatePart(parts, 'day'))}`;
}

function localDateString(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// 纯日历日期加减，不受时区偏移影响
function shiftDate(day, delta) {
  const parts = String(day).split('-').map(Number);
  const shifted = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]) + delta * 86400000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function todayString(tz, now) {
  const at = now instanceof Date ? now : new Date();
  try {
    return dateString(at, tz);
  } catch (e) {
    // 时区解析失败时仍发出请求，面板会明确提示已回退设备本地日界。
    return localDateString(at);
  }
}

function formatRefreshTime(date, tz) {
  if (!tz) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

// 时区缩写（Asia/Shanghai → GMT+8），比整串 IANA 名省地方
function zoneAbbr(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date());
    for (let index = 0; index < parts.length; index += 1) {
      if (parts[index].type === 'timeZoneName') return parts[index].value;
    }
  } catch (e) {
    // 落到下面的兜底
  }
  return tz;
}

// ==================== 格式化 ====================

function fmtInt(value) {
  const n = Math.round(number(value));
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtTokens(value) {
  const n = number(value);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return String(Math.round(n));
}

function fmtCost(value) {
  const n = number(value);
  if (n === 0) return '0.00';
  if (n < 0) return `-${fmtCost(-n)}`;
  if (n < 0.01) return n.toFixed(4);
  if (n >= 1000) return fmtInt(n);
  return n.toFixed(2);
}

// 面板字体是比例字体，空格对不齐，这里只用来估算截断长度：中文按两格算
function cellWidth(ch) {
  const code = ch.charCodeAt(0);
  // U+2BFF 以下基本是西文/符号（含 … ─ ▁ ▇），等宽字体里占一格；
  // CJK、全角标点、emoji 及更靠后的字符按两格。
  return code <= 0x2bff ? 1 : 2;
}

function visualWidth(text) {
  let width = 0;
  for (const ch of String(text)) width += cellWidth(ch);
  return width;
}

// 超宽文本截断补省略号，保证不撑破表格
function clip(text, width) {
  const source = String(text);
  if (visualWidth(source) <= width) return source;
  let out = '';
  let used = 0;
  for (const ch of source) {
    const cell = cellWidth(ch);
    if (used + cell > width - 1) break;
    out += ch;
    used += cell;
  }
  return `${out}…`;
}

// ==================== 数据归一化 ====================

function tokensOf(row) {
  return (
    number(row.total_tokens) ||
    number(row.input_tokens) + number(row.output_tokens) + number(row.cache_creation_tokens) + number(row.cache_read_tokens)
  );
}

function emptyUsage() {
  return { requests: 0, tokens: 0, cost: 0, actualCost: 0 };
}

function sumTrend(points) {
  const total = emptyUsage();
  const list = points && points.length ? points : [];
  for (let i = 0; i < list.length; i += 1) {
    const point = list[i] || {};
    total.requests += number(point.requests);
    total.tokens += tokensOf(point);
    total.cost += number(point.cost);
    total.actualCost += number(point.actual_cost);
  }
  return total;
}

function sumTotals(stats) {
  if (!stats) return null;
  return {
    requests: number(stats.total_requests),
    tokens: tokensOf({
      total_tokens: stats.total_tokens,
      input_tokens: stats.total_input_tokens,
      output_tokens: stats.total_output_tokens,
      cache_creation_tokens: stats.total_cache_creation_tokens,
      cache_read_tokens: stats.total_cache_read_tokens
    }),
    cost: number(stats.total_cost),
    actualCost: number(stats.total_actual_cost)
  };
}

function sumToday(stats) {
  if (!stats) return null;
  return {
    requests: number(stats.today_requests),
    tokens: tokensOf({
      total_tokens: stats.today_tokens,
      input_tokens: stats.today_input_tokens,
      output_tokens: stats.today_output_tokens,
      cache_creation_tokens: stats.today_cache_creation_tokens,
      cache_read_tokens: stats.today_cache_read_tokens
    }),
    cost: number(stats.today_cost),
    actualCost: number(stats.today_actual_cost)
  };
}

function costOf(usage) {
  if (!usage) return 0;
  return COST_MODE === 'standard' ? usage.cost : usage.actualCost;
}

function normalizeModels(models) {
  const list = (models && models.length ? models : []).map((model) => ({
    model: String((model && model.model) || 'unknown'),
    requests: number(model && model.requests),
    tokens: tokensOf(model || {}),
    cost: number(model && model.cost),
    actualCost: number(model && model.actual_cost)
  }));
  list.sort((left, right) => {
    const diff = costOf(right) - costOf(left);
    if (diff !== 0) return diff;
    return right.requests - left.requests;
  });
  return list;
}

function problemAccounts(stats) {
  if (!stats) return null;
  const error = number(stats.error_accounts);
  const ratelimit = number(stats.ratelimit_accounts);
  const overload = number(stats.overload_accounts);
  if (error + ratelimit + overload === 0) return null;
  const parts = [];
  if (error) parts.push(`${error} 异常`);
  if (ratelimit) parts.push(`${ratelimit} 限流`);
  if (overload) parts.push(`${overload} 过载`);
  return parts.join(' · ');
}

// ==================== HTTP ====================

function encodeQuery(params) {
  const pairs = [];
  for (const name in params) {
    if (Object.prototype.hasOwnProperty.call(params, name)) {
      pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(params[name])}`);
    }
  }
  return pairs.join('&');
}

function authHeaders() {
  const headers = { Accept: 'application/json' };
  if (ADMIN_KEY) headers['x-api-key'] = ADMIN_KEY;
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  return headers;
}

function fetchJson(url, callback) {
  $httpClient.get({ url, headers: authHeaders(), timeout: REQUEST_TIMEOUT_SECONDS }, (error, response, body) => {
    if (error) {
      callback(String(error), 0, null, null);
      return;
    }
    const status = response && response.status ? Number(response.status) : 0;
    let parsed = null;
    let parseError = null;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      parseError = e;
    }
    callback(null, status, parsed, parseError);
  });
}

function envelopeMessage(parsed) {
  if (!parsed || typeof parsed !== 'object') return '';
  return typeof parsed.message === 'string' ? parsed.message : '';
}

// { code, message, data } 封装 → 取出 data；出错时给出可读原因
function unwrapResponse(status, parsed, parseError) {
  if (status === 401) {
    return { error: `认证失败 (401): 密钥无效或已过期${envelopeMessage(parsed) ? `\n${envelopeMessage(parsed)}` : ''}` };
  }
  if (status === 403) {
    return { error: `权限不足 (403): 管理员密钥需要 dashboard.read 权限${envelopeMessage(parsed) ? `\n${envelopeMessage(parsed)}` : ''}` };
  }
  if (status === 429) return { error: '请求过于频繁 (429)，稍后自动刷新重试' };
  if (status === 404) return { error: '接口不存在 (404)：确认 url 指向 sub2api 服务' };
  if (parseError) return { error: `响应解析失败 (HTTP ${status || '?'})` };
  if (status >= 400) {
    return { error: `请求失败 (HTTP ${status})${envelopeMessage(parsed) ? `: ${envelopeMessage(parsed)}` : ''}` };
  }
  if (parsed && typeof parsed === 'object' && typeof parsed.code === 'number' && parsed.code !== 0) {
    return { error: `服务返回错误 ${parsed.code}${envelopeMessage(parsed) ? `: ${envelopeMessage(parsed)}` : ''}` };
  }
  const data = parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed;
  if (!data) return { error: `服务返回空数据 (HTTP ${status || '?'})` };
  return { data };
}

// ==================== 渲染 ====================

function withTimeZoneWarning(content) {
  return TIME_ZONE_ERROR ? `${content}\n${TIME_ZONE_ERROR}，已回退设备本地日界。` : content;
}

function done(payload) {
  $done(payload);
}

function fail(message, color) {
  done({
    title: TITLE,
    content: withTimeZoneWarning(message),
    icon: ICON,
    'icon-color': color || '#FF3B30'
  });
}

function buildTitle(usage) {
  return `今日 $${fmtCost(costOf(usage))} · ${fmtTokens(usage.tokens)} tok`;
}

// 面板字体是比例字体：靠空格右对齐会在数字变化时错位，所以只做「标签 + 值」的等节奏排版。
// 标签统一两个汉字宽，续行用两个全角空格（= 两个汉字宽），这样任何字号下都对齐。
const LABEL_GAP = '  ';
const CONTINUATION_INDENT = '　　';
const DIVIDER = repeat('-', 30);
const WEEK_LABEL = WEEK_DAYS === 7 ? '一周' : '两周';
const MODEL_NAME_LIMIT = 24;

function row(label, value) {
  return label + LABEL_GAP + value;
}

function usageLine(label, usage) {
  return row(
    label,
    [`$${fmtCost(costOf(usage))}`, `${fmtTokens(usage.tokens)} tok`, `${fmtInt(usage.requests)} 次`].join(' · ')
  );
}

function buildContent(state) {
  const today = state.today || emptyUsage();
  const rows = [usageLine('今日', today)];

  if (state.total) rows.push(usageLine('累计', state.total));

  rows.push(DIVIDER);

  if (state.week) {
    const weekCost = costOf(state.week.usage);
    rows.push(row(WEEK_LABEL, `$${fmtCost(weekCost)} · 日均 $${fmtCost(weekCost / WEEK_DAYS)}`));
  }

  const models = state.models && state.models.length ? state.models.slice(0, 2) : [];
  models.forEach((model, index) => {
    const name = clip(model.model, MODEL_NAME_LIMIT);
    rows.push(row(index === 0 ? '模型' : CONTINUATION_INDENT, `${name} $${fmtCost(costOf(model))}`));
  });

  if (state.accounts) rows.push(row('账号', state.accounts));

  const refreshedAt = state.refreshedAt instanceof Date ? state.refreshedAt : new Date();
  if (TIME_ZONE_ERROR) {
    rows.push(`${formatRefreshTime(refreshedAt, null)} 设备本地 · ${TIME_ZONE_ERROR}${TRIGGER === 'button' ? ' · 手动' : ''}`);
  } else {
    const footer = [`${formatRefreshTime(refreshedAt, TIME_ZONE)} ${zoneAbbr(TIME_ZONE)}`];
    if (state.perf && (state.perf.rpm > 0 || state.perf.tpm > 0)) {
      footer.push(`${fmtInt(state.perf.rpm)}rpm ${fmtInt(state.perf.tpm)}tpm`);
    }
    if (state.legacy) footer.push('兼容接口');
    if (state.stale) footer.push('延迟');
    if (TRIGGER === 'button') footer.push('手动');
    rows.push(footer.join(' · '));
  }

  return rows.join('\n');
}

function render(state) {
  const today = state.today || emptyUsage();
  done({
    title: TITLE,
    subtitle: buildTitle(today),
    content: buildContent(state),
    icon: ICON,
    'icon-color': state.stale ? '#FF9500' : '#34C759'
  });
}

// ==================== 请求流程 ====================

function dashboardPaths() {
  if (MODE === 'user') {
    return { snapshot: 'usage/dashboard/snapshot-v2', trend: 'usage/dashboard/trend', models: 'usage/dashboard/models', stats: 'usage/dashboard/stats' };
  }
  return {
    snapshot: 'admin/dashboard/snapshot-v2',
    trend: 'admin/dashboard/trend',
    models: 'admin/dashboard/models',
    stats: 'admin/dashboard/stats'
  };
}

function loadWeekTrend(state, paths, weekStart, today) {
  const query = encodeQuery({
    start_date: weekStart,
    end_date: today,
    granularity: 'day',
    timezone: TIME_ZONE
  });
  fetchJson(`${API_BASE}/${paths.trend}?${query}`, (error, status, parsed, parseError) => {
    if (!error) {
      const result = unwrapResponse(status, parsed, parseError);
      if (!result.error) {
        const points = result.data.trend && result.data.trend.length ? result.data.trend : [];
        if (points.length) state.week = { usage: sumTrend(points) };
      }
    }
    // 走势只是装饰，取不到就不显示，不影响今日数据
    render(state);
  });
}

function requestUsage() {
  if (MODE === 'user' && !TOKEN) {
    fail('缺少 token：user 模式需要 JWT\n请在 argument 中填写 token=');
    return;
  }
  if (MODE === 'admin' && !ADMIN_KEY && !TOKEN) {
    fail('缺少密钥：请在 argument 中填写 key=（管理员访问密钥）');
    return;
  }

  const requestedAt = new Date();
  if (TRIGGER === 'button') {
    // 手动刷新时 Surge 会保留上一次结果，这里主动给出即时反馈
    $notification.post(TITLE, '正在手动刷新…', '');
  }

  const today = todayString(TIME_ZONE, requestedAt);
  const weekStart = shiftDate(today, -(WEEK_DAYS - 1));
  const paths = dashboardPaths();

  const snapshotParams = {
    start_date: today,
    end_date: today,
    granularity: 'day',
    timezone: TIME_ZONE,
    include_trend: '1',
    include_model_stats: '1',
    include_group_stats: '0'
  };
  if (MODE === 'admin') snapshotParams.include_stats = '1';

  fetchJson(`${API_BASE}/${paths.snapshot}?${encodeQuery(snapshotParams)}`, (error, status, parsed, parseError) => {
    if (error) {
      fail(`请求失败: ${error}\n检查 url 与服务是否可达`);
      return;
    }
    if (status === 404 && MODE === 'admin') {
      requestAdminLegacy(requestedAt, today, weekStart, paths);
      return;
    }
    const result = unwrapResponse(status, parsed, parseError);
    if (result.error) {
      fail(result.error);
      return;
    }
    const snapshot = result.data;
    const stats = MODE === 'admin' ? snapshot.stats : null;
    const state = {
      today: sumTrend(snapshot.trend),
      models: normalizeModels(snapshot.models),
      total: sumTotals(stats),
      perf: stats ? { rpm: number(stats.rpm), tpm: number(stats.tpm) } : null,
      accounts: problemAccounts(stats),
      stale: !!(stats && stats.stats_stale),
      legacy: false,
      week: null,
      refreshedAt: requestedAt
    };
    loadWeekTrend(state, paths, weekStart, today);
  });
}

// 旧版 sub2api 没有 snapshot-v2：退回 stats + models + trend 三个接口
function requestAdminLegacy(requestedAt, today, weekStart, paths) {
  fetchJson(`${API_BASE}/${paths.stats}?timezone=${encodeURIComponent(TIME_ZONE)}`, (error, status, parsed, parseError) => {
    if (error) {
      fail(`请求失败: ${error}`);
      return;
    }
    const result = unwrapResponse(status, parsed, parseError);
    if (result.error) {
      fail(result.error);
      return;
    }
    const stats = result.data;
    const state = {
      today: sumToday(stats),
      models: [],
      total: sumTotals(stats),
      perf: { rpm: number(stats.rpm), tpm: number(stats.tpm) },
      accounts: problemAccounts(stats),
      stale: !!stats.stats_stale,
      legacy: true,
      week: null,
      refreshedAt: requestedAt
    };

    const modelQuery = encodeQuery({ start_date: today, end_date: today, timezone: TIME_ZONE });
    fetchJson(`${API_BASE}/${paths.models}?${modelQuery}`, (modelError, modelStatus, modelParsed, modelParseError) => {
      if (!modelError) {
        const modelResult = unwrapResponse(modelStatus, modelParsed, modelParseError);
        if (!modelResult.error) state.models = normalizeModels(modelResult.data.models);
      }
      loadWeekTrend(state, paths, weekStart, today);
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildContent,
    clip,
    costOf,
    dateString,
    fmtCost,
    fmtInt,
    fmtTokens,
    normalizeApiBase,
    normalizeModels,
    row,
    shiftDate,
    sumToday,
    sumTotals,
    sumTrend,
    todayString,
    unwrapResponse,
    visualWidth,
    zoneAbbr
  };
} else {
  requestUsage();
}
