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

const BASE = ($args('url') || 'http://127.0.0.1:18317').replace(/\/+$/, '');
const ADMIN_KEY = $args('key') || '';
const ICON = $args('icon') || 'dollarsign.circle';
const TIME_ZONE = $args('tz') || 'Asia/Shanghai';
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
  if (n === 0) return '0';
  if (n < 0.000001) return '<0.000001';
  if (n < 1) return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return n.toFixed(2);
}

function todayStartMs(tz) {
  try {
    const now = new Date();
    const start = new Date(
      now.toLocaleString('en-US', { timeZone: tz })
    );
    // 用本地日历天 + 时区偏移差回推 UTC 当日零点
    const utcNow = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const offsetMs = start.getTime() - utcNow.getTime();
    start.setHours(0, 0, 0, 0);
    return start.getTime() - offsetMs;
  } catch (e) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
}

function getTitle(today) {
  const cost = fmtCost(today.total_cost);
  const tokens = fmtTokens(today.total_tokens);
  return `今日 $${cost} · ${tokens} Tokens`;
}

function render(today, topModels) {
  const lines = [];
  lines.push(`Token 总量: ${fmtInt(today.total_tokens)}`);
  lines.push(
    `输入 ${fmtTokens(today.input_tokens)} · 输出 ${fmtTokens(today.output_tokens)} · 缓存 ${fmtTokens(today.cached_tokens)}`
  );
  lines.push(`服务端估算成本: $${fmtCost(today.total_cost)}`);
  lines.push(
    `调用: ${fmtInt(today.total_calls)} 次 · 成功率: ${(today.success_rate * 100).toFixed(1)}%`
  );
  if (topModels && topModels.length) {
    lines.push('---');
    lines.push('今日主要模型:');
    topModels.slice(0, 5).forEach((m) => {
      lines.push(
        `${m.model}: ${fmtTokens(m.tokens)} tokens · $${fmtCost(m.cost)} · ${fmtInt(m.calls)} 次`
      );
    });
  }
  lines.push('---');
  const triggerLabel = TRIGGER === 'button' ? '手动' : '自动';
  lines.push(`更新时间: ${new Date().toLocaleTimeString()}（${triggerLabel}刷新）`);
  const sub = `调用 ${fmtInt(today.total_calls)} 次 · 成功率 ${(today.success_rate * 100).toFixed(1)}%`;
  $done({
    title: 'CPA 今日用量',
    subtitle: getTitle(today),
    content: lines.join('\n'),
    icon: ICON,
    'icon-color': '#34C759'
  });
  void sub;
}

function requestSummary() {
  if (TRIGGER === 'button') {
    // 点击刷新按钮时清掉缓存提示：Surge 在刷新中会保留上一次结果，这里主动给出即时反馈
    $notification.post('CPA 今日用量', '正在手动刷新…', '');
  }
  const qs = new URLSearchParams({
    today_start_ms: String(todayStartMs(TIME_ZONE)),
    now_ms: String(Date.now()),
    top_models: '5',
    recent_failures: '5'
  }).toString();

  const req = {
    url: `${BASE}/v0/management/dashboard/summary?${qs}`,
    headers: ADMIN_KEY ? { Authorization: `Bearer ${ADMIN_KEY}` } : {}
  };

  $httpClient.get(req, (error, response, body) => {
    if (error) {
      $done({
        title: 'CPA 今日用量',
        content: `请求失败: ${error}`,
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
        content: `响应解析失败 (HTTP ${response ? response.status : '?'})`,
        icon: ICON,
        'icon-color': '#FF9500'
      });
      return;
    }
    const today = data && data.today;
    if (!today) {
      $done({
        title: 'CPA 今日用量',
        content: '服务响应中缺少今日数据, 请确认地址指向 CPA Manager Plus。',
        icon: ICON,
        'icon-color': '#FF9500'
      });
      return;
    }
    render(today, data.top_models_today || []);
  });
}

requestSummary();
