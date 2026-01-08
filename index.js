const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const Database = require('better-sqlite3');

const TOKEN = process.env.DISCORD_TOKEN;
const db = new Database('sparkkmod.db');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (guildId TEXT PRIMARY KEY, logChannel TEXT);
CREATE TABLE IF NOT EXISTS infractions (guildId TEXT, userId TEXT, count INTEGER, PRIMARY KEY (guildId, userId));
CREATE TABLE IF NOT EXISTS badwords (word TEXT PRIMARY KEY);
`);

const defaultWords = [
    "puta", "puto", "putinha", "putaria", "porra", "p0rra", "porr4", "caralho", "caralha", "c4ralho", 
    "krl", "krlh", "buceta", "buc3ta", "bct", "bucetinha", "cu", "cú", "c*", "cuzão", "cusao", "viado", 
    "viadinho", "viadagem", "gay", "boiola", "baitola", "arrombado", "arrombada", "desgraça", "desgraca", 
    "desgraçado", "desgracado", "merda", "m3rda", "merdinha", "fdp", "f.d.p", "filhadaputa", "piranha", 
    "vagabunda", "vagabundo", "otario", "otária", "imbecil", "idiota", "retardado", "corno", "corn0", 
    "corna", "pau", "p1roca", "pinto", "rola", "siririca", "sirir1ca", "broxa", "broxado", "cuzao", 
    "cuzona", "sexo", "sex0", "trepada", "trepar", "gozar", "gozo", "gozando", "foder", "fode", 
    "f0der", "fodase", "foda-se", "estupro", "estuprar", "estuprador", "racista", "racismo", "nazista", 
    "hitler", "macaco", "preto imundo", "preta imunda", "67", "fuck", "fucker", "fucking", "shit", 
    "sh1t", "bitch", "b1tch", "asshole", "a$$hole", "dick", "cock", "penis", "pussy", "pus*y", "whore", 
    "slut", "motherfucker", "mf", "retard", "retarded", "nigger", "nigga", "cunt", "sex", "anal", 
    "blowjob", "six seven", "seis sete"
];

// Função para limpar e inserir palavras
const insertStmt = db.prepare('INSERT OR IGNORE INTO badwords (word) VALUES (?)');
defaultWords.forEach(w => insertStmt.run(w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')));

let badWordsRegex = null;

function loadCache() {
    const rows = db.prepare('SELECT word FROM badwords').all();
    if (rows.length === 0) {
        badWordsRegex = null;
        return;
    }
    // Escapa caracteres especiais para não quebrar o filtro (ex: c* vira c\*)
    const escaped = rows.map(r => r.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    badWordsRegex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers]
});

async function sendLog(guildId, embed) {
    const row = db.prepare('SELECT logChannel FROM settings WHERE guildId = ?').get(guildId);
    if (!row?.logChannel) return;
    try {
        const channel = await client.channels.fetch(row.logChannel);
        if (channel) await channel.send({ embeds: [embed] });
    } catch (e) {}
}

const commands = [
    new SlashCommandBuilder().setName('setlog').setDescription('Canal de logs').addChannelOption(o => o.setName('canal').setDescription('Canal').setRequired(true)),
    new SlashCommandBuilder().setName('addword').setDescription('Banir palavra').addStringOption(o => o.setName('palavra').setDescription('Palavra').setRequired(true)),
    new SlashCommandBuilder().setName('clear').setDescription('Limpar chat').addIntegerOption(o => o.setName('qtd').setDescription('1-100').setRequired(true)),
    new SlashCommandBuilder().setName('kick').setDescription('Expulsar').addUserOption(o => o.setName('alvo').setDescription('Membro').setRequired(true)),
    new SlashCommandBuilder().setName('ban').setDescription('Banir').addUserOption(o => o.setName('alvo').setDescription('Membro').setRequired(true)),
    new SlashCommandBuilder().setName('resetall').setDescription('Resetar infrações')
].map(c => c.toJSON());

client.once('ready', async () => {
    loadCache();
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`🔥 SparkkMod: ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });

    const { commandName, options, guildId, guild } = interaction;

    if (commandName === 'setlog') {
        const channel = options.getChannel('canal');
        db.prepare('INSERT INTO settings (guildId, logChannel) VALUES (?, ?) ON CONFLICT(guildId) DO UPDATE SET logChannel = excluded.logChannel').run(guildId, channel.id);
        return interaction.reply({ content: `✅ Logs: ${channel}`, ephemeral: true });
    }

    if (commandName === 'addword') {
        const word = options.getString('palavra').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        db.prepare('INSERT OR IGNORE INTO badwords (word) VALUES (?)').run(word);
        loadCache(); // Recarrega o filtro
        return interaction.reply({ content: `✅ Banida: **${word}**`, ephemeral: true });
    }

    if (commandName === 'clear') {
        const amt = Math.min(options.getInteger('qtd'), 100);
        await interaction.channel.bulkDelete(amt, true);
        return interaction.reply({ content: `✅ Limpo.`, ephemeral: true });
    }

    if (commandName === 'kick' || commandName === 'ban') {
        const user = options.getUser('alvo');
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member || !member.moderatable) return interaction.reply({ content: '❌ Erro de hierarquia.', ephemeral: true });
        commandName === 'kick' ? await member.kick() : await member.ban();
        return interaction.reply({ content: `✅ Punido.` });
    }

    if (commandName === 'resetall') {
        db.prepare('DELETE FROM infractions WHERE guildId = ?').run(guildId);
        return interaction.reply({ content: '✅ Resetado.' });
    }
});

client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot || !badWordsRegex) return;
    if (message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return;
    
    const content = message.content.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    if (badWordsRegex.test(content)) {
        await message.delete().catch(() => {});
        if (!message.member || !message.member.moderatable) return;

        const row = db.prepare('SELECT count FROM infractions WHERE guildId = ? AND userId = ?').get(message.guild.id, message.author.id);
        const count = row ? row.count + 1 : 1;
        db.prepare('INSERT INTO infractions (guildId, userId, count) VALUES (?, ?, ?) ON CONFLICT(guildId, userId) DO UPDATE SET count = excluded.count').run(message.guild.id, message.author.id, count);

        const minutes = Math.pow(2, count - 1);
        const ms = Math.min(minutes * 60000, 2419200000);
        await message.member.timeout(ms, 'Linguagem proibida').catch(() => {});

        const embed = new EmbedBuilder()
            .setTitle('🔨 Castigo Aplicado')
            .setColor(0xff0000)
            .addFields(
                { name: 'Usuário', value: message.author.tag, inline: true },
                { name: 'Infrações', value: `${count}`, inline: true },
                { name: 'Tempo', value: `${minutes} min`, inline: true }
            ).setTimestamp();
        sendLog(message.guild.id, embed);
    }
});

client.login(TOKEN)
