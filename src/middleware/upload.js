const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const env = require('../config/env');
const AppError = require('../utils/AppError');

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // accepted upload size
const MAX_STORED_BYTES = 1024 * 1024; // stored file size after compression

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return cb(new AppError('Only JPG, PNG or WEBP images are allowed', 400));
    }
    return cb(null, true);
  },
});

/**
 * Resizes and compresses an uploaded image to JPEG (max ~1 MB) and saves it
 * under /uploads/<folder>. Returns the public URL path.
 */
async function saveImage(file, folder, maxSize = 1000) {
  const dir = path.join(env.uploadsDir, folder);
  fs.mkdirSync(dir, { recursive: true });

  let buffer;
  try {
    let quality = 82;
    let size = maxSize;
    do {
      buffer = await sharp(file.buffer)
        .rotate() // respect phone camera orientation
        .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      quality -= 10;
      size = Math.round(size * 0.85);
    } while (buffer.length > MAX_STORED_BYTES && quality > 30);
  } catch (err) {
    throw new AppError('This image could not be read. Please choose another photo', 400);
  }

  const fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.jpg`;
  await fs.promises.writeFile(path.join(dir, fileName), buffer);
  return `/uploads/${folder}/${fileName}`;
}

function deleteImage(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const filePath = path.join(env.uploadsDir, url.replace('/uploads/', ''));
  fs.promises.unlink(filePath).catch(() => {});
}

module.exports = { upload, saveImage, deleteImage };
