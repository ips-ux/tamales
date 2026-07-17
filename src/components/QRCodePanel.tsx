import { Maximize2, X } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";

interface QRCodePanelProps {
  url: string;
  eventName: string;
  title?: string;
  alt?: string;
}

export function QRCodePanel({ url, eventName, title = "Scan to Order", alt }: QRCodePanelProps) {
  const [dataUrl, setDataUrl] = useState("");
  const [fullScreen, setFullScreen] = useState(false);
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
    <div className={fullScreen ? "qr-panel qr-panel-fullscreen" : "qr-panel"}>
      <div className="qr-header">
        <div className="brand-lockup">
          <img className="brand-logo" src="/media/logo1.webp" alt="" />
          <span>
            <strong>{title}</strong>
            <small>{eventName}</small>
          </span>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={fullScreen ? "Close full-screen QR" : "Open full-screen QR"}
          onClick={() => setFullScreen((value) => !value)}
        >
          {fullScreen ? <X size={22} /> : <Maximize2 size={22} />}
        </button>
      </div>
      {dataUrl && <img className="qr-image" src={dataUrl} alt={alt ?? `QR code for ${eventName}`} />}
      <p className="fallback-url">{shortUrl}</p>
    </div>
  );
}
