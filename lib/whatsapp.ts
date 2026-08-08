const RAW_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "";

export const WHATSAPP_NUMBER = RAW_NUMBER;

export const WHATSAPP_PROMPT_TEXT =
  "Hi, I'd like help with a UAE government service — can I call or send a voice note?";

export function getWhatsAppLink(prefillText: string = WHATSAPP_PROMPT_TEXT): string {
  const digits = RAW_NUMBER.replace(/[^\d]/g, "");
  const base = `https://wa.me/${digits}`;
  return prefillText ? `${base}?text=${encodeURIComponent(prefillText)}` : base;
}
