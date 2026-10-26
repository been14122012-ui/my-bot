const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID; // Tùy chọn: ID server để đăng ký lệnh nhanh hơn

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// userId -> danh sách ID kênh, giữ tạm từ lúc gõ lệnh đến khi submit modal
const pendingChannels = new Map();

const tinnhanCommand = new SlashCommandBuilder()
  .setName('tinnhan')
  .setDescription('[Admin] Gửi tin nhắn tới một hoặc nhiều kênh')
  .addStringOption((option) =>
    option
      .setName('kenh')
      .setDescription('Các kênh nhận tin, cách nhau bằng khoảng trắng (chọn #kênh hoặc dán ID)')
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

// Lấy các ID kênh (chấp nhận <#id> hoặc ID thô), bỏ trùng lặp
function parseChannelIds(text) {
  return [...new Set(text.match(/\d{15,20}/g) ?? [])];
}

client.once('ready', async () => {
  const commands = [tinnhanCommand.toJSON()];
  if (GUILD_ID) {
    await client.application.commands.set(commands, GUILD_ID);
  } else {
    await client.application.commands.set(commands);
  }
  console.log(`Đã đăng nhập: ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  // 1. Lệnh /tinnhan: kiểm tra quyền rồi mở modal nhập nội dung
  if (interaction.isChatInputCommand() && interaction.commandName === 'tinnhan') {
    // Kiểm tra quyền lần 2 phía server, vì setDefaultMemberPermissions chỉ là gợi ý giao diện
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: 'Chỉ admin mới được dùng lệnh này.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const ids = parseChannelIds(interaction.options.getString('kenh'));
    if (ids.length === 0) {
      return interaction.reply({
        content: 'Không tìm thấy kênh hợp lệ. Hãy chọn #kênh hoặc dán ID kênh.',
        flags: MessageFlags.Ephemeral,
      });
    }

    pendingChannels.set(interaction.user.id, ids);

    const input = new TextInputBuilder()
      .setCustomId('noi_dung')
      .setLabel('Nội dung')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Nhập nội dung sẽ được gửi tới các kênh đã chọn...')
      .setMaxLength(2000)
      .setRequired(true);

    const modal = new ModalBuilder()
      .setCustomId('tinnhan_modal')
      .setTitle('Nội dung tin nhắn')
      .addComponents(new ActionRowBuilder().addComponents(input));

    return interaction.showModal(modal);
  }

  // 2. Modal submit: gửi nội dung tới từng kênh
  if (interaction.isModalSubmit() && interaction.customId === 'tinnhan_modal') {
    const ids = pendingChannels.get(interaction.user.id);
    pendingChannels.delete(interaction.user.id);

    if (!ids) {
      return interaction.reply({
        content: 'Phiên đã hết hạn, hãy dùng lại /tinnhan.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const content = interaction.fields.getTextInputValue('noi_dung');
    const thanhCong = [];
    const thatBai = [];

    for (const cid of ids) {
      try {
        const channel =
          client.channels.cache.get(cid) ?? (await client.channels.fetch(cid));

        // Chỉ gửi vào kênh thuộc cùng server với lệnh
        if (!channel || channel.guildId !== interaction.guildId) {
          thatBai.push(`\`${cid}\` (không thuộc server này)`);
          continue;
        }
        if (typeof channel.send !== 'function') {
          thatBai.push(`\`${cid}\` (không phải kênh chat)`);
          continue;
        }

        // Không cho @everyone / @here / role ping ngoài ý muốn
        await channel.send({
          content,
          allowedMentions: { parse: ['users'] },
        });
        thanhCong.push(`<#${cid}>`);
      } catch (err) {
        if (err.code === 10003) {
          thatBai.push(`\`${cid}\` (không tìm thấy kênh)`);
        } else if (err.code === 50001 || err.code === 50013) {
          thatBai.push(`<#${cid}> (bot không có quyền gửi)`);
        } else {
          thatBai.push(`\`${cid}\` (lỗi: ${err.message})`);
        }
      }
    }

    const lines = [];
    if (thanhCong.length) lines.push(`✅ Đã gửi tới: ${thanhCong.join(', ')}`);
    if (thatBai.length) {
      lines.push('❌ Không gửi được:');
      lines.push(...thatBai.map((x) => `- ${x}`));
    }

    return interaction.editReply(lines.join('\n') || 'Không có kết quả.');
  }
});

client.login(TOKEN);
