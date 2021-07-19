export type PostTag = {
  id: string;
  name: string;
};

export type PostCategory = {
  id: string;
  name: string;
};

export type PostMetadata = {
  title: string;
  date: string;
  tags: PostTag[];
  categories: PostCategory[];
  image: string;
  slug: string;
  description: string;
  content: string;
};

export type Tag = PostTag & {
  slugs: string[];
};

export type Category = PostCategory & {
  slugs: string[];
};

export type ImageResolution = {
  width: number;
  aspectRatio?: string;
  quality?: number;
  fit?: "fill" | "contain" | "cover" | "inside" | "outside";
};

export type ImageResolutions = {
  postThumbnail?: ImageResolution;
  contentImage?: ImageResolution;
  galleryThumbnail?: ImageResolution;
  galleryImage?: ImageResolution;
};

export type ContentConfig = {
  contentsFolder: string;
  pagesFolder: string;
  postsFolder: string;
  publicFolder: string;
  themeImageResolutions: Record<string, ImageResolutions>;
};

export type FtpConfig = {
  host: string;
  user: string;
  password: string;
  secure: boolean;
  uploadPath: string;
};

export type ImageMap = {
  from: string;
  to: string;
};
