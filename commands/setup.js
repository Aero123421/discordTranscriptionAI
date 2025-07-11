const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Sets up the transcription bot for this server.')
        .addChannelOption(option =>
            option.setName('category')
                .setDescription('The category of voice channels to monitor.')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildCategory))
        .addChannelOption(option =>
            option.setName('output')
                .setDescription('The text channel to post transcripts in.')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        const category = interaction.options.getChannel('category');
        const outputChannel = interaction.options.getChannel('output');

        const config = {
            targetCategoryId: category.id,
            outputChannelId: outputChannel.id,
            geminiModel: 'gemini-2.5-flash', // Default model
        };

        const configPath = path.join(__dirname, `../config_${interaction.guild.id}.json`);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        await interaction.reply({
            content: `Bot setup complete! I will now monitor voice channels in the **${category.name}** category and post transcripts to **#${outputChannel.name}**.`,
            ephemeral: true,
        });
    },
};
