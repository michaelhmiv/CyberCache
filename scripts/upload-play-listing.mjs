import fs from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { google } from 'googleapis';

const packageName = 'com.michaelhmiv.cybercache';
const language = 'en-US';
const metadataRoot = path.resolve('fastlane/metadata/android', language);
const keyPath = process.argv[2];

if (!keyPath) {
  throw new Error('Usage: node scripts/upload-play-listing.mjs <service-account-json>');
}

const credentials = JSON.parse(await readFile(keyPath, 'utf8'));
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});
const play = google.androidpublisher({ version: 'v3', auth });

async function readText(fileName) {
  return (await readFile(path.join(metadataRoot, fileName), 'utf8')).trim();
}

async function listPngs(relativeDir) {
  const dir = path.join(metadataRoot, 'images', relativeDir);
  const entries = await readdir(dir);
  return entries
    .filter((entry) => entry.toLowerCase().endsWith('.png'))
    .sort((a, b) => a.localeCompare(b))
    .map((entry) => path.join(dir, entry));
}

async function replaceImages(editId, imageType, files) {
  await play.edits.images.deleteall({
    packageName,
    editId,
    language,
    imageType,
  }).catch((error) => {
    if (error?.code !== 404) throw error;
  });

  for (const file of files) {
    await play.edits.images.upload({
      packageName,
      editId,
      language,
      imageType,
      media: {
        mimeType: 'image/png',
        body: fs.createReadStream(file),
      },
    });
    console.log(`Uploaded ${imageType}: ${path.relative(process.cwd(), file)}`);
  }
}

const edit = await play.edits.insert({ packageName, requestBody: {} });
const editId = edit.data.id;

if (!editId) {
  throw new Error('Google Play did not return an edit id.');
}

await play.edits.listings.update({
  packageName,
  editId,
  language,
  requestBody: {
    title: await readText('title.txt'),
    shortDescription: await readText('short_description.txt'),
    fullDescription: await readText('full_description.txt'),
    video: await readText('video.txt'),
  },
});

await replaceImages(editId, 'icon', [path.join(metadataRoot, 'images', 'icon.png')]);
await replaceImages(editId, 'featureGraphic', [path.join(metadataRoot, 'images', 'featureGraphic.png')]);
await replaceImages(editId, 'phoneScreenshots', await listPngs('phoneScreenshots'));
await replaceImages(editId, 'sevenInchScreenshots', await listPngs('sevenInchScreenshots'));
await replaceImages(editId, 'tenInchScreenshots', await listPngs('tenInchScreenshots'));

await play.edits.commit({ packageName, editId });
console.log(`Committed Play Store listing edit ${editId} for ${packageName}.`);
