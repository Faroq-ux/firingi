/** Campaign channels: label and icon. Shared by server pages and client forms (not a client module). */
import { Bell, Mail, MessageCircle, MessageSquare, Smartphone } from "lucide-react";

export type CampaignChannel = "EMAIL" | "PUSH" | "IN_APP" | "SMS" | "WHATSAPP";
export const CHANNEL_INFO: Record<CampaignChannel, { label: string; icon: typeof Mail }> = {
  EMAIL: { label: "E-mail", icon: Mail }, PUSH: { label: "Push", icon: Smartphone }, IN_APP: { label: "In-app (bell)", icon: Bell }, SMS: { label: "SMS", icon: MessageSquare }, WHATSAPP: { label: "WhatsApp", icon: MessageCircle },
};
