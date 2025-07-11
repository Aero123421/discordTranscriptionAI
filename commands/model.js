const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('model')
        .setDescription('Changes the Gemini model used for summarization.')
        .addStringOption(option =>
            option.setName('model')
                .setDescription('The Gemini model to use.')
                .setRequired(true)
                .addChoices(
                    { name: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
                    { name: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
                ))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        const model = interaction.options.getString('model');
        const configPath = path.join(__dirname, `../config_${interaction.guild.id}.json`);

        if (!fs.existsSync(configPath)) {
            return interaction.reply({ content: 'Setup has not been run for this server.', ephemeral: true });
        }

        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        config.geminiModel = model;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        await interaction.reply({
            content: `Gemini model has been set to **${model}**.`,
            ephemeral: true,
        });
    },
};