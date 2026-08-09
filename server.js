/**
 * 跟着肯尼学英语 · AI 工作台 —— 云端代理 + 静态服务器
 *
 * 两种调用模式（前端在请求体里二选一）：
 *   1) 服务器侧密钥模式（推荐，可公开分享）：
 *        { provider, model, system?, messages, temperature? }
 *        Key 由服务器从环境变量读取，浏览器不接触 Key。
 *   2) 浏览器密钥模式（本地代理兼容旧用法）：
 *        { endpoint, apiKey, model, messages, temperature? }
 *        浏览器把 Key 发过来，服务器只负责转发（解决 CORS）。
 *
 * 启动： node server.js   （端口取 process.env.PORT，否则 8080）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

// provider id -> { endpoint, keyEnv, native? }
// 部署时在平台环境变量里设置对应的 keyEnv（如 SENSENOVA_TOKEN_KEY）
const PROVIDER_CONFIG = {
  'sensenova':        { endpoint: 'https://api.sensenova.cn/compatible-mode/v2',  keyEnv: 'SENSENOVA_KEY' },
  'sensenova-token':  { endpoint: 'https://token.sensenova.cn/v1',                keyEnv: 'SENSENOVA_TOKEN_KEY' },
  'deepseek':         { endpoint: 'https://api.deepseek.com/v1',                  keyEnv: 'DEEPSEEK_KEY' },
  'openai':           { endpoint: 'https://api.openai.com/v1',                    keyEnv: 'OPENAI_KEY' },
  'moonshot':         { endpoint: 'https://api.moonshot.cn/v1',                   keyEnv: 'MOONSHOT_KEY' },
  'qwen':             { endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyEnv: 'QWEN_KEY' },
  'glm':              { endpoint: 'https://open.bigmodel.cn/api/paas/v4',         keyEnv: 'GLM_KEY' },
  'openrouter':       { endpoint: 'https://openrouter.ai/api/v1',                 keyEnv: 'OPENROUTER_KEY' },
  'gemini':           { endpoint: 'https://generativelanguage.googleapis.com/v1beta/models', keyEnv: 'GEMINI_KEY', native: true },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// —— 工具方法论（机密，仅存于服务端，不进前端）——
// 由 extract_prompts.js 从 index.html 抽取生成；前端 index.html 已删除这些 prompt 字段。
const TOOL_PROMPTS = require('./tool_prompts.json');

// 分类 id -> 中文名（非机密，构造 system prompt 时用）
const CATEGORY_NAMES = {
  all: '全部', prep: '课前备课', reading: '阅读教学', writing: '写作教学',
  vocab: '词汇语法', classroom: '课堂互动', exercise: '课后练习', polishing: '磨课评课',
  assessment: '测评命题', review: '试卷讲评', student: '学情学法', research: '教研成长',
  selfstudy: '自主学习',
};

// 工作台访问令牌：部署时务必设置环境变量 WORKBENCH_TOKEN 为私密值；
// 本地未设置时回落为 'local-dev'（仅本地开发用，便于免配置运行）。
const ACCESS_TOKEN = process.env.WORKBENCH_TOKEN || 'local-dev';

// —— 轻量访问统计（服务端汇总，持久化到 stats.json）——
// 注意：Render 免费档磁盘为临时盘，重新部署会回退到 git 中的基线值；
// 在同一次部署存活期内（含休眠唤醒）计数准确。适合查看“大概浏览量”。
const STATS_FILE = path.join(ROOT, 'stats.json');
let stats = { total: 0, today: 0, date: new Date().toISOString().slice(0, 10) };
try {
  const s = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  if (s && typeof s.total === 'number') stats = s;
} catch {}
function todayStr() { return new Date().toISOString().slice(0, 10); }
let lastStatsSave = 0;
function saveStats() {
  const now = Date.now();
  if (now - lastStatsSave < 5000) return; // 5s 节流，避免频繁 IO
  lastStatsSave = now;
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(stats)); } catch {}
}
function bumpStats() {
  const t = todayStr();
  if (stats.date !== t) { stats.date = t; stats.today = 0; }
  stats.total += 1;
  stats.today += 1;
  saveStats();
  return { total: stats.total, today: stats.today, date: stats.date };
}

function sendError(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: msg } }));
}

async function handleChat(req, res) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let cfg;
  try { cfg = JSON.parse(raw); } catch { return sendError(res, 400, '请求体不是合法 JSON'); }

  const { endpoint, apiKey, provider, model, system, messages, temperature, max_tokens } = cfg;
  if (!model || !Array.isArray(messages)) {
    return sendError(res, 400, '缺少 model / messages 参数');
  }

  let ep, key, native = false;
  if (provider && PROVIDER_CONFIG[provider]) {
    // —— 服务器侧密钥模式 ——
    const pc = PROVIDER_CONFIG[provider];
    ep = pc.endpoint;
    key = process.env[pc.keyEnv];
    native = !!pc.native;
    if (!key) {
      return sendError(res, 400, '服务器未配置该提供商的密钥，请在部署平台设置环境变量 ' + pc.keyEnv);
    }
  } else if (endpoint && apiKey) {
    // —— 浏览器密钥模式（本地代理）——
    ep = endpoint;
    key = apiKey;
    if (ep.includes('generativelanguage.googleapis.com')) native = true;
  } else {
    return sendError(res, 400, '缺少鉴权参数：请提供 provider（云端安全模式）或 endpoint + apiKey（本地代理模式）');
  }

  const temp = (typeof temperature === 'number') ? temperature : 0.7;
  const maxTok = max_tokens || 8192;

  try {
    if (native) {
      const url = (provider === 'gemini' ? ep + '/' + model : ep.replace(/\/+$/, '') + '/' + model)
        + ':generateContent?key=' + encodeURIComponent(key);
      const contents = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const body = { contents, generationConfig: { temperature: temp, maxOutputTokens: maxTok } };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await upstream.json().catch(() => ({}));
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text && data.error) return sendError(res, upstream.status || 502, data.error.message || JSON.stringify(data.error));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ content: text || '(模型返回了空内容)' }));
    }

    // OpenAI 兼容格式
    const upstream = await fetch(ep.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model, messages,
        temperature: temp,
        max_tokens: maxTok,
        max_completion_tokens: maxTok,
        stream: false,
      }),
    });
    const data = await upstream.json().catch(() => ({}));
    const text = data.choices?.[0]?.message?.content || '';
    if (!text && data.error) return sendError(res, upstream.status || 502, data.error.message || JSON.stringify(data.error).slice(0, 300));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content: text || '(模型返回了空内容)' }));
  } catch (e) {
    return sendError(res, 502, '代理转发失败：' + e.message);
  }
}

// ===== 工具提示词构建接口（受令牌保护）=====
// 前端只持有 UI 元数据（名称/简介/标签/分类），真实方法论 prompt 仅在服务端。
// 这样复制走 index.html 的人拿不到任何工具方法论，且未持令牌无法调用本接口。
function buildSystemPrompt(meta, promptText) {
  const catName = CATEGORY_NAMES[meta && meta.cat] || (meta && meta.cat) || '英语教学';
  let sp = '你是一位资深英语教学专家，擅长"' + catName + '"领域的教学设计与研究。\n\n' +
    '现在需要使用"' + (meta.name || '该') + '"工具来完成教学任务。\n\n' +
    '【工具说明】\n' + (meta.desc || '') + '\n\n' +
    '【方法论关键词】\n' + (meta.tags || '') + '\n\n';
  if (promptText) sp += '【详细方法论与输出框架】\n' + promptText + '\n\n';
  sp += '【输出要求】\n' +
    '1. 严格遵循该工具的方法论框架进行输出\n' +
    '2. 输出内容必须结构化、专业、可直接用于教学实践\n' +
    '3. 使用 Markdown 格式，包含标题、表格、列表等元素\n' +
    '4. 中文输出（除非涉及英语教学内容本身）\n' +
    '5. 如果输入内容不够完整，请基于教学常识合理补充';
  return sp;
}

async function handleBuild(req, res) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body;
  try { body = JSON.parse(raw); } catch { return sendError(res, 400, '请求体不是合法 JSON'); }

  const { token, toolId, meta } = body || {};
  if (token !== ACCESS_TOKEN) {
    return sendError(res, 401, '访问令牌无效：工具运行需要连接工作台后端并在设置中配置正确令牌');
  }
  if (!toolId || !meta) {
    return sendError(res, 400, '缺少 toolId / meta 参数');
  }

  // 即便该工具没有服务端 prompt（纯公开描述型），也统一在此组装，保证路径一致
  const promptText = TOOL_PROMPTS[toolId] || '';
  const systemPrompt = buildSystemPrompt(meta, promptText);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ systemPrompt }));
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const pathname = req.url.split('?')[0];

  if (req.method === 'POST' && pathname === '/api/chat') {
    return handleChat(req, res);
  }

  if (req.method === 'POST' && pathname === '/api/build') {
    return handleBuild(req, res);
  }

  if (req.method === 'GET' && pathname === '/api/providers') {
    const list = Object.entries(PROVIDER_CONFIG).map(([id, pc]) => ({
      id, endpoint: pc.endpoint, configured: !!process.env[pc.keyEnv],
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ providers: list }));
  }

  // —— 轻量访问统计接口 ——
  if (req.method === 'POST' && pathname === '/api/track') {
    const r = bumpStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(r));
  }
  if (req.method === 'GET' && pathname === '/api/stats') {
    if (stats.date !== todayStr()) { stats.date = todayStr(); stats.today = 0; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ total: stats.total, today: stats.today, date: stats.date }));
  }

  // 静态文件
  let urlPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('✅ AI 教学工作台已启动');
  console.log('   本地访问： http://localhost:' + PORT + '/index.html');
  console.log('   代理接口： http://localhost:' + PORT + '/api/chat');
  const configured = Object.entries(PROVIDER_CONFIG).filter(([, pc]) => process.env[pc.keyEnv]).map(([id]) => id);
  console.log('   已配置密钥的提供商： ' + (configured.length ? configured.join(', ') : '（无，浏览器密钥模式可用）'));
});
