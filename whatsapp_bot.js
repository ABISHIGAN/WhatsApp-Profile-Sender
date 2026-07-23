// whatsapp_bot.js
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const groupId = process.argv[2];
if (!groupId) {
    console.error('❌ Please provide a group name. Example: node whatsapp_bot.js "My Group"');
    process.exit(1);
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        protocolTimeout: 60000
    }
});

// Show QR code in terminal for scanning
client.on('qr', (qr) => {
    console.log('\n📱 Scan this QR code with your WhatsApp:\n');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('✅ Authenticated successfully!');
});

client.on('ready', async () => {
    console.log('🚀 WhatsApp client is ready!\n');

    try {
        // Find the group
        const chats = await client.getChats();
        const group = chats.find(chat =>
            chat.isGroup &&
            (chat.id._serialized === groupId || chat.name.toLowerCase() === groupId.toLowerCase())
        );

        if (!group) {
            console.error(`❌ Group "${groupId}" not found.`);
            console.log('\n📋 Available groups:');
            chats.filter(c => c.isGroup).forEach(g => console.log(`  - ${g.name}`));
            await client.destroy();
            process.exit(1);
        }

        console.log(`✅ Found group: "${group.name}" (${group.participants.length} members)\n`);

        let sent = 0, skipped = 0;

        for (const participant of group.participants) {
            const contact = await client.getContactById(participant.id._serialized);
            const name = contact.pushname || contact.name || participant.id.user;

            try {
                const picUrl = await client.getProfilePicUrl(contact.id._serialized);
                if (picUrl) {
                    const media = await MessageMedia.fromUrl(picUrl, { unsafeMime: true });
                    await group.sendMessage(media, { caption: `📸 ${name}` });
                    console.log(`✅ Sent: ${name}`);
                    sent++;
                    // Small delay to avoid rate limits
                    await new Promise(r => setTimeout(r, 1500));
                } else {
                    console.log(`⚠️  No photo: ${name}`);
                    skipped++;
                }
            } catch (err) {
                console.log(`❌ Failed: ${name} — ${err.message}`);
                skipped++;
            }
        }

        console.log(`\n🎉 Done! Sent: ${sent} | Skipped: ${skipped}`);
        await client.destroy();
        process.exit(0);

    } catch (err) {
        console.error('❌ Fatal error:', err.message);
        await client.destroy();
        process.exit(1);
    }
});

client.on('auth_failure', () => {
    console.error('❌ Authentication failed. Delete the .wwebjs_auth folder and try again.');
    process.exit(1);
});

client.initialize();
