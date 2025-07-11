const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('finalize')
        .setDescription('Manually finalizes the transcription for a session.')
        .addStringOption(option =>
            option.setName('session_id')
                .setDescription('The ID of the session to finalize.')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        const sessionId = interaction.options.getString('session_id');
        const { queue } = interaction.client;

        const configPath = path.join(__dirname, `../config_${interaction.guild.id}.json`);
        if (!fs.existsSync(configPath)) {
            return interaction.reply({ content: 'Setup has not been run for this server.', ephemeral: true });
        }
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        queue.add('finalize', { 
            sessionId: sessionId, 
            outputChannelId: config.outputChannelId,
            guildId: interaction.guild.id
        });

        await interaction.reply({ content: `Queued finalization for session `${sessionId}`.`, ephemeral: true });
    },
};
