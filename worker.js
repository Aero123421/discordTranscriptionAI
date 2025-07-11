require('dotenv').config();
const path = require('node:path');
const fs = require('node:fs');
const { defineWorker, defineQueue, better } = require('./lib/queue');
const Database = require('better-sqlite3');
const { spawn } = require('node:child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } = require('discord.js');

// --- Job Queue Setup ---
const dbPath = path.join(__dirname, 'db', 'queue.sqlite');
const db = new Database(dbPath);
const connection = better(db);
const queue = defineQueue({ connection });

// --- Gemini AI Setup ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- Discord Client for Posting ---
const discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });
discordClient.login(process.env.DISCORD_TOKEN);
discordClient.once('ready', () => console.log('Worker Discord client is ready.'));

// --- Session Transcript Aggregator ---
const sessionTranscripts = new Map();

// --- Transcribe Worker ---
defineWorker('transcribe', async (job) => {
    const { pcmPath, userId, sessionId, outputChannelId, guildId } = job.data;
    console.log(`[WORKER] Transcribing ${pcmPath}`);

    try {
        const wavPath = pcmPath.replace('.pcm', '.wav');

        // Convert PCM to WAV using FFmpeg
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', pcmPath,
                wavPath
            ]);
            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    fs.unlink(pcmPath, () => resolve());
                } else {
                    fs.unlink(pcmPath, () => reject(new Error(`FFmpeg exited with code ${code}`)));
                }
            });
        });

        // Transcribe WAV using Python script
        const transcriptText = await new Promise((resolve, reject) => {
            const pythonProcess = spawn('python', [path.join(__dirname, 'transcribe.py'), wavPath]);
            let stdout = '';
            pythonProcess.stdout.on('data', (data) => stdout += data.toString());
            pythonProcess.stderr.on('data', (data) => console.error(`[PYTHON STDERR] ${data}`));
            pythonProcess.on('close', (code) => {
                fs.unlink(wavPath, () => {});
                if (code === 0) {
                    resolve(stdout.trim());
                }
                else {
                    reject(new Error(`Python script exited with code ${code}`));
                }
            });
        });

        if (!transcriptText) {
            console.log(`[WORKER] No transcript generated for ${wavPath}.`);
            return;
        }

        // Aggregate transcripts by session
        if (!sessionTranscripts.has(sessionId)) {
            sessionTranscripts.set(sessionId, []);
        }
        const guild = await discordClient.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        const displayName = member.displayName;

        sessionTranscripts.get(sessionId).push({
            user: displayName,
            text: transcriptText,
            timestamp: new Date()
        });

    } catch (error) {
        console.error(`[WORKER ERROR] Failed to process ${pcmPath}:`, error);
        throw error;
    }
}, { queue });


defineWorker('finalize', async (job) => {
    const { sessionId, outputChannelId, guildId } = job.data;
    await finalizeSession(sessionId, outputChannelId, guildId);
}, { queue });

// Q&A Worker
defineWorker('answer-question', async (job) => {
    const { transcript, question, replyChannelId, replyMessageId, guildId } = job.data;
    console.log(`[Q&A] Answering question for message ${replyMessageId}`);

    try {
        const configPath = path.join(__dirname, `config_${guildId}.json`);
        const config = fs.existsSync(configPath)
            ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
            : {};
        const modelName = config.geminiModel || 'gemini-2.5-flash';
        const model = genAI.getGenerativeModel({ model: modelName });

        const prompt = `Based on the following document, please answer the user's question. The answer must be based solely on the provided document. If the answer is not found in the document, state that clearly.\n\nDocument:\n---\n${transcript}\n---\n\nUser Question: ${question}`

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const answer = response.text();

        const channel = await discordClient.channels.fetch(replyChannelId);
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle('Question & Answer')
                .setDescription(answer)
                .addFields(
                    { name: 'Original Question', value: question }
                )
                .setColor(0x4285F4)
                .setTimestamp();
            await channel.messages.reply(replyMessageId, { embeds: [embed] });
        }
    } catch (error) {
        console.error(`[Q&A ERROR]`, error);
        throw error;
    }
}, { queue });

async function finalizeSession(sessionId, channelId, guildId) {
    const transcripts = sessionTranscripts.get(sessionId);
    if (!transcripts || transcripts.length === 0) {
        console.log(`[FINALIZE] No transcripts to finalize for session ${sessionId}`);
        return;
    }

    const fullText = transcripts.map(t => `${t.user}: ${t.text}`).join('\n');
    console.log(`[FINALIZE] Finalizing transcript for session ${sessionId}`);

    try {
        const configPath = path.join(__dirname, `config_${guildId}.json`);
        const config = fs.existsSync(configPath)
            ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
            : {};
        const modelName = config.geminiModel || 'gemini-2.5-flash';
        const model = genAI.getGenerativeModel({ model: modelName });

        const prompt = `You are an expert meeting summarizer. Please format the following raw transcript into a clean, readable document. Correct any spelling or grammar mistakes, remove filler words, and structure the conversation logically. The output must be a JSON object with the keys "title", "summary", "keywords", and "full_transcript".\n\nRaw Transcript:\n---\n${fullText}\n---\n`;

        const result = await model.generateContent(prompt);
        const response = result.response;
        const jsonText = response.text().match(/```json\n([\s\S]*?)\n```|{\s*"title":.*}/)[1] || response.text();
        const data = JSON.parse(jsonText);

        const channel = await discordClient.channels.fetch(channelId);
        if (channel) {
            const txtFile = Buffer.from(data.full_transcript, 'utf-8');
            const attachment = new AttachmentBuilder(txtFile, { name: `${data.title.replace(/\s/g, '_')}.txt` });
            const embed = new EmbedBuilder()
                .setTitle(data.title)
                .setDescription(data.summary)
                .addFields({ name: 'Keywords', value: data.keywords.join(', ') })
                .setColor(0x0099FF)
                .setTimestamp();

            await channel.send({ embeds: [embed], files: [attachment] });
        }
        sessionTranscripts.delete(sessionId); // Clean up memory
    } catch (error) {
        console.error(`[FINALIZE ERROR] Failed to finalize session ${sessionId}:`, error);
    }
}

console.log('Worker process started.');

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down worker...');
    // Any cleanup logic here
    process.exit(0);
});