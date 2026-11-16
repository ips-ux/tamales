import { Maximize2, Printer, X } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import { printElement } from "./admin/print";

interface QRCodePanelProps {
  url: string;
  eventName: string;
  title?: string;
  alt?: string;
  /** True adds a Print button. The printed page is a table sign: the title, the event name and the QR code. */
  printable?: boolean;
}

export function QRCodePanel({ url, eventName, title = "Scan to Order", alt, printable = false }: QRCodePanelProps) {
  const [dataUrl, setDataUrl] = useState("");
  const [fullScreen, setFullScreen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const shortUrl = useMemo(() => url.replace(/^https?:\/\//, ""), [url]);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(url, {
      margin: 2,
      width: 520,
      color: {
        dark: "#171311",
        light: "#fff7ea"
      }
    }).then((value) => {
      if (active) setDataUrl(value);
    });
    return () => {
      active = false;
    };
  }, [url]);

  return (
    <div className={fullScreen ? "qr-panel qr-panel-fullscreen" : "qr-panel"} ref={panelRef}>
      <div className="qr-header">
        <div className="brand-lockup">
          <img className="brand-logo" src="/media/logo1.webp" alt="" />
          <span>
            <strong>{title}</strong>
            <small>{eventName}</small>
          </span>
        </div>
        <div className="qr-actions">
          {printable && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Print the sign: ${title}`}
              disabled={!dataUrl}
              onClick={() => printElement(panelRef.current)}
            >
              <Printer size={22} />
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={fullScreen ? "Close full-screen QR" : "Open full-screen QR"}
            onClick={() => setFullScreen((value) => !value)}
          >
            {fullScreen ? <X size={22} /> : <Maximize2 size={22} />}
          </button>
        </div>
      </div>
      {dataUrl && <img className="qr-image" src={dataUrl} alt={alt ?? `QR code for ${eventName}`} />}
      <p className="fallback-url">{shortUrl}</p>
    </div>
  );
}
