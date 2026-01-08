const { 
    Client, 
    GatewayIntentBits, 
    PermissionsBitField, 
    EmbedBuilder,
    SlashCommandBuilder,
    REST,
    Routes
} = require('discord.js');

const Database = require('better-sqlite3');
const db = new Database('sparkkmod.db');

// ====== CONFIG ======
const TOKEN = process.env.DISCORD_TOKEN;

// ====== CLIENT ======
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// ====== DATABASE ======
db.prepare(`
CREATE TABLE IF NOT EXISTS settings (
    guildId TEXT PRIMARY KEY,
    logChannel TEXT
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS infractions (
    guildId TEXT,
    userId TEXT,
    count INTEGER,
    PRIMARY KEY (guildId, userId)
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS badwords (
    word TEXT PRIMARY KEY
)
`).run();

// ====== PALAVRÕES (EXEMPLO – você pode expandir) ======
const defaultBadWords = ['porra', 'caralho', 'puta', 'viado', 'fdp'];
defaultBadWords.forEach(w => {
    db.prepare('INSERT OR IGNORE INTO badwords (word) VALUES (?)').run(w);
});

// ====== FUNÇÕES ======
function normalize(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function containsBadWord(text) {
    const words = db.prepare('SELECT word FROM badwords').all();
    const content = normalize(text);

    return words.some(w => {
        const regex = new RegExp(`\\b${w.word}\\b`, 'i');
        return regex.test(content);
    });
}

async function sendLog(guildId, embed) {
    const row = db.prepare(
        'SELECT logChannel FROM settings WHERE guildId = ?'
    ).get(guildId);

    if (!row) return;

    try {
        const channel = await client.channels.fetch(row.logChannel);
        if (!channel) return;
        await channel.send({ embeds: [embed] });
    } catch (e) {
        console.error('Erro log:', e.message);
    }
}

// ====== SLASH COMMANDS ======
const commands = [
    new SlashCommandBuilder()
        .setName('setlog')
        .setDescription('Define o canal de logs')
        .addChannelOption(opt =>
            opt.setName('canal')
               .setDescription('Canal de logs')
               .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('addword')
        .setDescription('Adiciona palavrão')
        .addStringOption(opt =>
            opt.setName('palavra')
               .setDescription('Palavra proibida')
               .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('resetall')
        .setDescription('Reseta punições de todos')
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`🔥 SparkkMod online como ${client.user.tag}`);

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
    );

    console.log('✅ Slash commands globais registrados');
});

// ====== INTERACTIONS ======
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
    }

    if (interaction.commandName === 'setlog') {
        const channel = interaction.options.getChannel('canal');

        db.prepare(`
            INSERT INTO settings (guildId, logChannel)
            VALUES (?, ?)
            ON CONFLICT(guildId)
            DO UPDATE SET logChannel = excluded.logChannel
        `).run(interaction.guildId, channel.id);

        return interaction.reply({ content: `✅ Logs definidos em ${channel}`, ephemeral: true });
    }

    if (interaction.commandName === 'addword') {
        const word = normalize(interaction.options.getString('palavra'));
        db.prepare('INSERT OR IGNORE INTO badwords (word) VALUES (?)').run(word);
        return interaction.reply({ content: `✅ Palavra adicionada: **${word}**`, ephemeral: true });
    }

    if (interaction.commandName === 'resetall') {
        db.prepare('DELETE FROM infractions WHERE guildId = ?').run(interaction.guildId);
        return interaction.reply({ content: '✅ Punições resetadas.', ephemeral: true });
    }
});

// ====== MENSAGENS ======
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    if (message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

    if (!containsBadWord(message.content)) return;

    await message.delete().catch(() => {});

    const row = db.prepare(`
        SELECT count FROM infractions
        WHERE guildId = ? AND userId = ?
    `).get(message.guild.id, message.author.id);

    const count = row ? row.count + 1 : 1;

    db.prepare(`
        INSERT INTO infractions (guildId, userId, count)
        VALUES (?, ?, ?)
        ON CONFLICT(guildId, userId)
        DO UPDATE SET count = excluded.count
    `).run(message.guild.id, message.author.id, count);

    const minutes = Math.pow(2, count - 1);
    const ms = minutes * 60 * 1000;
    const MAX = 28 * 24 * 60 * 60 * 1000;

    if (ms >= MAX) {
        await message.member.kick('Limite de infrações atingido');
    } else {
        await message.member.timeout(ms, 'Linguagem proibida');
    }

    const embed = new EmbedBuilder()
        .setTitle('🔨 SparkkMod')
        .setColor(0xff0000)
        .addFields(
            { name: 'Usuário', value: `${message.author.tag}` },
            { name: 'Infrações', value: `${count}` },
            { name: 'Punição', value: ms >= MAX ? 'Kick' : `${minutes} min` }
        )
        .setTimestamp();

    sendLog(message.guild.id, embed);
});

// ====== LOGIN ======
client.login(TOKEN);
