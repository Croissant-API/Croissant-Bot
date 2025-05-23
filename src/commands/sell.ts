/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChatInputCommandInteraction, SlashCommandBuilder, AutocompleteInteraction } from 'discord.js';
import { emojis, genKey } from '../utils';
import { CroissantAPI, Item } from '../libs/croissant-api';
import { config } from 'dotenv';
import path from 'path';
config({ path: path.join(__dirname,'../../.env') }); // Load environment variables from .env file

module.exports = {
    name: 'sell',
    data: new SlashCommandBuilder()
        .setName('sell')
        .setDescription('Sell an item from the store!')
        .addStringOption(option =>
            option.setName('itemid')
                .setDescription('The ID of the item to buy')
                .setRequired(true)
                .setAutocomplete(true) // Enable autocomplete
        )
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('The amount to buy')
                .setRequired(false)
        ),
    async autocomplete(interaction: AutocompleteInteraction, croissantAPI: CroissantAPI) {
        const focusedValue = interaction.options.getFocused();
        let items: Item[];
        try {
            items = await croissantAPI.items.list() as Item[];
        } catch {
            // fallback: no suggestions
            return interaction.respond([]);
        }
        const filtered = items
            .filter((item: Item) =>
                item.name && 
                (item.name.toLowerCase().includes(focusedValue.toLowerCase()) ||
                item.itemId.toLowerCase().includes(focusedValue.toLowerCase()))
            )
            .slice(0, 25)
            .map((item: Item) => ({
                name: item.name,
                value: item.itemId
            }));
        await interaction.respond(filtered);
    },
    async execute(interaction: ChatInputCommandInteraction, croissantAPI: CroissantAPI) {
        const itemId = interaction.options.getString('itemid');
        const amount = Math.abs(interaction.options.getInteger('amount') || 1);

        if (!itemId || isNaN(amount) || amount <= 0 || amount > 1000) {
            await interaction.reply({
                content: 'Invalid item ID or amount (must be 1-1000).',
                ephemeral: true
            });
            return;
        }

        const items = await croissantAPI.items.list() as Item[];
        const item = items.find((item: Item) => item.itemId === itemId || item.name === itemId);
        // console.log('Item:', item);
        if (!item) {
            await interaction.reply({
                content: 'Item not found.',
                ephemeral: true
            });
            return;
        }

        // Get API token for the user (implement getToken in utils)
        const token = await genKey(interaction.user.id);
        if (!token) {
            await interaction.reply({
                content: 'You are not authenticated. Please link your account.',
                ephemeral: true
            });
            return;
        }

        // Try to sell the item via API
        try {
            // Ask for confirmation before selling the item
            const confirmMessage = await interaction.reply({
                content: `Are you sure you want to sell \`${item.name}\` for ${item.price * amount} ${emojis.credits}?`,
                components: [
                    {
                        type: 1,
                        components: [
                            {
                                type: 2,
                                label: 'Confirm',
                                style: 3,
                                custom_id: 'confirm_sell'
                            },
                            {
                                type: 2,
                                label: 'Cancel',
                                style: 2,
                                custom_id: 'cancel_sell'
                            }
                        ]
                    }
                ],
                ephemeral: true,
                fetchReply: true
            });

            // Create a collector for the confirmation buttons
            const filter = (i: any) =>
                i.user.id === interaction.user.id &&
                (i.customId === 'confirm_sell' || i.customId === 'cancel_sell');

            const collector = confirmMessage.createMessageComponentCollector({ filter, time: 15000, max: 1 });

            collector.on('collect', async (i: any) => {
                if (i.customId === 'confirm_sell') {
                    try {
                        // Use CroissantAPI to sell the item
                        const sellRes = await croissantAPI.items.sell(item.itemId, amount);

                        if (!sellRes || sellRes.message?.toLowerCase().includes("error")) {
                            await i.update({
                                content: sellRes?.message || 'Failed to sell item.',
                                components: []
                            });
                            return;
                        }

                        await i.update({
                            content: `Successfully sold \`${item.name}\` for ${item.price * amount} ${emojis.credits}!`,
                            components: []
                        });
                    } catch (err: Error | unknown) {
                        console.error('Error while selling item:', err);
                        await i.update({
                            content: 'Failed to sell item.',
                            components: []
                        });
                    }
                } else {
                    await i.update({
                        content: 'Sell cancelled.',
                        components: []
                    });
                }
            });

            collector.on('end', async (collected: any) => {
                if (collected.size === 0) {
                    await interaction.editReply({
                        content: 'No response. Sell cancelled.',
                        components: []
                    });
                }
            });
        } catch (err: Error | unknown) {
            console.error('Error while selling item:', err);
            await interaction.reply({
                content: 'Error while selling item. Please try again later.',
                ephemeral: true
            });
        }
    }
};