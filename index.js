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
    "viadinho", "viadagem", "boiola", "baitola", "arrombado", "arrombada", "desgraça", "desgraca", 
    "desgraçado", "desgracado", "merda", "m3rda", "merdinha", "fdp", "f.d.p", "filhadaputa", "piranha", 
    "vagabunda", "vagabundo", "otario", "otária", "imbecil", "idiota", "retardado", "corno", "corn0", 
    "corna", "pau", "p1roca", "pinto", "rola", "siririca", "sirir1ca", "broxa", "broxado", "cuzao", 
    "cuzona", "sexo", "sex0", "trepada", "trepar", "gozar", "gozo", "gozando", "foder", "fode", 
    "f0der", "fodase", "foda-se", "estupro", "estuprar", "estuprador", "racista", "racismo", "nazista", 
    "hitler", "macaco", "preto imundo", "preta imunda", "67", "fuck", "fucker", "fucking", "shit", 
    "sh1t", "bitch", "b1tch", "asshole", "a$$hole", "dick", "cock", "penis", "pussy", "pus*y", "whore", 
    "slut", "motherfucker", "mf", "retard", "retarded", "nigger", "nigga", "cunt", "anal", 
    "blowjob", "six seven", "seis sete"
];

// Inserir palavras padrão no banco
const insertStmt = db.prepare('INSERT OR IGNORE INTO badwords (word) VALUES (?)');
defaultWords.forEach(w => insertStmt.run(w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')));

let badWordsRegex = null;

function loadCache() {
    const rows = db.prepare('SELECT word FROM badwords').all();
    if (rows.length === 0) {
        badWordsRegex = null;
        return;
    }
    // Escapa caracteres especiais de regex
    const escaped = rows.map(r => r.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // Usa word boundaries flexíveis para pegar variações
    badWordsRegex = new RegExp(`(${escaped.join('|')})`, 'gi');
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers
    ]
});

async function sendLog(guildId, embed) {
    const row = db.prepare('SELECT logChannel FROM settings WHERE guildId = ?').get(guildId);
    if (!row?.logChannel) return;
    try {
        const channel = await client.channels.fetch(row.logChannel);
        if (channel?.isTextBased()) {
            await channel.send({ embeds: [embed] });
        }
    } catch (e) {
        console.error('Erro ao enviar log:', e.message);
    }
}

const commands = [
    new SlashCommandBuilder()
        .setName('setlog')
        .setDescription('Define o canal de logs de moderação')
        .addChannelOption(o => o.setName('canal').setDescription('Canal para logs').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('addword')
        .setDescription('Adiciona uma palavra à lista de bloqueio')
        .addStringOption(o => o.setName('palavra').setDescription('Palavra a banir').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Limpa mensagens do canal')
        .addIntegerOption(o => o.setName('qtd').setDescription('Quantidade (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    
    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Expulsa um membro do servidor')
        .addUserOption(o => o.setName('alvo').setDescription('Membro a expulsar').setRequired(true))
        .addStringOption(o => o.setName('motivo').setDescription('Motivo da expulsão')),
    
    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Bane um membro do servidor')
        .addUserOption(o => o.setName('alvo').setDescription('Membro a banir').setRequired(true))
        .addStringOption(o => o.setName('motivo').setDescription('Motivo do banimento')),
    
    new SlashCommandBuilder()
        .setName('resetall')
        .setDescription('Reseta todas as infrações do servidor')
].map(c => c.toJSON());

client.once('ready', async () => {
    loadCache();
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`🔥 SparkkMod Online: ${client.user.tag}`);
        console.log(`📊 Servidores: ${client.guilds.cache.size}`);
    } catch (error) {
        console.error('Erro ao registrar comandos:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // Verifica permissão do usuário
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.reply({ content: '❌ Você não tem permissão para usar comandos de moderação.', ephemeral: true });
    }

    const { commandName, options, guildId, guild } = interaction;

    try {
        if (commandName === 'setlog') {
            const channel = options.getChannel('canal');
            
            if (!channel.isTextBased()) {
                return interaction.reply({ content: '❌ O canal precisa ser de texto.', ephemeral: true });
            }

            db.prepare('INSERT INTO settings (guildId, logChannel) VALUES (?, ?) ON CONFLICT(guildId) DO UPDATE SET logChannel = excluded.logChannel')
                .run(guildId, channel.id);
            
            return interaction.reply({ content: `✅ Canal de logs definido: ${channel}`, ephemeral: true });
        }

        if (commandName === 'addword') {
            const word = options.getString('palavra').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            
            if (word.length < 2) {
                return interaction.reply({ content: '❌ A palavra precisa ter pelo menos 2 caracteres.', ephemeral: true });
            }

            db.prepare('INSERT OR IGNORE INTO badwords (word) VALUES (?)').run(word);
            loadCache();
            
            return interaction.reply({ content: `✅ Palavra banida: **${word}**`, ephemeral: true });
        }

        if (commandName === 'clear') {
            // Verifica permissão do bot
            if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                return interaction.reply({ content: '❌ Não tenho permissão para gerenciar mensagens.', ephemeral: true });
            }

            const amt = options.getInteger('qtd');
            await interaction.deferReply({ ephemeral: true });
            
            const deleted = await interaction.channel.bulkDelete(amt, true);
            return interaction.editReply({ content: `✅ ${deleted.size} mensagens deletadas.` });
        }

        if (commandName === 'kick') {
            // Verifica permissão do bot
            if (!guild.members.me.permissions.has(PermissionsBitField.Flags.KickMembers)) {
                return interaction.reply({ content: '❌ Não tenho permissão para expulsar membros.', ephemeral: true });
            }

            const user = options.getUser('alvo');
            const motivo = options.getString('motivo') || 'Sem motivo especificado';
            const member = await guild.members.fetch(user.id).catch(() => null);
            
            if (!member) {
                return interaction.reply({ content: '❌ Membro não encontrado no servidor.', ephemeral: true });
            }

            if (!member.kickable) {
                return interaction.reply({ content: '❌ Não posso expulsar este membro (hierarquia ou permissões).', ephemeral: true });
            }

            await member.kick(motivo);
            
            const embed = new EmbedBuilder()
                .setTitle('👢 Membro Expulso')
                .setColor(0xff9900)
                .addFields(
                    { name: 'Usuário', value: `${user.tag} (${user.id})`, inline: true },
                    { name: 'Moderador', value: interaction.user.tag, inline: true },
                    { name: 'Motivo', value: motivo }
                )
                .setTimestamp();
            
            await sendLog(guildId, embed);
            return interaction.reply({ content: `✅ **${user.tag}** foi expulso.` });
        }

        if (commandName === 'ban') {
            // Verifica permissão do bot
            if (!guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                return interaction.reply({ content: '❌ Não tenho permissão para banir membros.', ephemeral: true });
            }

            const user = options.getUser('alvo');
            const motivo = options.getString('motivo') || 'Sem motivo especificado';
            const member = await guild.members.fetch(user.id).catch(() => null);
            
            if (!member) {
                return interaction.reply({ content: '❌ Membro não encontrado no servidor.', ephemeral: true });
            }

            if (!member.bannable) {
                return interaction.reply({ content: '❌ Não posso banir este membro (hierarquia ou permissões).', ephemeral: true });
            }

            await member.ban({ reason: motivo });
            
            const embed = new EmbedBuilder()
                .setTitle('🔨 Membro Banido')
                .setColor(0xff0000)
                .addFields(
                    { name: 'Usuário', value: `${user.tag} (${user.id})`, inline: true },
                    { name: 'Moderador', value: interaction.user.tag, inline: true },
                    { name: 'Motivo', value: motivo }
                )
                .setTimestamp();
            
            await sendLog(guildId, embed);
            return interaction.reply({ content: `✅ **${user.tag}** foi banido permanentemente.` });
        }

        if (commandName === 'resetall') {
            db.prepare('DELETE FROM infractions WHERE guildId = ?').run(guildId);
            
            const embed = new EmbedBuilder()
                .setTitle('🔄 Infrações Resetadas')
                .setDescription('Todas as infrações foram removidas.')
                .setColor(0x00ff00)
                .setFooter({ text: `Por ${interaction.user.tag}` })
                .setTimestamp();
            
            await sendLog(guildId, embed);
            return interaction.reply({ content: '✅ Todas as infrações foram resetadas.' });
        }

    } catch (error) {
        console.error(`Erro no comando ${commandName}:`, error);
        const errorMsg = { content: '❌ Ocorreu um erro ao executar este comando.', ephemeral: true };
        
        if (interaction.deferred) {
            return interaction.editReply(errorMsg);
        } else {
            return interaction.reply(errorMsg);
        }
    }
});

client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot || !badWordsRegex) return;
    if (message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return;
    
    const content = message.content.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    if (badWordsRegex.test(content)) {
        // Deleta a mensagem
        await message.delete().catch(err => {
            console.error('Erro ao deletar mensagem:', err.message);
        });

        if (!message.member || !message.member.moderatable) return;

        // Verifica se o bot pode dar timeout
        if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            console.error('Bot não tem permissão para dar timeout');
            return;
        }

        // Atualiza infrações
        const row = db.prepare('SELECT count FROM infractions WHERE guildId = ? AND userId = ?')
            .get(message.guild.id, message.author.id);
        const count = row ? row.count + 1 : 1;
        
        db.prepare('INSERT INTO infractions (guildId, userId, count) VALUES (?, ?, ?) ON CONFLICT(guildId, userId) DO UPDATE SET count = excluded.count')
            .run(message.guild.id, message.author.id, count);

        // Calcula timeout (exponencial: 1min, 2min, 4min, 8min...)
        const minutes = Math.pow(2, count - 1);
        const maxTimeout = 28 * 24 * 60; // 28 dias em minutos
        const timeoutMinutes = Math.min(minutes, maxTimeout);
        const ms = timeoutMinutes * 60000;

        await message.member.timeout(ms, 'Linguagem proibida').catch(err => {
            console.error('Erro ao aplicar timeout:', err.message);
        });

        // Avisa o usuário
        const reply = await message.channel.send(
            `🚫 ${message.author}, linguagem inadequada detectada! **Timeout: ${timeoutMinutes}min** (Infração ${count})`
        ).catch(() => null);

        // Deleta o aviso após 10 segundos
        if (reply) {
            setTimeout(() => reply.delete().catch(() => {}), 10000);
        }

        // Loga a punição
        const embed = new EmbedBuilder()
            .setTitle('🔨 Auto-Moderação: Timeout Aplicado')
            .setColor(0xff0000)
            .addFields(
                { name: 'Usuário', value: `${message.author.tag} (${message.author.id})`, inline: true },
                { name: 'Infração', value: `#${count}`, inline: true },
                { name: 'Timeout', value: `${timeoutMinutes} minutos`, inline: true },
                { name: 'Canal', value: `${message.channel}` }
            )
            .setTimestamp();
        
        await sendLog(message.guild.id, embed);
    }
});

client.on('error', error => {
    console.error('Erro no cliente Discord:', error);
});

client.on('warn', warning => {
    console.warn('Aviso do Discord:', warning);
});

client.login(TOKEN).catch(error => {
    console.error('Erro ao fazer login:', error);
    process.exit(1);
});
