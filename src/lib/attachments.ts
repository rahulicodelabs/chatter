import type { SupabaseClient } from "@supabase/supabase-js";
import type { Message } from "@/lib/types";

/**
 * Pick limit for chat attachments. Supabase Storage caps files at 50 MB on
 * the free tier, so both images and videos stop there.
 */
export const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

/** An image or video picked by the user, ready for preview + upload. */
export type ChatAttachment = {
  kind: "image" | "video";
  /** What gets uploaded (the original, or a re-encoded image if huge). */
  file: Blob;
  /**
   * Local URL for the composer preview and the optimistic bubble:
   * a data URL for images, an object URL for videos (revoke when done).
   */
  previewUrl: string;
  /** Natural dimensions — used for display aspect ratio (null if unknown). */
  width: number | null;
  height: number | null;
  /** Extension for the storage path. */
  ext: string;
  /** Original file name + size, for the composer chip. */
  name: string;
  size: number;
};

const MAX_STORE_BYTES = 5 * 1024 * 1024; // re-encode images above this
const MAX_DIMENSION = 1920; // longest edge after re-encode

/**
 * Validate + read a picked image or video.
 *
 * Images are read into a data URL (and re-encoded when huge); videos are
 * never loaded into memory — we keep a blob URL and probe metadata only.
 */
export async function loadChatAttachment(input: File): Promise<ChatAttachment> {
  if (input.type.startsWith("video/")) return loadVideo(input);
  return loadImage(input);
}

async function loadImage(input: File): Promise<ChatAttachment> {
  if (!input.type.startsWith("image/")) {
    throw new Error("Please choose an image or video file.");
  }
  if (input.size > ATTACHMENT_MAX_BYTES) {
    throw new Error("That photo is too large (max 50 MB).");
  }

  const { dataUrl, width, height } = await readImage(input);

  let file: Blob = input;
  if (input.size > MAX_STORE_BYTES) {
    const smaller = await shrink(dataUrl, width, height, input.type);
    if (smaller) file = smaller;
  }

  return {
    kind: "image",
    file,
    previewUrl: dataUrl,
    width,
    height,
    ext: imageExtFor(file.type || input.type),
    name: input.name,
    size: input.size,
  };
}

async function loadVideo(input: File): Promise<ChatAttachment> {
  if (!input.type.startsWith("video/")) {
    throw new Error("Please choose an image or video file.");
  }
  if (input.size > ATTACHMENT_MAX_BYTES) {
    throw new Error("That video is too large (max 50 MB).");
  }

  // Keep videos out of memory: preview from a blob URL, dimensions from
  // metadata (missing metadata is fine — we fall back to a default box).
  const previewUrl = URL.createObjectURL(input);
  const { width, height } = await probeVideo(previewUrl);

  return {
    kind: "video",
    file: input,
    previewUrl,
    width,
    height,
    ext: videoExtFor(input.type),
    name: input.name,
    size: input.size,
  };
}

/** Upload to the public `attachments` bucket under the sender's own folder. */
export async function uploadChatAttachment(
  supabase: SupabaseClient,
  userId: string,
  attachment: ChatAttachment
): Promise<{ url: string; width: number | null; height: number | null }> {
  const path = `${userId}/${crypto.randomUUID()}.${attachment.ext}`;
  const { error } = await supabase.storage
    .from("attachments")
    .upload(path, attachment.file, {
      contentType: attachment.file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) {
    throw new Error(
      `${attachment.kind === "video" ? "Video" : "Photo"} upload failed: ${error.message}`
    );
  }

  const { data } = supabase.storage.from("attachments").getPublicUrl(path);
  return { url: data.publicUrl, width: attachment.width, height: attachment.height };
}

/** Release a blob URL once its attachment is sent or discarded. */
export function revokeAttachment(attachment: ChatAttachment): void {
  if (attachment.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

/**
 * Video URLs have a video extension; everything else (photos, data/blob
 * previews) is an image. Messages created in this session carry an explicit
 * `video` flag, so optimistic bubbles render correctly too.
 */
export function isVideoMessage(message: Pick<Message, "image_url" | "video">): boolean {
  if (message.video !== undefined) return message.video;
  return isVideoUrl(message.image_url);
}

function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\.(mp4|webm|mov|m4v|ogv|avi|mkv)([?#].*)?$/i.test(url);
}

function probeVideo(url: string): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () =>
      resolve({
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      });
    video.onerror = () => resolve({ width: null, height: null });
    video.src = url;
  });
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

function imageExtFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/svg+xml") return "svg";
  return "jpg";
}

function videoExtFor(mime: string): string {
  if (mime === "video/webm") return "webm";
  if (mime === "video/quicktime") return "mov";
  if (mime === "video/x-m4v") return "m4v";
  if (mime === "video/ogg") return "ogv";
  return "mp4";
}
