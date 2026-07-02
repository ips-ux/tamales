import { Camera, ImagePlus } from "lucide-react";
import { ChangeEvent, useRef, useState } from "react";

interface ImagePickerProps {
  value: string;
  onChange: (dataUrl: string) => void;
  label?: string;
}

// Images are stored as data URLs inside the menu item itself (no Firebase
// Storage on the Spark plan), so they must be compressed to fit comfortably
// inside Firestore's 1 MiB document limit alongside the rest of the fields.
const TARGET_MAX_CHARS = 700_000;
const PASSES = [
  { maxDimension: 1024, quality: 0.82 },
  { maxDimension: 800, quality: 0.7 },
  { maxDimension: 640, quality: 0.55 }
];

async function compressImage(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that image."));
      el.src = objectUrl;
    });

    let result = "";
    for (const pass of PASSES) {
      const scale = Math.min(1, pass.maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not process the image in this browser.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      result = canvas.toDataURL("image/jpeg", pass.quality);
      if (result.length <= TARGET_MAX_CHARS) return result;
    }
    return result;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function ImagePicker({ value, onChange, label = "Photo" }: ImagePickerProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That file is not an image.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onChange(await compressImage(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that image.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="image-picker">
      <span className="image-picker-label">{label}</span>
      {value && <img className="admin-thumb image-picker-preview" src={value} alt="Menu item preview" />}
      <div className="image-picker-actions">
        <button
          className="button button-small"
          type="button"
          disabled={busy}
          onClick={() => cameraInputRef.current?.click()}
        >
          <Camera size={16} />
          Take Photo
        </button>
        <button
          className="button button-small"
          type="button"
          disabled={busy}
          onClick={() => galleryInputRef.current?.click()}
        >
          <ImagePlus size={16} />
          Choose Image
        </button>
      </div>
      {busy && <p className="muted">Preparing photo…</p>}
      {error && <p className="muted">{error}</p>}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={handleFile}
      />
      <input ref={galleryInputRef} type="file" accept="image/*" hidden onChange={handleFile} />
    </div>
  );
}
