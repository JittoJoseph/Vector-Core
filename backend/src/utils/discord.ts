import { createModuleLogger } from "./logger.js";
import { getConfig } from "./config.js";

const logger = createModuleLogger("discord");

export async function notifyDiscordEntry(params: {
  campaignTitle: string;
  bucketTitle: string;
  entryPrice: string;
  shares: string;
  cost: string;
}) {
  const webhookUrl = getConfig().notifications.discordWebhookUrl;
  if (!webhookUrl) return;

  try {
    const embed = {
      title: "New Position Entered",
      color: 0x3498db, // Blue
      fields: [
        {
          name: "Campaign",
          value: params.campaignTitle,
          inline: false,
        },
        {
          name: "Bucket",
          value: params.bucketTitle,
          inline: true,
        },
        {
          name: "Entry Price",
          value: params.entryPrice,
          inline: true,
        },
        {
          name: "Shares",
          value: params.shares,
          inline: true,
        },
        {
          name: "Total Cost",
          value: params.cost,
          inline: true,
        },
      ],
      timestamp: new Date().toISOString(),
    };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        embeds: [embed],
      }),
    });

    if (!response.ok) {
      logger.error(
        { status: response.status, text: await response.text() },
        "Discord webhook failed",
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to send Discord webhook");
  }
}
