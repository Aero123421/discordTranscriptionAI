require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const { Client, Collection, GatewayIntentBits, ChannelType, Events } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus } = require('@discordjs/voice');
const { better, defineQueue } = require('./lib/queue');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const prism = require('prism-media');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
    ],
});

// --- Command Handling ---
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

// --- Job Queue Setup ---
const dbPath = path.join(__dirname, 'db', 'queue.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
const connection = better(db);
const queue = defineQueue({ connection });
client.queue = queue;

// --- Recording Sessions Map ---
const recordingSessions = new Map();
client.recordingSessions = recordingSessions;

// --- Main Bot Logic ---
client.once(Events.ClientReady, c => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
    fs.mkdirSync(path.join(__dirname, 'recordings'), { recursive: true });
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }
    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const configPath = path.join(__dirname, `config_${newState.guild.id}.json`);
    if (!fs.existsSync(configPath)) return;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    const oldChannel = oldState.channel;
    const newChannel = newState.channel;
    const member = newState.member;

    if (member.user.bot) return;

    // User joins a monitored channel
    if (newChannel && newChannel.parent && newChannel.parent.id === config.targetCategoryId) {
        if (!recordingSessions.has(newChannel.id)) {
            const sessionId = uuidv4();
            const connection = joinVoiceChannel({
                channelId: newChannel.id,
                guildId: newChannel.guild.id,
                adapterCreator: newChannel.guild.voiceAdapterCreator,
                selfDeaf: false,
            });

            const session = {
                id: sessionId,
                connection: connection,
                users: new Set(),
                outputChannelId: config.outputChannelId,
            };
            recordingSessions.set(newChannel.id, session);
            console.log(`[SESSION START] Started recording session ${sessionId} in channel ${newChannel.name}`);
        }
        recordingSessions.get(newChannel.id).users.add(member.id);
        startUserRecording(recordingSessions.get(newChannel.id), member);
    }

    // User leaves a monitored channel
    if (oldChannel && oldChannel.parent && oldChannel.parent.id === config.targetCategoryId) {
        const session = recordingSessions.get(oldChannel.id);
        if (session) {
            session.users.delete(member.id);
            if (session.users.size === 0) {
                console.log(`[SESSION END] All users left. Ending session ${session.id} in channel ${oldChannel.name}`);
                if (session.connection.state.status !== VoiceConnectionStatus.Destroyed) {
                    session.connection.destroy();
                }
                recordingSessions.delete(oldChannel.id);
            }
        }
    }
});

function startUserRecording(session, member) {
    const { connection, id: sessionId } = session;
    const receiver = connection.receiver;

    const audioStream = receiver.subscribe(member.id, {
        end: {
            behavior: 'afterSilence',
            duration: 200,
        },
    });

    const pcmFilePath = path.join(__dirname, 'recordings', `${sessionId}_${member.id}_${Date.now()}.pcm`);
    const pcmStream = audioStream.pipe(new prism.opus.Decoder({ rate: 48000, channels: 1, frameSize: 960 }));
    const fileStream = fs.createWriteStream(pcmFilePath);
    pcmStream.pipe(fileStream);

    fileStream.on('finish', () => {
        console.log(`[RECORDING] Finished writing PCM file: ${pcmFilePath}`);
        client.queue.add('transcribe', {
            pcmPath: pcmFilePath,
            userId: member.id,
            sessionId: sessionId,
            outputChannelId: session.outputChannelId,
            guildId: member.guild.id,
        });
    });
}

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;
    if (!message.reference) return;

    try {
        const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
        if (repliedTo.author.id === client.user.id && repliedTo.attachments.size > 0) {
            const attachment = repliedTo.attachments.first();
            if (attachment.name.endsWith('.txt')) {
                await message.channel.sendTyping();
                const response = await axios.get(attachment.url);
                const transcriptContent = response.data;
                const userQuestion = message.content;

                client.queue.add('answer-question', {
                    transcript: transcriptContent,
                    question: userQuestion,
                    replyChannelId: message.channel.id,
                    replyMessageId: message.id,
                });
            }
        }
    } catch (error) {
        console.error('[Q&A-INDEX] Error processing reply:', error);
    }
});

client.login(process.env.DISCORD_TOKEN);