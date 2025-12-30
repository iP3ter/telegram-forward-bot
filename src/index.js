/**
 * Telegram 消息转发 Bot - 完整版
 * 功能：
 * 1. 验证码验证 (按钮/数学/文本)
 * 2. 消息双向转发 (用户->管理员，管理员回复->用户)
 * 3. 管理指令 (支持回复消息操作：/block, /unblock, /check)
 * 4. 自动菜单配置
 * 5. GitHub Secrets 配置支持
 */

// ==================== 配置加载 ====================
function loadConfig(env) {
  return {
    botToken: env.BOT_TOKEN,
    adminIds: (env.ADMIN_ID || '').split(',').map(id => id.trim()).filter(Boolean),
    botUsername: env.BOT_USERNAME || '',
    
    captcha: {
      enabled: env.CAPTCHA_ENABLED !== 'false',
      type: env.CAPTCHA_TYPE || 'button',
      timeout: parseInt(env.CAPTCHA_TIMEOUT) || 300,
      maxAttempts: parseInt(env.MAX_CAPTCHA_ATTEMPTS) || 3,
    },
    
    messages: {
      welcome: env.WELCOME_MESSAGE || '👋 欢迎！为防止滥用，请先完成验证。',
      verifySuccess: env.VERIFY_SUCCESS_MESSAGE || '✅ 验证成功！现在您可以发送消息了，我会将消息转发给管理员。',
      messageSent: env.MESSAGE_SENT_CONFIRM || '✅ 消息已发送，请等待回复。',
      banned: env.BANNED_MESSAGE || '⚠️ 您已被封禁，无法发送消息。',
      captchaExpired: env.CAPTCHA_EXPIRED_MESSAGE || '⏰ 验证码已过期，请发送任意消息重新获取。',
      rateLimited: env.RATE_LIMITED_MESSAGE || '⚠️ 发送过于频繁，请稍后再试。',
    },
    
    features: {
      showUserInfo: env.SHOW_USER_INFO !== 'false',
      sendConfirm: env.SEND_CONFIRM !== 'false',
    },
    
    rateLimit: {
      enabled: env.RATE_LIMIT_ENABLED !== 'false',
      perMinute: parseInt(env.RATE_LIMIT_PER_MINUTE) || 10,
    },
    
    mappingDays: parseInt(env.MESSAGE_MAPPING_DAYS) || 30,
    
    STATUS: { PENDING: 'pending_captcha', VERIFIED: 'verified', BANNED: 'banned' }
  };
}

// ==================== 验证码组件 ====================
const Captcha = {
  button: () => {
    const emojis = ['🍎','🍊','🍋','🍇','🍓','🍑','🍒','🥝','🍌','🍉','🥭','🍍'];
    const shuffled = [...emojis].sort(() => Math.random() - 0.5).slice(0, 6);
    const correct = shuffled[Math.floor(Math.random() * 6)];
    return {
      type: 'button',
      question: `请点击: ${correct}`,
      answer: correct,
      keyboard: {
        inline_keyboard: [
          shuffled.slice(0, 3).map(e => ({ text: e, callback_data: `cap_${e}` })),
          shuffled.slice(3, 6).map(e => ({ text: e, callback_data: `cap_${e}` }))
        ]
      }
    };
  },
  math: () => {
    const ops = [['+', (a,b) => a+b], ['-', (a,b) => a-b], ['×', (a,b) => a*b]];
    const [s, f] = ops[Math.floor(Math.random() * 3)];
    const a = Math.floor(Math.random() * (s === '×' ? 10 : 50)) + 1;
    const b = Math.floor(Math.random() * (s === '×' ? 10 : 20)) + 1;
    return { type: 'math', question: `计算: ${a} ${s} ${b} = ?`, answer: f(a, b).toString() };
  },
  text: () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return { type: 'text', question: `输入验证码: <code>${code}</code>`, answer: code };
  },
  slider: () => {
    const pos = Math.floor(Math.random() * 5);
    return {
      type: 'slider',
      question: '点击 🎯',
      answer: pos.toString(),
      keyboard: {
        inline_keyboard: [Array(5).fill(0).map((_, i) => ({
          text: i === pos ? '🎯' : '⬜',
          callback_data: `cap_${i}`
        }))]
      }
    };
  }
};

// ==================== API 基础函数 ====================
const api = (cfg, method, data) => fetch(
  `https://api.telegram.org/bot${cfg.botToken}/${method}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
).then(r => r.json());

const send = (c, id, text, opt = {}) => api(c, 'sendMessage', { chat_id: id, text, parse_mode: 'HTML', ...opt });
const edit = (c, id, mid, text, opt = {}) => api(c, 'editMessageText', { chat_id: id, message_id: mid, text, parse_mode: 'HTML', ...opt });
const answer = (c, id, text, alert = false) => api(c, 'answerCallbackQuery', { callback_query_id: id, text, show_alert: alert });
const forward = (c, to, from, mid) => api(c, 'forwardMessage', { chat_id: to, from_chat_id: from, message_id: mid });
const copy = (c, to, from, mid) => api(c, 'copyMessage', { chat_id: to, from_chat_id: from, message_id: mid });

// ==================== 存储类 ====================
class Store {
  constructor(kv) { this.kv = kv; }
  getUser(id) { return this.kv.get(`u:${id}`, 'json'); }
  saveUser(id, d) { return this.kv.put(`u:${id}`, JSON.stringify(d)); }
  saveMap(amid, ucid, umid, days) { return this.kv.put(`m:${amid}`, JSON.stringify({ ucid, umid }), { expirationTtl: 86400 * days }); }
  getMap(amid) { return this.kv.get(`m:${amid}`, 'json'); }
  async checkRate(id, limit) {
    const k = `r:${id}`, now = Date.now();
    const d = await this.kv.get(k, 'json') || { c: 0, t: 0 };
    if (now > d.t) { d.c = 0; d.t = now + 60000; }
    if (d.c >= limit) return false;
    d.c++;
    await this.kv.put(k, JSON.stringify(d), { expirationTtl: 60 });
    return true;
  }
}

// ==================== Bot 逻辑核心 ====================
class Bot {
  constructor(env) {
    this.cfg = loadConfig(env);
    this.store = new Store(env.BOT_KV);
  }
  
  isAdmin(id) { return this.cfg.adminIds.includes(id.toString()); }
  genCaptcha() { return (Captcha[this.cfg.captcha.type] || Captcha.button)(); }
  
  async sendCaptcha(cid, user) {
    const cap = this.genCaptcha();
    user.status = this.cfg.STATUS.PENDING;
    user.cap = { ans: cap.answer, type: cap.type, at: Date.now(), try: 0 };
    await this.store.saveUser(cid, user);
    
    // 直接获取秒数，不再除以 60
    const seconds = this.cfg.captcha.timeout;
    
    // 从 "分钟" 改为 "秒"
    await send(this.cfg, cid, `🔐 <b>验证</b>\n\n${this.cfg.messages.welcome}\n\n${cap.question}\n\n⏰ ${seconds}秒 | ❌ ${this.cfg.captcha.maxAttempts}次`, { reply_markup: cap.keyboard });
  }
  
  async verify(cid, ans, user) {
    const cap = user.cap;
    if (Date.now() - cap.at > this.cfg.captcha.timeout * 1000) {
      user.cap = null; await this.store.saveUser(cid, user);
      await send(this.cfg, cid, this.cfg.messages.captchaExpired);
      return { ok: false, expired: true };
    }
    if (ans.toString().toUpperCase() === cap.ans.toString().toUpperCase()) {
      user.status = this.cfg.STATUS.VERIFIED; user.cap = null; user.verifiedAt = Date.now();
      await this.store.saveUser(cid, user);
      await send(this.cfg, cid, this.cfg.messages.verifySuccess);
      return { ok: true };
    }
    cap.try++;
    if (cap.try >= this.cfg.captcha.maxAttempts) {
      user.status = this.cfg.STATUS.BANNED; user.cap = null; user.bannedAt = Date.now();
      await this.store.saveUser(cid, user);
      await send(this.cfg, cid, '❌ 验证失败次数过多，已封禁');
      return { ok: false, banned: true };
    }
    await this.store.saveUser(cid, user);
    return { ok: false, left: this.cfg.captcha.maxAttempts - cap.try };
  }
  
  async onCallback(cb) {
    const cid = cb.from.id, data = cb.data, mid = cb.message?.message_id;
    if (data.startsWith('cap_')) {
      const user = await this.store.getUser(cid);
      if (!user || user.status !== this.cfg.STATUS.PENDING) return answer(this.cfg, cb.id, '已过期', true);
      const res = await this.verify(cid, data.slice(4), user);
      if (res.ok) { await edit(this.cfg, cid, mid, this.cfg.messages.verifySuccess); return answer(this.cfg, cb.id, '✅ 成功'); }
      if (res.banned) await edit(this.cfg, cid, mid, '❌ 已封禁');
      else if (res.left) return answer(this.cfg, cb.id, `❌ 剩余${res.left}次`, true);
      return;
    }
    if (data.startsWith('a_') && this.isAdmin(cid)) {
      const [, act, tid] = data.split('_');
      const t = await this.store.getUser(tid) || { cid: tid };
      if (act === 'b') {
        t.status = this.cfg.STATUS.BANNED; t.bannedAt = Date.now(); await this.store.saveUser(tid, t);
        await send(this.cfg, tid, this.cfg.messages.banned); return answer(this.cfg, cb.id, '✅ 已封禁', true);
      }
      if (act === 'u') {
        t.status = this.cfg.STATUS.VERIFIED; await this.store.saveUser(tid, t);
        await send(this.cfg, tid, '✅ 已解封'); return answer(this.cfg, cb.id, '✅ 已解封', true);
      }
    }
  }
  
  async onUserMsg(msg) {
    const cid = msg.chat.id;
    let user = await this.store.getUser(cid);
    if (!user) {
      user = { cid, odId: msg.from.id, un: msg.from.username, fn: msg.from.first_name, ln: msg.from.last_name, at: Date.now() };
      if (this.cfg.captcha.enabled) return this.sendCaptcha(cid, user);
      user.status = this.cfg.STATUS.VERIFIED;
    }
    user.un = msg.from.username; user.fn = msg.from.first_name; user.lastAt = Date.now();
    
    switch (user.status) {
      case this.cfg.STATUS.BANNED: return send(this.cfg, cid, this.cfg.messages.banned);
      case this.cfg.STATUS.PENDING:
        if (msg.text && !['button', 'slider'].includes(user.cap?.type)) return this.verify(cid, msg.text, user);
        return send(this.cfg, cid, '请先完成验证');
      case this.cfg.STATUS.VERIFIED:
        if (this.cfg.rateLimit.enabled && !await this.store.checkRate(cid, this.cfg.rateLimit.perMinute)) return send(this.cfg, cid, this.cfg.messages.rateLimited);
        if (msg.text && msg.text.startsWith('/')) {
            // 如果用户发 /start，提示他已经可以发消息了
            if (msg.text === '/start') {
                return send(this.cfg, cid, '✅ 您已验证成功，直接发送消息即可，无需再次开始。');
            }
            // 如果是其他指令（比如 /help），返回一个提示
            return send(this.cfg, cid, '⚠️ 本机器人仅用于消息转发，不支持指令。'); 
            return; // 直接退出，不执行下面的 forwardToAdmin
        }
        await this.forwardToAdmin(msg, user);
        break;
      default: if (this.cfg.captcha.enabled) return this.sendCaptcha(cid, user);
    }
    await this.store.saveUser(cid, user);
  }
  
  async forwardToAdmin(msg, user) {
    const cid = msg.chat.id;
    for (const aid of this.cfg.adminIds) {
      if (this.cfg.features.showUserInfo) {
        const info = `👤 <b>新消息</b>\nID: <code>${cid}</code>\n用户: ${user.un ? '@'+user.un : '无'}\n姓名: ${user.fn || ''} ${user.ln || ''}`;
        const kb = { inline_keyboard: [[{ text: '🚫 封禁', callback_data: `a_b_${cid}` }, { text: '✅ 解封', callback_data: `a_u_${cid}` }]]};
        await send(this.cfg, aid, info, { reply_markup: kb });
      }
      const res = await forward(this.cfg, aid, cid, msg.message_id);
      if (res.ok) await this.store.saveMap(res.result.message_id, cid, msg.message_id, this.cfg.mappingDays);
    }
    if (this.cfg.features.sendConfirm) await send(this.cfg, cid, this.cfg.messages.messageSent);
  }

  async getTargetId(msg, arg) {
    if (msg.reply_to_message) {
      const map = await this.store.getMap(msg.reply_to_message.message_id);
      if (map) return map.ucid;
      const match = (msg.reply_to_message.text || '').match(/ID: (\d+)/);
      if (match) return match[1];
    }
    return arg || null;
  }

  async onAdminMsg(msg) {
    const cid = msg.chat.id, text = msg.text || '';
    if (text.startsWith('/')) {
      const [cmd, arg] = text.split(' ');
      if (['/start', '/help', '/menu'].includes(cmd)) {
        return send(this.cfg, cid, `
🤖 <b>管理员控制台</b>

<b>回复转发的消息使用：</b>
<code>/block</code> - 封禁该用户
<code>/unblock</code> - 解封该用户
<code>/check</code> - 查看用户状态和信息

<b>直接使用：</b>
<code>/block [ID]</code> - 封禁指定 ID
<code>/unblock [ID]</code> - 解封指定 ID
<code>/check [ID]</code> - 查询指定 ID
<code>/config</code> - 查看当前配置
        `.trim());
      }
      if (cmd === '/block' || cmd === '/ban') {
        const tid = await this.getTargetId(msg, arg);
        if (!tid) return send(this.cfg, cid, '⚠️ 请回复消息或输入ID');
        const t = await this.store.getUser(tid) || { cid: tid }; t.status = this.cfg.STATUS.BANNED; t.bannedAt = Date.now(); await this.store.saveUser(tid, t);
        await send(this.cfg, tid, this.cfg.messages.banned); return send(this.cfg, cid, `🚫 用户 <code>${tid}</code> 已封禁`);
      }
      if (cmd === '/unblock' || cmd === '/unban') {
        const tid = await this.getTargetId(msg, arg);
        if (!tid) return send(this.cfg, cid, '⚠️ 请回复消息或输入ID');
        const t = await this.store.getUser(tid) || { cid: tid }; t.status = this.cfg.STATUS.VERIFIED; await this.store.saveUser(tid, t);
        await send(this.cfg, tid, '✅ 您已被解封'); return send(this.cfg, cid, `✅ 用户 <code>${tid}</code> 已解封`);
      }
      if (cmd === '/check' || cmd === '/checkblock') {
        const tid = await this.getTargetId(msg, arg);
        if (!tid) return send(this.cfg, cid, '⚠️ 请回复消息或输入ID');
        const t = await this.store.getUser(tid);
        if (!t) return send(this.cfg, cid, '❓ 无记录');
        const st = { [this.cfg.STATUS.VERIFIED]:'✅ 正常', [this.cfg.STATUS.BANNED]:'🚫 封禁', [this.cfg.STATUS.PENDING]:'⏳ 待验' };
        return send(this.cfg, cid, `🔍 <b>资料</b>\nID: <code>${tid}</code>\n状态: ${st[t.status]||'未知'}\n用户: ${t.un?'@'+t.un:'无'}\n时间: ${new Date(t.lastAt||t.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}`);
      }
      if (cmd === '/config') return send(this.cfg, cid, `⚙️ 配置\n验证码: ${this.cfg.captcha.enabled?'✅':'❌'}\n超时: ${this.cfg.captcha.timeout}s`);
    }
    if (msg.reply_to_message) {
      const map = await this.store.getMap(msg.reply_to_message.message_id);
      if (map) { const r = await copy(this.cfg, map.ucid, cid, msg.message_id); await send(this.cfg, cid, r.ok ? '✅ 已回复' : '❌ 失败'); } 
      else if (msg.reply_to_message.from.id !== msg.from.id) await send(this.cfg, cid, '⚠️ 消息已过期');
    }
  }
  
  async handle(update) {
    try {
      if (update.callback_query) return this.onCallback(update.callback_query);
      const msg = update.message || update.edited_message;
      if (!msg || msg.chat.type !== 'private') return;
      return this.isAdmin(msg.chat.id) ? this.onAdminMsg(msg) : this.onUserMsg(msg);
    } catch (e) { console.error(e); }
  }
}

// ==================== Worker 安全入口 ====================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cfg = loadConfig(env);
    
    // 1. Webhook 核心接收 (只接受 POST)
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json();
        const ctx = { waitUntil: (p) => p }; 
        await new Bot(env).handle(update);
        return new Response('OK', { status: 200 });
      } catch (e) {
        return new Response('Error', { status: 500 });
      }
    }

    // 2. 初始化设置 (仅此一个管理接口)
    if (url.pathname === '/setup') {
       const webhookUrl = `https://${url.hostname}/webhook`;
      
      // 设置 Webhook
      const r1 = await api(cfg, 'setWebhook', {
        url: webhookUrl,
        allowed_updates: ['message', 'edited_message', 'callback_query']
      });

      // 设置管理员指令菜单
      const r2 = await api(cfg, 'setMyCommands', {
        commands: [
          { command: 'help', description: '📜 打开控制面板' },
          { command: 'check', description: '🔍 查询 (回复消息)' },
          { command: 'block', description: '🚫 封禁 (回复消息)' },
          { command: 'unblock', description: '✅ 解封 (回复消息)' },
          { command: 'config', description: '⚙️ 查看配置' }
        ]
      });

      return new Response(JSON.stringify({ webhook: r1, commands: r2 }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 3. 所有其他路径 -> 404 (无网页 UI)
    return new Response('Not Found', { status: 404 });
  }
};
