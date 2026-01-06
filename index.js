require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');

const fs = require('fs');
const db = require('./database');

let palavroes = require('./palavroes.json').palavroes;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: ['CHANNEL']
});

/* ================= FUNÇÕES ================= */

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');
}

function escapeRegex(word) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasBadWord(text) {
  const msg = normalize(text);

  return palavroes.some(word => {
    if (!word || typeof word !== 'string') return false;

    const clean = word.trim();
    if (!clean) return false;

    const safe = escapeRegex(clean);

    // palavras curtas (cu, mf, etc)
    if (safe.length < 3) {
      const regex = new RegExp(`(^|\\s)${safe}(\\s|$)`, 'i');
      return regex.test(msg);
    }

    // palavras normais
    const regex = new RegExp(`\\b${safe}\\b`, 'i');
    return regex.test(msg);
  });
}

function getLogChannelId() {
  const row = db.prepare(
    `SELECT value FROM config WHERE key = 'log_channel'`
  ).get();
  return row ? row.value : null;
}

/* ================= SLASH COMMANDS ================= */

const commands = [
  new SlashCommandBuilder()
    .setName('addword')
    .setDescription('Adicionar palavra proibida')
    .addStringOption(opt =>
      opt.setName('palavra')
        .setDescription('Palavra')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('setlog')
    .setDescription('Definir canal de logs')
    .addChannelOption(opt =>
      opt.setName('canal')
        .setDescription('Canal de logs')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('resetinfractions')
    .setDescription('Resetar punições de TODOS os usuários')
].map(cmd => cmd.toJSON());

/* ================= READY ================= */

client.once('ready', async () => {
  console.log(`🔥 SparkkMod online como ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );

  console.log('✅ Slash commands globais registrados');
});

/* ================= INTERACTIONS ================= */

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    return interaction.reply({
      content: '❌ Apenas administradores.',
      flags: 64
    });
  }

  // /addword
  if (interaction.commandName === 'addword') {
    const palavra = normalize(interaction.options.getString('palavra')).trim();

    if (palavroes.includes(palavra)) {
      return interaction.reply({ content: '⚠️ Palavra já existe.', flags: 64 });
    }

    palavroes.push(palavra);
    fs.writeFileSync('./palavroes.json', JSON.stringify({ palavroes }, null, 2));

    return interaction.reply(`✅ Palavra **${palavra}** adicionada.`);
  }

  // /setlog
  if (interaction.commandName === 'setlog') {
    const canal = interaction.options.getChannel('canal');

    db.prepare(`
      INSERT OR REPLACE INTO config (key, value)
      VALUES ('log_channel', ?)
    `).run(canal.id);

    return interaction.reply(`📄 Canal de logs definido: ${canal}`);
  }

  // /resetinfractions
  if (interaction.commandName === 'resetinfractions') {
    db.prepare('DELETE FROM infractions').run();
    return interaction.reply('🧹 Todas as punições foram resetadas.');
  }
});

/* ================= MODERAÇÃO ================= */

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
  if (!hasBadWord(message.content)) return;

  try {
    await message.delete();

    let row = db.prepare(
      'SELECT count FROM infractions WHERE userId = ?'
    ).get(message.author.id);

    let count = row ? row.count + 1 : 1;
    let minutes = Math.pow(2, count - 1);
    let ms = minutes * 60 * 1000;
    const MAX = 28 * 24 * 60 * 60 * 1000;

    if (ms >= MAX) {
      await message.member.kick('Limite de infrações');
    } else {
      await message.member.timeout(ms, 'Palavrão detectado');
    }

    db.prepare(
      'INSERT OR REPLACE INTO infractions (userId, count) VALUES (?, ?)'
    ).run(message.author.id, count);

    // ===== LOG =====
    const logId = getLogChannelId();
    if (logId) {
      const logChannel = await message.guild.channels.fetch(logId).catch(() => null);

      if (logChannel) {
        const embed = new EmbedBuilder()
          .setTitle('🚨 SparkkMod - Moderação')
          .setColor('Red')
          .addFields(
            { name: 'Usuário', value: message.author.tag, inline: true },
            { name: 'Infrações', value: `${count}`, inline: true },
            { name: 'Punição', value: ms >= MAX ? 'Kick' : `${minutes} min mute` }
          )
          .setTimestamp();

        await logChannel.send({ embeds: [embed] });
      }
    }

  } catch (err) {
    console.error('Erro SparkkMod:', err.message);
  }
});

/* ================= LOGIN ================= */

client.login(process.env.DISCORD_TOKEN);
