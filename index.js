import 'dotenv/config';
import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import Groq from 'groq-sdk';

const execAsync = promisify(exec);

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || ''
});

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true, svc: 'telegram-bot' }));

// Serve Telegram Mini App
app.get('/webapp', (req, res) => {
  res.sendFile(path.join('/root/shltechent/telegram-bot-server', 'webapp.html'));
});

// Serve Snake Game
app.get('/snake', (req, res) => {
  res.sendFile(path.join('/root/shltechent/telegram-bot-server', 'snake.html'));
});

// Serve Tank Retro Shooting
app.get('/tank', (req, res) => {
  res.sendFile(path.join('/root/shltechent/telegram-bot-server', 'tank.html'));
});

// Serve Mario Game
app.get('/mario', (req, res) => {
  res.sendFile(path.join('/root/shltechent/telegram-bot-server', 'mario.html'));
});

// Serve Miner (tap-to-earn) Web App
app.get('/miner', (req, res) => {
  res.sendFile(path.join('/root/shltechent/telegram-bot-server', 'miner.html'));
});

// Serve Pacman wrapper (external site embed)
app.get('/pacman', (req, res) => {
  res.sendFile(path.join('/root/shltechent/telegram-bot-server', 'pacman.html'));
});

// Command definitions: edit messages/descriptions here
const COMMAND_DEFS = {
  start: {
    desc: 'Welcome message',
    text: 'Hello {name}! 👋\nWelcome to this bot SHL Tech Ent. Type /help to see commands.'
  },
  help: {
    desc: 'Show available commands'
  },
  about: {
    desc: 'About this bot',
    text: 'This is a simple Telegram bot owned by SHL.'
  },
  contact: {
    desc: 'Contact information',
    text: 'Contact SHL for inquiries.'
  },
  website: {
    desc: 'Official website',
    text: 'Visit our website: https://example.com'
  },
  support: {
    desc: 'Support channel',
    text: 'Need help? Email support@example.com'
  },
  donate: {
    desc: 'How to support us',
    text: 'Support us: https://example.com/donate'
  },
  privacy: {
    desc: 'Privacy policy',
    text: 'We do not collect personal data. Messages are processed only to reply.'
  },
  terms: {
    desc: 'Terms of use',
    text: 'Provided as-is without warranties.'
  },
  ping: {
    desc: 'Health check',
    text: 'pong'
  },
  time: {
    desc: 'Show current server time'
  },
  echo: {
    desc: 'Echo back your message (usage: /echo your text)'
  },
  watch: {
    desc: 'Watch videos (usage: /watch video_name or just /watch to list)'
  },
  chat: {
    desc: 'Chat with AI (usage: /chat your message)'
  },
  app: {
    desc: 'Open Mini App'
  },
  snake: {
    desc: 'Play Snake Game 🐍'
  },
  play_games: {
    desc: 'Play games menu'
  }
};

// Video library: Map video names to their Telegram file_id or message details
// To add videos: Post them to your channel, then get the file_id from the message
const VIDEO_LIBRARY = {
  'intro': {
    chatId: '-1003157475158',  // Your channel ID
    messageId: 8,               // Message ID from your channel
    caption: 'Introduction Video'
  },
  'tutorial': {
    chatId: '-1003157475158',
    messageId: 9,
    caption: 'Tutorial Video'
  }
  // Add more videos here as: 'name': { chatId, messageId, caption }
};

function replacePlaceholders(template, context) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(context, key) ? String(context[key]) : '';
  });
}

function parseCommandAndArgs(text) {
  const t = String(text || '').trim();
  if (!t.startsWith('/')) return null;
  const firstToken = t.split(/\s+/)[0];
  const cmdWithAt = firstToken.slice(1);
  const [cmdRaw] = cmdWithAt.split('@');
  const cmd = String(cmdRaw || '').toLowerCase();
  const args = t.slice(firstToken.length).trim();
  return { cmd, args };
}

function buildHelpMessage() {
  const lines = Object.entries(COMMAND_DEFS)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cmd, def]) => `/${cmd} - ${def.desc || ''}`)
    .join('\n');
  return `Available commands:\n${lines}`;
}

async function askChatGPT(userMessage) {
  try {
    if (!process.env.GROQ_API_KEY) {
      return 'AI is not configured. Please set GROQ_API_KEY.';
    }
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a helpful assistant in a Telegram bot.' },
        { role: 'user', content: userMessage }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 1024
    });
    return completion.choices[0]?.message?.content || 'No response from AI.';
  } catch (err) {
    console.error('[telegram-bot] Groq error:', err);
    return 'Sorry, AI is temporarily unavailable.';
  }
}

async function syncTelegramCommandsIfEnabled() {
  try {
    const shouldSync = String(process.env.TELEGRAM_SYNC_COMMANDS || '').trim();
    if (!shouldSync) return;
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    if (!token) return;
    const commands = Object.entries(COMMAND_DEFS).map(([command, def]) => ({
      command,
      description: String(def.desc || 'command').slice(0, 256)
    }));
    const url = `https://api.telegram.org/bot${token}/setMyCommands`;
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commands }) });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.ok === false) console.warn('[telegram-bot] setMyCommands failed', resp.status, json); else console.log('[telegram-bot] setMyCommands ok, commands:', commands.length);
  } catch (e) {
    console.warn('[telegram-bot] setMyCommands error', e?.message || e);
  }
}

async function sendTelegramMessage(text, chatIdOverride, options = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = chatIdOverride || process.env.TELEGRAM_DEFAULT_CHAT_ID || '';
  if (!token || !chatId) throw new Error('missing_telegram_token_or_chat_id');
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: String(text || '').slice(0, 4000),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...options
  };
  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!resp.ok) { const t = await resp.text().catch(() => String(resp.status)); throw new Error(`telegram_send_failed:${resp.status}:${t.slice(0,256)}`); }
  return await resp.json().catch(() => ({}));
}

async function forwardTelegramMessage(fromChatId, messageId, toChatId) {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!token || !toChatId) throw new Error('missing_telegram_token_or_chat_id');
  const url = `https://api.telegram.org/bot${token}/forwardMessage`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: toChatId,
      from_chat_id: fromChatId,
      message_id: messageId
    })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => String(resp.status));
    throw new Error(`telegram_forward_failed:${resp.status}:${t.slice(0, 256)}`);
  }
  return await resp.json().catch(() => ({}));
}

async function setTelegramWebhookIfConfigured() {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    const baseUrl = process.env.TELEGRAM_WEBHOOK_BASE_URL || '';
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
    if (!token || !baseUrl || !secret) return;
    const webhookUrl = `${String(baseUrl).replace(/\/$/, '')}/api/telegram/webhook/${secret}`;
    const resp = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: webhookUrl, allowed_updates: ['message'] }) });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || json.ok === false) console.warn('[telegram-bot] setWebhook failed', resp.status, json); else console.log('[telegram-bot] setWebhook ok ->', webhookUrl);
  } catch (e) { console.warn('[telegram-bot] setWebhook error', e?.message || e); }
}

app.post('/api/telegram/webhook/:secret', async (req, res) => {
  try {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET || '';
    if (!expected || req.params.secret !== expected) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const update = req.body || {};

    // 1) Handle inline keyboard callbacks for games
    if (update.callback_query && update.callback_query.data) {
      const cq = update.callback_query;
      const chatId = (cq.message && cq.message.chat) ? cq.message.chat.id : null;
      const data = String(cq.data || '');
      if (chatId) {
        if (data === 'game_tank') {
          await sendTelegramMessage('Launching Tank Retro Shooting 🎯\nPlay here: https://tanksw.com/', chatId);
        } else if (data === 'game_mario') {
          await sendTelegramMessage('Launching Mario 🍄\nPlay here: https://retrogames.cc/nes-games/super-mario-bros.html', chatId);
        } else {
          await sendTelegramMessage('Unknown selection. Please try /play_games again.', chatId);
        }
      }
      return res.json({ ok: true });
    }

    // 2) Handle standard messages/commands
    const msg = update.message;
    if (!msg || !msg.chat || !msg.text) {
      return res.json({ ok: true });
    }
      const chatId = msg.chat.id;
      const text = String(msg.text || '').trim();
    console.log(`[telegram-bot] incoming chatId=${chatId} text=${JSON.stringify(text)}`);
    const parsed = parseCommandAndArgs(text);
    const name = (msg.from && (msg.from.first_name || msg.from.username)) || 'there';

    if (parsed && parsed.cmd) {
      if (parsed.cmd === 'help') {
        await sendTelegramMessage(buildHelpMessage(), chatId);
      } else if (parsed.cmd === 'time') {
        const now = new Date();
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        await sendTelegramMessage(`Current server time: ${now.toISOString()}\nTimezone: ${tz}`, chatId);
      } else if (parsed.cmd === 'echo') {
        if (parsed.args) {
          await sendTelegramMessage(parsed.args, chatId);
        } else {
          await sendTelegramMessage('Usage: /echo your text', chatId);
        }
      } else if (parsed.cmd === 'chat') {
        if (parsed.args) {
          await sendTelegramMessage('🤔 Thinking...', chatId);
          const response = await askChatGPT(parsed.args);
          await sendTelegramMessage(response, chatId);
        } else {
          await sendTelegramMessage('Usage: /chat your question', chatId);
        }
      } else if (parsed.cmd === 'watch') {
        try {
          const videoName = (parsed.args || '').toLowerCase();
          if (!videoName) {
            const videoList = Object.keys(VIDEO_LIBRARY)
              .map(n => `• ${n} - ${VIDEO_LIBRARY[n].caption}`)
              .join('\n');
            await sendTelegramMessage(`Available videos:\n\n${videoList}\n\nUsage: /watch video_name`, chatId);
          } else if (!Object.prototype.hasOwnProperty.call(VIDEO_LIBRARY, videoName)) {
            await sendTelegramMessage(`Video "${videoName}" not found. Use /watch to see available videos.`, chatId);
          } else {
            const video = VIDEO_LIBRARY[videoName];
            await forwardTelegramMessage(video.chatId, video.messageId, chatId);
          }
        } catch (err) {
          console.error('[telegram-bot] watch command error:', err);
          await sendTelegramMessage('Sorry, video is currently unavailable.', chatId);
        }
      } else if (parsed.cmd === 'app') {
        const webAppUrl = `${process.env.TELEGRAM_WEBHOOK_BASE_URL || 'https://api.shltechent.com'}/webapp`;
        await sendTelegramMessage('🚀 Click the button below to open SHL Mini App!', chatId, {
          reply_markup: { inline_keyboard: [[{ text: '✨ Open Mini App', web_app: { url: webAppUrl } }]] }
        });
      } else if (parsed.cmd === 'snake') {
        const snakeUrl = `${process.env.TELEGRAM_WEBHOOK_BASE_URL || 'https://api.shltechent.com'}/snake`;
        await sendTelegramMessage(
          '🐍 Snake Game Challenge!\n\n' +
          '🍎 "Ready to find me? I\'m the delicious prize you\'re seeking, but you have to work for it."\n\n' +
          '⚡️ The Challenge:\n' +
          '• Every time you score, you get closer... 🎯\n' +
          '• But the game gets hotter 🔥\n' +
          '• And you move faster ⚡️\n' +
          '• Don\'t hit the walls! 🧱\n' +
          '• Don\'t bite yourself! 🐍\n\n' +
          '🎮 Controls: Swipe on canvas or use arrow buttons\n\n' +
          '💪 Can you handle the speed?',
          chatId,
          { reply_markup: { inline_keyboard: [[{ text: '🎮 Accept Challenge', web_app: { url: snakeUrl } }]] } }
        );
      } else if (parsed.cmd === 'play_games') {
        const base = process.env.TELEGRAM_WEBHOOK_BASE_URL || 'https://api.shltechent.com';
        const intro =
          '🎮 SHL Games Arcade\n\n' +
          '⛏ SHL Miner\n' +
          'Tap to earn coins. Upgrade energy and recharge rate. Build your fortune!\n\n' +
          '🎯 Tank Retro Shooting\n' +
          'Dodge enemy fire and strike back. The starfield gets faster and hotter!\n\n' +
          '🍄 Mario (Ad‑free)\n' +
          'Jump and avoid pipes. The pace ramps up as your score climbs!\n\n' +
          '🟡 Pacman\n' +
          'Classic arcade chase. Navigate the maze, eat pellets, avoid ghosts!\n\n' +
          'Select a game below to play:';
        await sendTelegramMessage(intro, chatId, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '⛏ Open SHL Miner', web_app: { url: `${base}/miner` } }],
              [{ text: '🎯 Open Tank Retro Shooting', web_app: { url: `${base}/tank` } }],
              [{ text: '🍄 Open Mario', web_app: { url: `${base}/mario` } }],
              [{ text: '🟡 Open Pacman', web_app: { url: `${base}/pacman` } }]
            ]
          }
        });
      } else if (Object.prototype.hasOwnProperty.call(COMMAND_DEFS, parsed.cmd)) {
        const def = COMMAND_DEFS[parsed.cmd];
        const reply = replacePlaceholders(def.text || '', { name, args: parsed.args });
        await sendTelegramMessage(reply || 'Okay.', chatId);
      } else {
        await sendTelegramMessage('Unknown command. Type /help.', chatId);
      }
    } else {
      if (text && text.length > 0) {
        await sendTelegramMessage('🤔 Thinking...', chatId);
        const response = await askChatGPT(text);
        await sendTelegramMessage(response, chatId);
      } else {
        await sendTelegramMessage('I did not understand. Type /help.', chatId);
      }
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('[telegram-bot] webhook error', e);
    return res.json({ ok: true });
  }
});

const PORT = Number(process.env.BOT_PORT || 4100);
app.listen(PORT, async () => {
  console.log(`Telegram bot listening on :${PORT}`);
  await setTelegramWebhookIfConfigured();
  await syncTelegramCommandsIfEnabled();
});
