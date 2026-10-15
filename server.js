require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://example.com';
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Подключение к SQLite
const db = new sqlite3.Database('bot.db', (err) => {
  if (err) console.error('Ошибка подключения к БД:', err.message);
  else console.log('📦 База данных SQLite успешно подключена.');
});

// ================= 1. ИНИЦИАЛИЗАЦИЯ ТАБЛИЦ =================
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      tg_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      onewin_id TEXT,
      is_registered INTEGER DEFAULT 0,
      deposits_count INTEGER DEFAULT 0,
      deposits_sum REAL DEFAULT 0,
      signals_used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS postbacks (
      onewin_id TEXT PRIMARY KEY,
      is_registered INTEGER DEFAULT 1,
      deposits_count INTEGER DEFAULT 0,
      deposits_sum REAL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `, () => {
    // Дефолтные настройки
    const defaults = {
      ref_link: 'https://1win.com',
      channel: '',
      promocode: 'TOWER500WIN',
      bot_name: 'Tower Rush',
      support: ''
    };
    for (const [k, v] of Object.entries(defaults)) {
      db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [k, v]);
    }
  });
});

// Хелперы для настроек
const getSetting = (key, callback) => {
  db.get(`SELECT value FROM settings WHERE key = ?`, [key], (err, row) => {
    callback(row ? row.value : '');
  });
};

const setSetting = (key, val) => {
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, val]);
};

// ================= 2. ПРОВЕРКА ПОДПИСКИ =================
async function checkSubscription(ctx) {
  return new Promise((resolve) => {
    getSetting('channel', async (channel) => {
      if (!channel) return resolve(true);
      try {
        const member = await ctx.telegram.getChatMember(channel, ctx.from.id);
        if (['creator', 'administrator', 'member'].includes(member.status)) return resolve(true);
        resolve(false);
      } catch (e) {
        resolve(true);
      }
    });
  });
}

// ================= 3. КОМАНДЫ БОТА =================
bot.start(async (ctx) => {
  db.run(
    `INSERT OR IGNORE INTO users (tg_id, username, first_name) VALUES (?, ?, ?)`,
    [ctx.from.id, ctx.from.username || '', ctx.from.first_name || 'Игрок']
  );

  const isSub = await checkSubscription(ctx);
  if (!isSub) {
    getSetting('channel', (channel) => {
      ctx.reply(
        `⚠️ <b>Перед началом подпишись на наш канал:</b> ${channel}`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.url('📢 Подписаться', `https://t.me/${channel.replace('@', '')}`)],
            [Markup.button.callback('✅ Я подписался', 'check_sub')]
          ])
        }
      );
    });
    return;
  }
  await sendWelcome(ctx);
});

bot.action('check_sub', async (ctx) => {
  if (await checkSubscription(ctx)) {
    await ctx.deleteMessage().catch(() => {});
    await sendWelcome(ctx);
  } else {
    await ctx.answerCbQuery('❌ Вы еще не подписались на канал!', { show_alert: true });
  }
});

function sendWelcome(ctx) {
  getSetting('ref_link', (refLink) => {
    getSetting('bot_name', (botName) => {
      ctx.reply('⚡');
      ctx.reply(
        `🔥 <b>${botName.toUpperCase()} SIGNALS</b>\n\n` +
        `💎 Этот бот создан для тех, кто играет в Tower Rush и хочет принимать решения на основе данных, а не интуиции.\n\n` +
        `📊 <b>Что делает бот:</b>\n` +
        `<blockquote>• Выдаёт сигналы — сколько этажей строить и с каким коэффициентом\n` +
        `• Подбирает стратегию под твой стиль игры\n` +
        `• Ведёт статистику раундов и считает винрейт\n` +
        `• Обучает правильному входу и выходу из раунда</blockquote>\n\n` +
        `⚡ В основе — алгоритм, прошедший тысячи итераций на реальных данных игры.\n\n` +
        `Сигналы открываются после регистрации и первого депозита на 1win.\n\n` +
        `❓ Вопросы? Напиши /help`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.webApp('📱 Открыть', WEBAPP_URL)],
            [Markup.button.url('🎰 Зарегистрироваться', refLink)]
          ])
        }
      );
    });
  });
}

bot.command('help', async (ctx) => {
  getSetting('support', (support) => {
    const buttons = [[Markup.button.webApp('📱 Открыть Mini App', WEBAPP_URL)]];
    if (support) {
      buttons.push([Markup.button.url('💬 Написать в поддержку', `https://t.me/${support.replace('@', '')}`)]);
    }

    ctx.reply('📌');
    ctx.reply(
      `🛡 <b>ПОМОЩЬ</b>\nЗдесь всё необходимое для старта работы с ботом.\n\n` +
      `🎮 <b>КАК НАЧАТЬ?</b>\n` +
      `<blockquote expandable><b>— Открой мини-приложение</b>\nНажми кнопку «Открыть» внизу сообщения.\n\n` +
      `<b>— Зарегистрируйся и введи ID</b>\nСоздай аккаунт на 1win и привяжи свой 1win ID в разделе «Профиль».\n\n` +
      `<b>— Сделай первый депозит</b>\nПополни баланс — бот получит уведомление автоматически.\n\n` +
      `<b>— Получай сигналы</b>\nПосле подтверждения депозита раздел «Сигналы» разблокируется.</blockquote>\n\n` +
      `💬 <b>ЧАСТЫЕ ВОПРОСЫ:</b>\n` +
      `<blockquote expandable><b>— Зачем боту нужен новый аккаунт?</b>\nДля корректной работы алгоритма требуется «чистый» аккаунт без предыстории. Старый аккаунт искажает вероятности.\n\n` +
      `<b>— Почему сигналы недоступны?</b>\nБот ещё не видит твой аккаунт. Для разблокировки зарегистрируйся по нашей ссылке, привяжи ID и внеси первый депозит.</blockquote>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      }
    );
  });
});

// ================= 4. АДМИН-ПАНЕЛЬ =================
const adminState = {};

bot.command('admin', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  showAdminMain(ctx);
});

function showAdminMain(ctx, edit = false) {
  const text = `💎 <b>АДМИН ПАНЕЛЬ</b>\n\nУправляй ботом, отслеживай статистику и запускай рассылки.`;
  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Статистика', 'adm_stats'),
      Markup.button.callback('🗂 Данные', 'adm_data'),
      Markup.button.callback('📣 Рассылка', 'adm_broadcast')
    ]
  ]);
  if (edit) return ctx.editMessageText(text, { parse_mode: 'HTML', ...kb });
  return ctx.reply(text, { parse_mode: 'HTML', ...kb });
}

bot.action('adm_back', (ctx) => showAdminMain(ctx, true));

bot.action('adm_stats', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  db.get(`SELECT 
    (SELECT COUNT(*) FROM users) as total,
    (SELECT COUNT(*) FROM users WHERE is_registered = 1) as regs,
    (SELECT COUNT(*) FROM users WHERE deposits_count > 0) as deps,
    (SELECT COUNT(*) FROM users WHERE deposits_count >= 10) as vips,
    (SELECT IFNULL(SUM(deposits_sum), 0) FROM users) as depSum,
    (SELECT IFNULL(SUM(signals_used), 0) FROM users) as sigSum
  `, (err, row) => {
    if (err) return;
    const regConv = row.total > 0 ? ((row.regs / row.total) * 100).toFixed(1) : '0.0';
    const depConv = row.regs > 0 ? ((row.deps / row.regs) * 100).toFixed(1) : '0.0';

    const text =
      `📊 <b>СТАТИСТИКА • Всё время</b>\n\n` +
      `👥 <b>Пользователей всего:</b> ${row.total}\n` +
      `├ Зарегистрировались: ${row.regs} (${regConv}%)\n` +
      `├ Сделали депозит: ${row.deps} (${depConv}%)\n` +
      `└ VIP: ${row.vips}\n\n` +
      `📈 <b>Конверсия</b>\n` +
      `├ Переход → Регистрация: ${regConv}%\n` +
      `└ Регистрация → Депозит: ${depConv}%\n\n` +
      `💵 <b>Финансы</b>\n` +
      `└ Сумма депозитов: $${row.depSum.toFixed(2)}\n\n` +
      `🔥 <b>Активность</b>\n` +
      `└ Сигналов выдано: ${row.sigSum}`;

    ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'adm_back')]])
    });
  });
});

bot.action('adm_data', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  getSetting('ref_link', (ref_link) => {
    getSetting('channel', (channel) => {
      getSetting('promocode', (promocode) => {
        getSetting('bot_name', (bot_name) => {
          getSetting('support', (support) => {
            const text =
              `🗂 <b>ДАННЫЕ БОТА</b>\n\n` +
              `🔗 <b>Реф. ссылка:</b> ${ref_link || 'не задана'}\n` +
              `📢 <b>Телеграм-канал:</b> ${channel || 'не задан'}\n` +
              `🎁 <b>Промокод:</b> <code>${promocode}</code>\n` +
              `🏷 <b>Название бота:</b> ${bot_name}\n` +
              `💬 <b>Поддержка:</b> ${support || 'не задана'}`;

            ctx.editMessageText(text, {
              parse_mode: 'HTML',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('🔗 Реф. ссылка', 'set_ref_link'), Markup.button.callback('📢 Канал', 'set_channel')],
                [Markup.button.callback('🎁 Промокод', 'set_promocode'), Markup.button.callback('🏷 Название', 'set_bot_name')],
                [Markup.button.callback('💬 Поддержка', 'set_support')],
                [Markup.button.callback('⬅️ Назад', 'adm_back')]
              ])
            });
          });
        });
      });
    });
  });
});

['ref_link', 'channel', 'promocode', 'bot_name', 'support'].forEach((key) => {
  bot.action(`set_${key}`, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    adminState[ADMIN_ID] = { action: 'edit_setting', key };
    await ctx.reply(`✏️ Отправьте новое значение для поля <b>${key}</b> (или "-" чтобы очистить):`, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  });
});

bot.action('adm_broadcast', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'broadcast' };
  await ctx.reply('📣 Отправьте сообщение (текст или фото с подписью), которое нужно разослать всем пользователям:');
  await ctx.answerCbQuery();
});

bot.on('message', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID || !adminState[ADMIN_ID]) return;
  const state = adminState[ADMIN_ID];
  delete adminState[ADMIN_ID];

  if (state.action === 'edit_setting') {
    const val = ctx.message.text === '-' ? '' : ctx.message.text.trim();
    setSetting(state.key, val);
    await ctx.reply(`✅ Значение <b>${state.key}</b> обновлено!`, { parse_mode: 'HTML' });
    return showAdminMain(ctx);
  }

  if (state.action === 'broadcast') {
    db.all(`SELECT tg_id FROM users`, async (err, users) => {
      if (err) return;
      let sent = 0;
      await ctx.reply(`⏳ Начинаю рассылку на ${users.length} пользователей...`);
      for (const u of users) {
        try {
          await ctx.telegram.copyMessage(u.tg_id, ctx.chat.id, ctx.message.message_id);
          sent++;
        } catch (e) {}
      }
      await ctx.reply(`✅ Рассылка завершена! Доставлено: ${sent} из ${users.length}.`);
    });
  }
});

// ================= 5. API ДЛЯ ПОСТБЕКОВ И MINI APP =================
app.get('/api/postback', (req, res) => {
  const { event, user_id, amount } = req.query;
  if (!user_id) return res.status(400).send('Missing user_id');

  const sum = parseFloat(amount) || 0;

  db.run(`
    INSERT INTO postbacks (onewin_id, is_registered, deposits_count, deposits_sum)
    VALUES (?, 1, ?, ?)
    ON CONFLICT(onewin_id) DO UPDATE SET
      deposits_count = deposits_count + ?,
      deposits_sum = deposits_sum + ?
  `, [String(user_id), sum > 0 ? 1 : 0, sum, sum > 0 ? 1 : 0, sum], () => {
    
    db.get(`SELECT * FROM users WHERE onewin_id = ?`, [String(user_id)], (err, user) => {
      if (user && (event === 'deposit' || sum > 0)) {
        db.run(`
          UPDATE users SET is_registered = 1, deposits_count = deposits_count + 1, deposits_sum = deposits_sum + ?
          WHERE tg_id = ?
        `, [sum, user.tg_id]);

        bot.telegram.sendMessage(
          user.tg_id,
          `🎉 <b>Депозит подтверждён!</b>\n\nДоступ к сигналам открыт. Жми кнопку ниже!`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.webApp('⚡ Открыть сигналы', WEBAPP_URL)]])
          }
        ).catch(() => {});
      }
    });
  });

  res.send('OK');
});

app.post('/api/bind-id', (req, res) => {
  const { tg_id, onewin_id } = req.body;
  if (!tg_id || !onewin_id) return res.status(400).json({ error: 'Укажите ID' });

  db.get(`SELECT * FROM postbacks WHERE onewin_id = ?`, [String(onewin_id)], (err, pb) => {
    if (!pb) {
      return res.json({
        success: false,
        message: 'Аккаунт с таким ID не найден в базе партнерки!'
      });
    }

    db.run(`
      UPDATE users SET onewin_id = ?, is_registered = 1, deposits_count = ?, deposits_sum = ?
      WHERE tg_id = ?
    `, [String(onewin_id), pb.deposits_count, pb.deposits_sum, Number(tg_id)], () => {
      return res.json({
        success: true,
        is_registered: true,
        has_deposit: pb.deposits_count > 0,
        deposits_count: pb.deposits_count,
        deposits_sum: pb.deposits_sum
      });
    });
  });
});

app.get('/api/config', (req, res) => {
  getSetting('ref_link', (ref_link) => {
    getSetting('channel', (channel) => {
      getSetting('promocode', (promocode) => {
        getSetting('bot_name', (bot_name) => {
          getSetting('support', (support) => {
            res.json({ ref_link, channel, promocode, bot_name, support });
          });
        });
      });
    });
  });
});

// Запуск
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
bot.launch().then(() => console.log('🤖 Telegram-бот запущен!'));