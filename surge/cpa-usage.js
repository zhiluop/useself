/**
 * CPA Daily Usage — Surge 面板脚本
 * 数据来源: CPA Manager Plus `/v0/management/dashboard/summary`
 * 仅展示"今日"用量: Token 总量 / 服务端估算成本 / 调用次数 / 成功率 / Top 模型
 *
 * module argument:
 *   url=http://127.0.0.1:18317   CPA Manager Plus 服务地址
 *   key=YOUR_ADMIN_KEY           Admin Key (Bearer)
 *   icon=dollar.circle           面板图标 (SF Symbol)
 *   tz=Asia/Shanghai             今日边界时区, 默认 Asia/Shanghai
 */

const $ = (() => {
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

const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
const DAY_BOUNDARY_SEARCH_WINDOW_MS = 48 * 60 * 60 * 1000;
const BASE = ($args('url') || 'http://127.0.0.1:18317').replace(/\/+$/, '');
const ADMIN_KEY = $args('key') || '';
const ICON = $args('icon') || 'dollarsign.circle';
const TIME_ZONE = $args('tz') || DEFAULT_TIME_ZONE;
const TIME_ZONE_ERROR = getTimeZoneError(TIME_ZONE);
// $trigger: "button"（用户点击面板刷新按钮，主动刷新）/ "auto-interval"（定时自动刷新）
const TRIGGER =
  typeof $trigger !== 'undefined' && $trigger ? $trigger : 'auto-interval';

function $args(name) {
  return $.args[name];
}

function fmtInt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function fmtTokens(n) {
  n = Number(n || 0);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return String(n);
}

function fmtCost(n) {
  n = Number(n || 0);
  return n.toFixed(2);
}

function getTimeZoneError(tz) {
  try {
    // 统计依赖 formatToParts；预检同一能力，避免旧运行时静默回退本地日界。
    getCalendarDate(new Date(0), tz);
    return null;
  } catch (e) {
    return `时区无效或不受支持: ${tz}`;
  }
}

function getCalendarDate(date, tz) {
  const parts = createCalendarDateFormatter(tz).formatToParts(date);
  return {
    year: readDatePart(parts, 'year'),
    month: readDatePart(parts, 'month'),
    day: readDatePart(parts, 'day')
  };
}

function zonedStartOfDayToEpoch(date, tz) {
  const formatter = createCalendarDateFormatter(tz);
  const wallClockUtc = Date.UTC(date.year, date.month - 1, date.day);
  let beforeDate = wallClockUtc - DAY_BOUNDARY_SEARCH_WINDOW_MS;
  let atOrAfterDate = wallClockUtc + DAY_BOUNDARY_SEARCH_WINDOW_MS;

  // 在目标日附近搜索。按 epoch 排序的本地日历日期单调不减，二分可避开
  // 夏令时切换日中“当前时刻 offset”与午夜 offset 不同的问题。
  while (compareCalendarDates(readCalendarDate(beforeDate, formatter), date) >= 0) {
    beforeDate -= DAY_BOUNDARY_SEARCH_WINDOW_MS;
  }
  while (compareCalendarDates(readCalendarDate(atOrAfterDate, formatter), date) < 0) {
    atOrAfterDate += DAY_BOUNDARY_SEARCH_WINDOW_MS;
  }

  while (atOrAfterDate - beforeDate > 1) {
    const midpoint = beforeDate + Math.floor((atOrAfterDate - beforeDate) / 2);
    if (compareCalendarDates(readCalendarDate(midpoint, formatter), date) >= 0) {
      atOrAfterDate = midpoint;
    } else {
      beforeDate = midpoint;
    }
  }

  return atOrAfterDate;
}

function createCalendarDateFormatter(tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

function readCalendarDate(epochMs, formatter) {
  const parts = formatter.formatToParts(new Date(epochMs));
  return {
    year: readDatePart(parts, 'year'),
    month: readDatePart(parts, 'month'),
    day: readDatePart(parts, 'day')
  };
}

function readDatePart(parts, type) {
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index].type === type) return Number(parts[index].value);
  }
  throw new Error(`无法获取时区日期中的 ${type} 字段`);
}

function compareCalendarDates(left, right) {
  if (left.year !== right.year) return left.year - right.year;
  if (left.month !== right.month) return left.month - right.month;
  return left.day - right.day;
}

function localStartOfDayMs(now) {
  const localDate = new Date(now.getTime());
  localDate.setHours(0, 0, 0, 0);
  return localDate.getTime();
}

function todayStartMs(tz, now) {
  const currentTime = now instanceof Date ? now : new Date();
  try {
    return zonedStartOfDayToEpoch(getCalendarDate(currentTime, tz), tz);
  } catch (e) {
    // 时区解析失败时仍发出请求；面板会明确提示已使用设备本地日界。
    return localStartOfDayMs(currentTime);
  }
}

function formatRefreshTime(date, tz) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

function encodeQuery(params) {
  const pairs = [];
  for (const name in params) {
    if (Object.prototype.hasOwnProperty.call(params, name)) {
      pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(params[name])}`);
    }
  }
  return pairs.join('&');
}

function buildSummaryQuery(tz, now) {
  const requestTime = now instanceof Date ? now : new Date();
  return encodeQuery({
    today_start_ms: String(todayStartMs(tz, requestTime)),
    now_ms: String(requestTime.getTime()),
    top_models: '5',
    recent_failures: '5'
  });
}

function withTimeZoneWarning(content) {
  return TIME_ZONE_ERROR
    ? `${content}\n${TIME_ZONE_ERROR}，已回退设备本地日界。`
    : content;
}

function getTitle(today) {
  const cost = fmtCost(today.total_cost);
  const tokens = fmtTokens(today.total_tokens);
  return `今日 $${cost} · ${tokens} Tokens`;
}

// 中文等宽对齐：把标签 pad 到固定显示宽度
function pad(label, value, width) {
  let visual = 0;
  for (const ch of label) visual += ch.charCodeAt(0) > 0xff ? 2 : 1;
  let padLen = width - visual;
  if (padLen < 1) padLen = 1;
  return label + ' '.repeat(padLen) + value;
}

function render(today, topModels, refreshedAt) {
  const lines = [];
  lines.push(pad('成本', `$${fmtCost(today.total_cost)}`, 5) + ' │ ' + pad('Tokens', fmtTokens(today.total_tokens), 8));
  lines.push(pad('调用', `${fmtInt(today.total_calls)} 次`, 5) + ' │ ' + pad('成功率', `${(today.success_rate * 100).toFixed(1)}%`, 8));
  if (topModels && topModels.length) {
    lines.push(
      topModels
        .slice(0, 3)
        .map((m) => `${m.model} $${fmtCost(m.cost)}`)
        .join('  ')
    );
  }
  const triggerLabel = TRIGGER === 'button' ? '手动' : '自动';
  const refreshTime = refreshedAt instanceof Date ? refreshedAt : new Date();
  if (TIME_ZONE_ERROR) {
    lines.push(
      `${refreshTime.toLocaleTimeString()} (设备本地) · ${TIME_ZONE_ERROR}，已回退本地日界 · ${triggerLabel}刷新`
    );
  } else {
    lines.push(
      `${formatRefreshTime(refreshTime, TIME_ZONE)} (${TIME_ZONE}) · ${triggerLabel}刷新`
    );
  }
  $done({
    title: 'CPA 今日用量',
    subtitle: getTitle(today),
    content: lines.join('\n'),
    icon: ICON,
    'icon-color': '#34C759'
  });
}

function requestSummary() {
  if (TRIGGER === 'button') {
    // 点击刷新按钮时清掉缓存提示：Surge 在刷新中会保留上一次结果，这里主动给出即时反馈
    $notification.post('CPA 今日用量', '正在手动刷新…', '');
  }
  const requestedAt = new Date();
  const qs = buildSummaryQuery(TIME_ZONE, requestedAt);

  const req = {
    url: `${BASE}/v0/management/dashboard/summary?${qs}`,
    headers: ADMIN_KEY ? { Authorization: `Bearer ${ADMIN_KEY}` } : {}
  };

  $httpClient.get(req, (error, response, body) => {
    if (error) {
      $done({
        title: 'CPA 今日用量',
        content: withTimeZoneWarning(`请求失败: ${error}`),
        icon: ICON,
        'icon-color': '#FF3B30'
      });
      return;
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch (e) {
      $done({
        title: 'CPA 今日用量',
        content: withTimeZoneWarning(
          `响应解析失败 (HTTP ${response ? response.status : '?'})`
        ),
        icon: ICON,
        'icon-color': '#FF9500'
      });
      return;
    }
    const today = data && data.today;
    if (!today) {
      $done({
        title: 'CPA 今日用量',
        content: withTimeZoneWarning(
          '服务响应中缺少今日数据, 请确认地址指向 CPA Manager Plus。'
        ),
        icon: ICON,
        'icon-color': '#FF9500'
      });
      return;
    }
    render(today, data.top_models_today || [], requestedAt);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildSummaryQuery,
    formatRefreshTime,
    getCalendarDate,
    todayStartMs,
    zonedStartOfDayToEpoch
  };
} else {
  requestSummary();
}
