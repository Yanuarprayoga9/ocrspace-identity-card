const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const dotenv = require('dotenv');
const { ocrSpace } = require('./ocrSpace');

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const API_KEY = process.env.OCR_API_KEY || 'helloworld';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

// Configuration
const MAX_FILE_SIZE = 1024 * 1024; // 1024 KB max for OCR Space
const COMPRESSION_QUALITY = 80; // JPEG quality (1-100)
const MAX_DIMENSION = 2000; // Max width/height after resize

// Middleware
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb' }));

// Multer setup for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

/**
 * Compress image buffer to be under MAX_FILE_SIZE (1024 KB)
 * @param {Buffer} imageBuffer Image buffer
 * @param {string} mimeType MIME type of image
 * @return {Promise<Buffer>} Compressed image buffer
 */
async function compressImage(imageBuffer, mimeType = 'image/jpeg') {
  try {
    let compressed = imageBuffer;
    let quality = COMPRESSION_QUALITY;
    let maxDimension = MAX_DIMENSION;
    let attempts = 0;
    const maxAttempts = 5;
    
    while (compressed.length > MAX_FILE_SIZE && attempts < maxAttempts) {
      attempts++;
      
      // Reduce quality and dimensions progressively
      compressed = await sharp(compressed)
        .resize(maxDimension, maxDimension, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: quality, progressive: true })
        .toBuffer();
      
      quality -= 10;
      maxDimension = Math.floor(maxDimension * 0.9);
    }
    
    return compressed;
  } catch (error) {
    // Return original if compression fails
    return imageBuffer;
  }
}

/**
 * Extract NIK from OCR text
 * Pattern: NIK is EXACTLY 16 digits (tidak boleh lebih dan kurang)
 * Prioritas: NIK label → first digit sequence exactly 16 digits
 */
function extractNIK(text) {
  if (!text) return null;
  
  // Normalize: remove newlines, normalize spaces
  let cleanText = text.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Method 1: Look for "NIK" label followed by exactly 16 digits
  // This is the MOST RELIABLE method
  const nikLabelMatch = cleanText.match(/NIK\s*[:.\s\-]*\s*(\d{1,3}[\s\-]?\d{1,3}[\s\-]?\d{1,3}[\s\-]?\d{1,3}[\s\-]?\d{1,3}[\s\-]?\d{1,3}[\s\-]?\d{1,3}[\s\-]?\d{1,3})/i);
  if (nikLabelMatch) {
    const rawNik = nikLabelMatch[1];
    const nik = rawNik.replace(/[\s\-]/g, '');
    
    // Strictly EXACTLY 16 digits
    if (nik.length === 16 && /^\d{16}$/.test(nik)) {
      return nik;
    }
  }
  
  // Method 2: Find ALL 16-digit sequences in the text and return FIRST one found
  // (usually the first significant number on KTP is the NIK)
  const allDigitsPattern = cleanText.match(/(\d[\s\-]*){15,}\d/g);
  if (allDigitsPattern) {
    for (const match of allDigitsPattern) {
      const nik = match.replace(/\D/g, '');
      
      // Strictly EXACTLY 16 digits
      if (nik.length === 16 && /^\d{16}$/.test(nik)) {
        return nik;
      } else if (nik.length > 16) {
        // If we have more than 16, take first 16 only if they look like NIK
        const first16 = nik.substring(0, 16);
        if (/^\d{16}$/.test(first16)) {
          return first16;
        }
      }
    }
  }
  
  // Method 3: Split by spaces and find first 16-digit number
  const words = cleanText.split(/[\s\-]+/);
  for (const word of words) {
    const nik = word.replace(/\D/g, '');
    if (nik.length === 16 && /^\d{16}$/.test(nik)) {
      return nik;
    }
  }
  
  return null;
}

/**
 * Extract other KTP information from OCR text
 */
function extractKTPInfo(text) {
  if (!text) return {};
  
  const info = {};
  
  // Extract Nama (Name) - usually after "Nama" or "Nama :"
  const namaMatch = text.match(/Nama\s*[:]*\s*([^\n]+)/i);
  if (namaMatch) {
    const nama = namaMatch[1].trim();
    // Clean up and take first meaningful part
    info.nama = nama.split(/\n|Tempat|Jenis|Gol\.|Alamat/i)[0].trim();
  }
  
//   // Extract Jenis Kelamin (Gender) - case insensitive
//   const genderMatch = text.match(/Jenis\s*Kelamin\s*:\s*([^\n]+)/i);
//   if (genderMatch) {
//     const genderText = genderMatch[1].trim().toUpperCase();
//     if (genderText.includes('PEREMPUAN') || genderText.includes('WANITA') || genderText === 'P') {
//       info.gender = 'PEREMPUAN';
//     } else if (genderText.includes('LAKI') || genderText === 'L') {
//       info.gender = 'LAKI-LAKI';
//     }
//   }
  
//   // Extract Tanggal Lahir (Birth Date) - format YYYY-MM-DD
//   const tanggalMatch = text.match(/Tempat\/Tgl\s*Lahir\s*:\s*[^,]+,\s*(\d{1,2})-(\d{1,2})-(\d{4})/i);
//   if (tanggalMatch) {
//     const day = tanggalMatch[1].padStart(2, '0');
//     const month = tanggalMatch[2].padStart(2, '0');
//     const year = tanggalMatch[3];
//     info.birth_date = `${year}-${month}-${day}`;
//   }
  
  return info;
}

/**
 * POST /extract-nik
 * Extract NIK and info from KTP image
 * 
 * Body:
 * - image: base64 string or URL
 * - type: 'base64' or 'url' (default: auto-detect)
 */
app.post('/extract-nik', async (req, res) => {
  try {
    const { image, type } = req.body;
    
    if (!image) {
      return res.status(400).json({
        success: false,
        message: 'Image is required'
      });
    }
    
    let input = image;
    let isBase64 = type === 'base64' || image.startsWith('data:');
    
    // Process base64 image: compress if needed
    if (isBase64) {
      try {
        // Extract base64 data
        let base64Data = image;
        let mimeType = 'image/jpeg';
        
        if (image.startsWith('data:')) {
          const matches = image.match(/data:([^;]+);base64,(.+)/);
          if (matches) {
            mimeType = matches[1];
            base64Data = matches[2];
          }
        }
        
        // Convert to buffer
        const imageBuffer = Buffer.from(base64Data, 'base64');
        
        // Compress if needed
        if (imageBuffer.length > MAX_FILE_SIZE) {
          const compressedBuffer = await compressImage(imageBuffer, mimeType);
          const compressedBase64 = compressedBuffer.toString('base64');
          input = `data:${mimeType};base64,${compressedBase64}`;
        } else if (!image.startsWith('data:')) {
          // Add data prefix if missing
          input = `data:${mimeType};base64,${base64Data}`;
        }
      } catch (compressionError) {
        // Continue with original if compression fails
        if (!image.startsWith('data:')) {
          input = `data:image/jpeg;base64,${image}`;
        }
      }
    }
    
    // Call OCR Space API
    const ocrResult = await ocrSpace(input, {
      apiKey: API_KEY,
      language: 'auto',
      isOverlayRequired: false,
      OCREngine: 2
    });
    
    if (!ocrResult.IsErroredOnProcessing) {
      const extractedText = ocrResult.ParsedText;
      const nik = extractNIK(extractedText);
      const ktpInfo = extractKTPInfo(extractedText);
      
      return res.json({
        status: 'success',
        message: nik ? 'Data berhasil diekstraksi' : 'NIK tidak ditemukan',
        data: {
          identity_number: nik,
          fullname: ktpInfo.nama || null
        }
      });
    } else {
      return res.status(400).json({
        status: 'error',
        message: 'Error processing image',
        error: ocrResult.ErrorMessage
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * POST /extract-nik-file
 * Extract NIK from uploaded KTP file
 * Query params:
 * - crop=true: Crop bagian atas untuk fokus NIK (optional, disabled by default for better accuracy)
 * - cropHeight=100: Tinggi crop dari atas (default: 100px)
 */
app.post('/extract', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'File is required'
      });
    }
    
    const shouldCrop = req.query.crop === 'true'; // Disabled by default
    const cropHeight = parseInt(req.query.cropHeight || '100');
    
    let imageBuffer = req.file.buffer;
    
    // Crop image only if explicitly requested
    if (shouldCrop) {
      try {
        imageBuffer = await sharp(req.file.buffer)
          .extract({ left: 0, top: 0, width: null, height: cropHeight })
          .toBuffer();
      } catch (cropError) {
        // Continue dengan original image jika crop gagal
      }
    }
    
    // Compress image if size exceeds limit
    if (imageBuffer.length > MAX_FILE_SIZE) {
      imageBuffer = await compressImage(imageBuffer, req.file.mimetype || 'image/jpeg');
    }
    
    // Convert buffer to base64
    const base64Image = imageBuffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';
    const input = `data:${mimeType};base64,${base64Image}`;
    
    // Call OCR Space API
    const ocrResult = await ocrSpace(input, {
      apiKey: API_KEY,
      language: 'auto',
      isOverlayRequired: false,
      OCREngine: 2
    });
    
    if (!ocrResult.IsErroredOnProcessing) {
      const extractedText = ocrResult.ParsedText;
      const nik = extractNIK(extractedText);
      const ktpInfo = extractKTPInfo(extractedText);
      
      return res.json({
        status: 'success',
        message: nik ? 'Data berhasil diekstraksi' : 'NIK tidak ditemukan',
        data: {
          identity_number: nik,
          fullname: ktpInfo.nama || null
        }
      });
    } else {
      return res.status(400).json({
        status: 'error',
        message: 'Error processing image',
        error: ocrResult.ErrorMessage
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * POST /debug-ocr
 * Debug endpoint - lihat teks OCR mentah tanpa ekstraksi
 */
app.post('/debug-ocr', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'File is required'
      });
    }
    
    // Convert buffer to base64
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';
    const input = `data:${mimeType};base64,${base64Image}`;
    
    // Call OCR Space API
    const ocrResult = await ocrSpace(input, {
      apiKey: API_KEY,
      language: 'auto',
      isOverlayRequired: false,
      OCREngine: 2
    });
    
    return res.json({
      success: true,
      rawText: ocrResult.ParsedText,
      ocrResult: ocrResult,
      textLength: ocrResult.ParsedText?.length || 0,
      lines: ocrResult.ParsedText?.split('\n') || []
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'KTP NIK Extractor API is running' });
});

/**
 * GET /
 * API documentation
 */
app.get('/', (req, res) => {
  res.json({
    name: 'KTP NIK Extractor API',
    version: '1.0.0',
    endpoints: {
      'POST /extract': {
        description: 'Extract NIK from KTP image using base64 or URL',
        body: {
          image: 'Base64 string or image URL (required)',
          type: 'base64 or url (optional, auto-detected)'
        }
      },
      'POST /extract-nik-file': {
        description: 'Extract NIK from uploaded KTP file',
        body: 'multipart/form-data with file field'
      },
      'GET /health': {
        description: 'Health check endpoint'
      }
    }
  });
});

app.listen(port,'127.0.0.1', () => {
  console.log(`KTP NIK Extractor API running on http://localhost:${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`CORS Origin: ${CORS_ORIGIN}`);
});
