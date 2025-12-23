/**
 * Telegram 消息转发 Bot - GitHub Secrets 配置版
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
      welcome: env.WELCOME_MESSAGE || '👋 欢迎！请先完成验证。',
      verifySuccess: env.VERIFY_SUCCESS_MESSAGE || '✅ 验证成功！',
      messageSent: env.MESSAGE_SENT_CONFIRM || '✅ 消息已发送。',
      banned: env.BANNED_MESSAGE || '⚠️ 您已被封禁。',
      captchaExpired: env.CAPTCHA_EXPIRED_MESSAGE || '⏰ 验证码已过期。',
      rateLimited: env.RATE_LIMITED_MESSAGE || '⚠️ 请求过于频繁。',
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
    
    STATUS: {
      PENDING: 'pending_captcha',
      VERIFIED: 'verified',
      BANNED: 'banned'
    }
  };
}

// ==================== 验证码生成 ====================

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

// ==================== API 函数 ====================

const api = (cfg, method, data) => fetch(
  `https://api.telegram.org/bot${cfg.botToken}/${method}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
).then(r => r.json());

const send = (c, id, text, opt = {}) => api(c, 'sendMessage', { chat_id: id, text, parse_mode: 'HTML', ...opt });
const edit = (c, id, mid, text, opt = {}) => api(c, 'editMessageText', { chat_id: id, message_id: mid, text, parse_mode: 'HTML', ...opt });
const answer = (c, id, text, alert = false) => api(c, 'answerCallbackQuery', { callback_query_id: id, text, show_alert: alert });
const forward = (c, to, from, mid) => api(c, 'forwardMessage', { chat_id: to, from_chat_id: from, message_id: mid });
const copy = (c, to, from, mid) => api(c, 'copyMessage', { chat_id: to, from_chat_id: from, message_id: mid });

// ==================== 存储 ====================

class Store {
  constructor(kv) { this.kv = kv; }
  
  getUser(id) { return this.kv.get(`u:${id}`, 'json'); }
  saveUser(id, d) { return this.kv.put(`u:${id}`, JSON.stringify(d)); }
  
  saveMap(amid, ucid, umid, days) {
    return this.kv.put(`m:${amid}`, JSON.stringify({ ucid, umid }), { expirationTtl: 86400 * days });
  }
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

// ==================== Bot 类 ====================

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
    
    const t = Math.floor(this.cfg.captcha.timeout / 60);
    await send(this.cfg, cid, 
      `🔐 <b>验证</b>\n\n${this.cfg.messages.welcome}\n\n${cap.question}\n\n⏰ ${t}分钟 | ❌ ${this.cfg.captcha.maxAttempts}次`,
      { reply_markup: cap.keyboard }
    );
  }
  
  async verify(cid, ans, user) {
    const cap = user.cap;
    
    if (Date.now() - cap.at > this.cfg.captcha.timeout * 1000) {
      user.cap = null;
      await this.store.saveUser(cid, user);
      await send(this.cfg, cid, this.cfg.messages.captchaExpired);
      return { ok: false, expired: true };
    }
    
    if (ans.toString().toUpperCase() === cap.ans.toString().toUpperCase()) {
      user.status = this.cfg.STATUS.VERIFIED;
      user.cap = null;
      user.verifiedAt = Date.now();
      await this.store.saveUser(cid, user);
      await send(this.cfg, cid, this.cfg.messages.verifySuccess);
      return { ok: true };
    }
    
    cap.try++;
    if (cap.try >= this.cfg.captcha.maxAttempts) {
      user.status = this.cfg.STATUS.BANNED;
      user.cap = null;
      user.bannedAt = Date.now();
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
      if (!user || user.status !== this.cfg.STATUS.PENDING)
        return answer(this.cfg, cb.id, '已过期', true);
      
      const res = await this.verify(cid, data.slice(4), user);
      if (res.ok) {
        await edit(this.cfg, cid, mid, this.cfg.messages.verifySuccess);
        return answer(this.cfg, cb.id, '✅ 成功');
      }
      if (res.banned) await edit(this.cfg, cid, mid, '❌ 已封禁');
      else if (res.left) return answer(this.cfg, cb.id, `❌ 剩余${res.left}次`, true);
      return;
    }
    
    if (data.startsWith('a_') && this.isAdmin(cid)) {
      const [, act, tid] = data.split('_');
      const t = await this.store.getUser(tid) || { cid: tid };
      
      if (act === 'b') {
        t.status = this.cfg.STATUS.BANNED;
        t.bannedAt = Date.now();
        await this.store.saveUser(tid, t);
        await send(this.cfg, tid, this.cfg.messages.banned);
        return answer(this.cfg, cb.id, '✅ 已封禁', true);
      }
      if (act === 'u') {
        t.status = this.cfg.STATUS.VERIFIED;
        await this.store.saveUser(tid, t);
        await send(this.cfg, tid, '✅ 已解封');
        return answer(this.cfg, cb.id, '✅ 已解封', true);
      }
    }
  }
  
  async onUserMsg(msg) {
    const cid = msg.chat.id;
    let user = await this.store.getUser(cid);
    
    if (!user) {
      user = {
        cid, odId: msg.from.id, un: msg.from.username,
        fn: msg.from.first_name, ln: msg.from.last_name, at: Date.now()
      };
      if (this.cfg.captcha.enabled) return this.sendCaptcha(cid, user);
      user.status = this.cfg.STATUS.VERIFIED;
    }
    
    user.un = msg.from.username;
    user.fn = msg.from.first_name;
    user.lastAt = Date.now();
    
    switch (user.status) {
      case this.cfg.STATUS.BANNED:
        return send(this.cfg, cid, this.cfg.messages.banned);
        
      case this.cfg.STATUS.PENDING:
        if (msg.text && !['button', 'slider'].includes(user.cap?.type))
          return this.verify(cid, msg.text, user);
        return send(this.cfg, cid, '请先完成验证');
        
      case this.cfg.STATUS.VERIFIED:
        if (this.cfg.rateLimit.enabled && !await this.store.checkRate(cid, this.cfg.rateLimit.perMinute))
          return send(this.cfg, cid, this.cfg.messages.rateLimited);
        await this.forwardToAdmin(msg, user);
        break;
        
      default:
        if (this.cfg.captcha.enabled) return this.sendCaptcha(cid, user);
    }
    
    await this.store.saveUser(cid, user);
  }
  
  async forwardToAdmin(msg, user) {
    const cid = msg.chat.id;
    
    for (const aid of this.cfg.adminIds) {
      if (this.cfg.features.showUserInfo) {
        const info = `👤 <b>用户</b>\nID: <code>${cid}</code>\n用户名: ${user.un ? '@'+user.un : '无'}\n姓名: ${user.fn || ''} ${user.ln || ''}`;
        const kb = { inline_keyboard: [[
          { text: '🚫 封禁', callback_data: `a_b_${cid}` },
          { text: '✅ 解封', callback_data: `a_u_${cid}` }
        ]]};
        await send(this.cfg, aid, info, { reply_markup: kb });
      }
      
      const res = await forward(this.cfg, aid, cid, msg.message_id);
      if (res.ok) await this.store.saveMap(res.result.message_id, cid, msg.message_id, this.cfg.mappingDays);
    }
    
    if (this.cfg.features.sendConfirm) await send(this.cfg, cid, this.cfg.messages.messageSent);
  }
  
  async onAdminMsg(msg) {
    const cid = msg.chat.id, text = msg.text || '';
    
    if (text.startsWith('/')) {
      const [cmd, ...args] = text.split(' ');
      const cmds = {
        '/start': `🤖 <b>管理面板</b>\n\n/ban ID - 封禁\n/unban ID - 解封\n/config - 配置\n\n回复消息即可回复用户`,
        '/config': `⚙️ 验证码: ${this.cfg.captcha.enabled?'✅':'❌'} ${this.cfg.captcha.type}\n超时: ${this.cfg.captcha.timeout}s\n尝试: ${this.cfg.captcha.maxAttempts}\n限速: ${this.cfg.rateLimit.enabled?this.cfg.rateLimit.perMinute+'/min':'❌'}`,
        '/ban': async () => {
          if (!args[0]) return '/ban [ID]';
          const t = await this.store.getUser(args[0]) || {};
          t.status = this.cfg.STATUS.BANNED;
          await this.store.saveUser(args[0], t);
          await send(this.cfg, args[0], this.cfg.messages.banned);
          return `✅ 已封禁 ${args[0]}`;
        },
        '/unban': async () => {
          if (!args[0]) return '/unban [ID]';
          const t = await this.store.getUser(args[0]) || {};
          t.status = this.cfg.STATUS.VERIFIED;
          await this.store.saveUser(args[0], t);
          await send(this.cfg, args[0], '✅ 已解封');
          return `✅ 已解封 ${args[0]}`;
        }
      };
      if (cmds[cmd]) {
        const r = typeof cmds[cmd] === 'function' ? await cmds[cmd]() : cmds[cmd];
        return send(this.cfg, cid, r);
      }
      return;
    }
    
    if (msg.reply_to_message) {
      const map = await this.store.getMap(msg.reply_to_message.message_id);
      if (map) {
        const r = await copy(this.cfg, map.ucid, cid, msg.message_id);
        await send(this.cfg, cid, r.ok ? '✅ 已发送' : '❌ 失败');
      } else {
        await send(this.cfg, cid, '⚠️ 消息已过期');
      }
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

// ==================== Worker ==================== 

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cfg = loadConfig(env);
    
    if (url.pathname === '/webhook' && request.method === 'POST') {
      await new Bot(env).handle(await request.json());
      return new Response('OK');
    }
    
    if (url.pathname === '/setup') {
      const r = await api(cfg, 'setWebhook', {
        url: `https://${url.hostname}/webhook`,
        allowed_updates: ['message', 'edited_message', 'callback_query']
      });
      return Response.json(r);
    }
    
    if (url.pathname === '/info') return Response.json(await api(cfg, 'getWebhookInfo', {}));
    if (url.pathname === '/delete') return Response.json(await api(cfg, 'deleteWebhook', {}));
    
    return new Response(`
<!DOCTYPE html><html><head><meta charset="utf-8"><title>TG Bot</title>
<style>body{font-family:system-ui;max-width:500px;margin:50px auto;padding:20px}
h1{color:#0088cc}.ok{background:#e8f5e9;padding:15px;border-radius:8px;margin:20px 0}
a{display:block;padding:10px;margin:5px 0;background:#f5f5f5;border-radius:5px;color:#0088cc;text-decoration:none}
a:hover{background:#e3f2fd}</style></head>
<body><h1>🤖 Telegram Bot</h1><div class="ok">✅ 运行中</div>
<a href="/setup">📌 设置 Webhook</a><a href="/info">ℹ️ 查看状态</a><a href="/delete">🗑️ 删除 Webhook</a>
</body></html>`, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
  }
};
