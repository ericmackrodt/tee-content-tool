#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import {
  Category,
  ContentConfig,
  FtpConfig,
  ImageMap,
  ImageResolution,
  PostMetadata,
  Tag,
} from "./types";
import { DateTime } from "luxon";
import * as fm from "front-matter";
import * as ejs from "ejs";
import * as rimraf from "rimraf";
import * as md5 from "md5";
import * as fse from "fs-extra";
import * as sharp from "sharp";
import { getContentImages } from "./images";
import { getGalleryImages } from "./gallery";
import * as yaml from "yaml";
import * as chalk from "chalk";
import * as basicftp from "basic-ftp";

const currentDir = process.cwd();

const configContent = fs.readFileSync(
  path.join(currentDir, "content-config.yaml"),
  { encoding: "utf-8" }
);
const config: ContentConfig = yaml.parse(configContent);

const ftpConfigContent = fs.readFileSync(
  path.join(currentDir, "ftp-config.yaml"),
  { encoding: "utf-8" }
);
const ftpConfig: FtpConfig = yaml.parse(ftpConfigContent);

const postsDir = path.join(currentDir, config.postsFolder);
const pagesDir = path.join(currentDir, config.pagesFolder);
const publicDir = path.join(currentDir, config.publicFolder);
const tempDir = path.join(currentDir, ".temp/");

async function processImage(data: Buffer, res: ImageResolution) {
  const fit = (res.fit || "cover") as
    | "fill"
    | "contain"
    | "cover"
    | "inside"
    | "outside";

  let image = sharp(data);
  const metadata = await image.metadata();

  const originalWidth = metadata.width || 0;
  let height = metadata.height;
  let width = metadata.width;
  if (res.aspectRatio) {
    const [w, h] = (res.aspectRatio as string)
      .split(":")
      .map((o) => parseInt(o));

    height = Math.floor((h * width) / w);
  }

  if (res.width && res.width < width) {
    width = res.width;
  }

  height = Math.floor((height * width) / originalWidth);

  image = image.resize(width, height, { fit });

  if (metadata.format === "png") {
    image = image.png({
      quality: res.quality || 100,
    });
  } else {
    image = image.jpeg({
      quality: res.quality || 100,
      chromaSubsampling: "4:4:4",
    });
  }

  return image.toBuffer();
}

async function processPostThumbnails(
  filePrefix: string,
  posts: PostMetadata[],
  res: ImageResolution
) {
  const map: ImageMap[] = [];
  for (let index = 0; index < posts.length; index++) {
    const post = posts[index];

    const tempPostDir = path.join(tempDir, config.postsFolder);
    const spl = post.image
      .split("/")
      .filter((o) => o !== config.contentsFolder);
    const imagePath = path.join(...spl);
    const buffer = fs.readFileSync(imagePath);
    const img = await processImage(buffer, res);
    const destPath = path.join(
      tempPostDir,
      post.slug,
      filePrefix + "-" + path.basename(post.image)
    );

    map.push({
      from: post.image,
      to: path.join(path.dirname(post.image), path.basename(destPath)),
    });
    fs.writeFileSync(destPath, img);
  }

  return map;
}

async function processImages(
  filePrefix: string,
  images: string[],
  res: ImageResolution
) {
  const map: ImageMap[] = [];
  for (let index = 0; index < images.length; index++) {
    const image = images[index];
    const spl = image.split("/").filter((o) => o !== config.contentsFolder);
    const imagePath = path.join(tempDir, ...spl);
    const buffer = fs.readFileSync(imagePath);

    const destPath = path.join(
      path.dirname(imagePath),
      filePrefix + "-" + path.basename(image)
    );

    map.push({
      from: image,
      to: path.join(path.dirname(image), path.basename(destPath)),
    });

    console.log(
      `${chalk.white("-")} ${chalk.blueBright(image)} ${chalk.white(
        "->"
      )} ${chalk.green(destPath)}`
    );
    const img = await processImage(buffer, res);
    fs.writeFileSync(destPath, img);
  }

  return map;
}

async function getPosts(): Promise<PostMetadata[]> {
  const posts = fs.readdirSync(postsDir);

  const promises = posts.map(
    (post) =>
      new Promise<any>((resolve, reject) => {
        const postPath = path.join(postsDir, post, "post.md");
        const exists = fs.existsSync(postPath);

        if (!exists) {
          resolve(undefined);
          return;
        }

        const content = fs.readFileSync(postPath, { encoding: "utf-8" });

        // The types for this library are wrong
        /* @ts-ignore */
        const metadata = fm<TMetadata>(content);
        resolve({
          ...metadata.attributes,
          slug: post,
          content: metadata.body,
        });
      })
  );

  return (await Promise.all(promises))
    .filter((o) => !!o)
    .sort((a, b) => {
      return (
        DateTime.fromFormat(b.date, "dd-MM-yyyy").toMillis() -
        DateTime.fromFormat(a.date, "dd-MM-yyyy").toMillis()
      );
    })
    .map((item) => {
      const categories = item.category.split(",").map((o: string) => ({
        id: md5(o.toLowerCase().trim()),
        name: o.trim(),
      }));
      const tags = item.tags.split(",").map((o: string) => ({
        id: md5(o.toLowerCase().trim()),
        name: o.toLowerCase().trim(),
      }));

      return {
        categories,
        tags,
        title: item.title,
        date: item.date,
        image:
          "/" +
          path.join(
            config.contentsFolder,
            config.postsFolder,
            item.slug,
            item.image
          ),
        slug: item.slug,
        description: item.description,
        content: item.content,
      };
    });
}

function walk(dir: string, results: string[] = []) {
  const list = fs.readdirSync(dir);
  let i = 0;

  (function next() {
    var file = list[i++];
    if (!file) return;
    file = path.resolve(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      walk(file, results);
      next();
    } else {
      if (path.extname(file) === ".md") {
        results.push(file);
      }
      next();
    }
  })();
}

async function getPages(): Promise<PostMetadata[]> {
  const pages: string[] = [];
  walk(pagesDir, pages);

  const promises = pages.map(
    (page) =>
      new Promise<any>((resolve, reject) => {
        const exists = fs.existsSync(page);

        if (!exists) {
          resolve(page);
          return;
        }

        const content = fs.readFileSync(page, { encoding: "utf-8" });

        // The types for this library are wrong
        /* @ts-ignore */
        const metadata = fm<TMetadata>(content);
        resolve({
          ...metadata.attributes,
          slug: page,
          content: metadata.body,
        });
      })
  );

  return (await Promise.all(promises))
    .filter((o) => !!o)
    .map((item) => {
      return {
        categories: [],
        tags: [],
        title: item.title,
        date: item.date,
        image: item.image,
        slug: item.slug,
        description: item.description,
        content: item.content,
      };
    });
}

function getCategories(posts: PostMetadata[]): Category[] {
  const categories: Category[] = [];
  posts.forEach((post) => {
    post.categories.forEach((cat) => {
      let category = categories.find((o) => o.id === cat.id);
      if (!category) {
        category = { ...cat, slugs: [] };
        categories.push(category);
      }
      category.slugs.push(post.slug);
    });
  });
  return categories;
}

function getTags(posts: PostMetadata[]): Tag[] {
  const tags: Tag[] = [];
  posts.forEach((post) => {
    post.tags.forEach((t) => {
      let tag = tags.find((o) => o.id === t.id);
      if (!tag) {
        tag = { ...t, slugs: [] };
        tags.push(tag);
      }
      tag.slugs.push(post.slug);
    });
  });
  return tags;
}

async function run() {
  console.log(chalk.bgWhite("Starting Process..."));
  rimraf.sync(tempDir);

  fs.mkdirSync(tempDir, { recursive: true });

  console.log(chalk.white("Creating PHP files..."));

  const posts: PostMetadata[] = await getPosts();

  const postsEjs = fs.readFileSync(
    path.join(__dirname, "../templates/posts.ejs"),
    { encoding: "utf-8" }
  );

  const renderedPosts = ejs.render(postsEjs, { posts });

  fs.writeFileSync(path.join(tempDir, "posts.php"), renderedPosts);

  const categories = getCategories(posts);

  const categoriesEjs = fs.readFileSync(
    path.join(__dirname, "../templates/categories.ejs"),
    { encoding: "utf-8" }
  );

  const renderedCategories = ejs.render(categoriesEjs, { categories });

  fs.writeFileSync(path.join(tempDir, "categories.php"), renderedCategories);

  const tags = getTags(posts);

  const tagsEjs = fs.readFileSync(
    path.join(__dirname, "../templates/tags.ejs"),
    { encoding: "utf-8" }
  );

  const renderedTags = ejs.render(tagsEjs, { tags });

  fs.writeFileSync(path.join(tempDir, "tags.php"), renderedTags);

  console.log(chalk.green("PHP Files Created!"));

  console.log(chalk.white("Copying pages..."));
  fse.copySync(pagesDir, path.join(tempDir, config.pagesFolder));
  console.log(chalk.green("Pages copied!"));
  console.log(chalk.white("Copying public folder..."));
  fse.copySync(publicDir, path.join(tempDir, config.publicFolder));
  console.log(chalk.green("Public folder copied!"));
  console.log(chalk.white("Copying posts..."));
  fse.copySync(postsDir, path.join(tempDir, config.postsFolder));
  console.log(chalk.green("Posts copied!"));
  console.log(chalk.white("Copying intro.md..."));
  fse.copyFileSync(
    path.join(currentDir, "intro.md"),
    path.join(tempDir, "intro.md")
  );
  console.log(chalk.green("Intro.md copied!"));
  console.log(chalk.white("Copying main menu..."));
  fse.copyFileSync(
    path.join(currentDir, "main-menu.json"),
    path.join(tempDir, "main-menu.json")
  );
  console.log(chalk.green("Main menu copied!"));

  const pages = await getPages();

  const themes = Object.keys(config.themeImageResolutions);
  for (let index = 0; index < themes.length; index++) {
    const theme = themes[index];

    console.log(chalk.bgGreen(chalk.white("Processing Theme Images:")) + theme);
    const imageTypes = config.themeImageResolutions[theme];

    const imageMaps: Record<string, ImageMap[]> = {};

    if (imageTypes.postThumbnail) {
      console.log(chalk.bgGreen(chalk.white("Processing Post Thumbnails")));

      const maps = await processPostThumbnails(
        theme + "-thumbnail",
        posts,
        imageTypes.postThumbnail
      );

      imageMaps["postThumbnail"] = maps;
    }

    if (imageTypes.contentImage) {
      console.log(chalk.bgGreen(chalk.white("Processing Content Images")));

      const contentImages = getContentImages([...posts, ...pages]);

      const maps = await processImages(
        theme,
        contentImages,
        imageTypes.contentImage
      );

      imageMaps["contentImage"] = maps;
    }

    const galleryImages = getGalleryImages([...posts, ...pages]);

    if (imageTypes.galleryImage) {
      console.log(chalk.bgGreen(chalk.white("Processing Gallery Images")));
      const maps = await processImages(
        theme + "-gallery",
        galleryImages,
        imageTypes.galleryImage
      );

      imageMaps["galleryImage"] = maps;
    }

    if (imageTypes.galleryThumbnail) {
      console.log(chalk.bgGreen(chalk.white("Processing Gallery Thumbnails")));
      const maps = await processImages(
        theme + "-gallery-thumb",
        galleryImages,
        imageTypes.galleryThumbnail
      );

      imageMaps["galleryThumbnail"] = maps;
    }

    console.log(chalk.bgGreen(chalk.white("Generating Image Maps: ")) + theme);

    const imageMapsEjs = fs.readFileSync(
      path.join(__dirname, "../templates/image-maps.ejs"),
      { encoding: "utf-8" }
    );

    const renderedImageMaps = ejs.render(imageMapsEjs, { imageMaps });

    fs.writeFileSync(
      path.join(tempDir, theme + "-image-maps.php"),
      renderedImageMaps
    );
  }

  console.log(chalk.bgGreen(chalk.white("DEPLOYING...")));

  const client = new basicftp.Client();
  client.ftp.verbose = true;
  await client.access({
    host: ftpConfig.host,
    user: ftpConfig.user,
    password: ftpConfig.password,
    secure: ftpConfig.secure,
  });

  await client.ensureDir(ftpConfig.uploadPath);
  await client.clearWorkingDir();
  await client.uploadFromDir(tempDir);

  client.close();

  console.log(chalk.bgGreen(chalk.white("DONE!")));
}

run();
