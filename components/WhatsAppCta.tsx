import QRCode from "qrcode";
import { WHATSAPP_NUMBER, getWhatsAppLink } from "@/lib/whatsapp";
import styles from "./WhatsAppCta.module.css";

export async function WhatsAppCta() {
  if (!WHATSAPP_NUMBER) return null;

  const link = getWhatsAppLink();
  const qrSvg = await QRCode.toString(link, {
    type: "svg",
    margin: 1,
    color: { dark: "#14161a", light: "#0000" },
  });

  return (
    <section className={styles.wrap} aria-label="Use on WhatsApp">
      <h2 className={styles.heading}>Use it on WhatsApp</h2>
      <p className={styles.copy}>
        Scan to add the assistant as a contact, then call it or send a voice note — same agent,
        same answers.
      </p>
      <div className={styles.qr} dangerouslySetInnerHTML={{ __html: qrSvg }} aria-hidden="true" />
      <a className={styles.link} href={link} target="_blank" rel="noreferrer">
        Open in WhatsApp instead →
      </a>
    </section>
  );
}
