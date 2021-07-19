import { PostMetadata } from "./types";

function galleryStart(ln: string) {
  const galleryRegex = /^\[gallery\]/gi;
  const match = galleryRegex.exec(ln);
  return !!match && !!match.length;
}

function galleryEnd(ln: string) {
  const galleryRegex = /\[\/gallery\]/gi;
  const match = galleryRegex.exec(ln);
  return !!match && !!match.length;
}

function getImagePath(ln: string) {
  const imgMdRegex = /\-\s+\[(.*)\]\((.+)\)/gi;
  const match = imgMdRegex.exec(ln);
  if (!match || !match.length) {
    return undefined;
  }

  return match[2];
}

function getGalleryImagesFromMD(content: string) {
  const lines = content.split(/\r?\n/);

  let isInGallery = false;
  const imgs: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (galleryStart(line)) {
      isInGallery = true;
      continue;
    }

    if (galleryEnd(line)) {
      isInGallery = false;
      continue;
    }

    if (isInGallery) {
      const img = getImagePath(line);

      if (img) {
        imgs.push(img);
      }
    }
  }

  return imgs.filter((o) => !!o);
}

export function getGalleryImages(posts: PostMetadata[]): string[] {
  let imgs = posts.map((p) => getGalleryImagesFromMD(p.content));
  return [].concat.apply([], imgs);
}
