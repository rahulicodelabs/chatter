import type { SupabaseClient } from "@supabase/supabase-js";

/** A photo picked by the user, ready for preview + upload. */
export type ChatImage = {
  /** What gets uploaded (the original, or a re-encoded version if huge). */
  file: Blob;
  /** Local data URL for the composer preview and the optimistic bubble. */
  dataUrl: string;
  /** Natural dimensions — used for display aspect ratio. */
  width: number;
  height: number;
  /** Extension for the storage path. */
  ext: string;
};

const MAX_STORE_BYTES = 5 * 1024 * 1024; // re-encode above this
const MAX_PICK_BYTES = 10 * 1024 * 1024; // reject above this
const MAX_DIMENSION = 1920; // longest edge after re-encode

/**
 * Validate + read a picked image: dimensions, data URL for previews, and a
 * shrunken re-encode when the file is too big to store as-is.
 */
export async function loadChatImage(input: File): Promise<ChatImage> {
  if (!input.type.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }
  if (input.size > MAX_PICK_BYTES) {
    throw new Error("That photo is too large (max 10 MB).");
  }

  const { dataUrl, width, height } = await readImage(input);

  let file: Blob = input;
  if (input.size > MAX_STORE_BYTES) {
    const smaller = await shrink(dataUrl, width, height, input.type);
    if (smaller) file = smaller;
  }

  return { file, dataUrl, width, height, ext: extFor(file.type || input.type) };
}

/** Upload to the public `attachments` bucket under the sender's own folder. */
export async function uploadChatPhoto(
  supabase: SupabaseClient,
  userId: string,
  image: ChatImage
): Promise<{ url: string; width: number; height: number }> {
  const path = `${userId}/${crypto.randomUUID()}.${image.ext}`;
  const { error } = await supabase.storage
    .from("attachments")
    .upload(path, image.file, {
      contentType: image.file.type || "image/jpeg",
      upsert: false,
    });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);

  const { data } = supabase.storage.from("attachments").getPublicUrl(path);
  return { url: data.publicUrl, width: image.width, height: image.height };
}

function readImage(
  file: File
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that photo."));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const probe = new Image();
      probe.onload = () => {
        if (!probe.naturalWidth || !probe.naturalHeight) {
          reject(new Error("Couldn't read that photo."));
          return;
        }
        resolve({
          dataUrl,
          width: probe.naturalWidth,
          height: probe.naturalHeight,
        });
      };
      probe.onerror = () =>
        reject(new Error("Couldn't decode that photo — try a JPG or PNG."));
      probe.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/** Re-encode oversized photos through a canvas (max longest edge, q≈0.85). */
function shrink(
  dataUrl: string,
  width: number,
  height: number,
  mime: string
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
        const w = Math.max(1, Math.round(width * scale));
        const h = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const outMime =
          mime === "image/png" || mime === "image/webp" ? mime : "image/jpeg";
        canvas.toBlob((blob) => resolve(blob), outMime, 0.85);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function extFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/svg+xml") return "svg";
  return "jpg";
}
