<?php
// send_profile_photos.php

$nodeScript = __DIR__ . '/whatsapp_bot.js';
$groupName  = $_GET['group'] ?? 'YOUR_GROUP_NAME_HERE'; // <-- change this

if (!file_exists($nodeScript)) {
    die("❌ whatsapp_bot.js not found.");
}

$command = "node " . escapeshellarg($nodeScript) . " " . escapeshellarg($groupName) . " 2>&1";
$output  = shell_exec($command);

echo "<pre>" . htmlspecialchars($output) . "</pre>";
?>
