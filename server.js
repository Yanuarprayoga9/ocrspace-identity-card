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
 * Extract NIK from OCR text
 * Pattern: NIK is 16 digits (bisa terpisah dengan spasi atau dash)
 */
function extractNIK(text) {
  if (!text) return null;
  
  // Normalize: remove newlines, normalize spaces
  let cleanText = text.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Try to find all digit sequences that could be NIK
  const digitSequences = cleanText.match(/\d+/g) || [];
  
  for (const seq of digitSequences) {
    const cleaned = seq.replace(/[\s\-]/g, '');
    if (cleaned.length === 16 && /^\d{16}$/.test(cleaned)) {
      return cleaned;
    }
  }
  
  // Pattern: "NIK" followed by digits (with any separators)
  let nikMatch = cleanText.match(/NIK\s*[:.\s\-]*\s*(\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d)/i);
  if (nikMatch) {
    return nikMatch[1].replace(/[\s\-]/g, '');
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
    
    // Add base64 prefix if needed
    if (type === 'base64' && !image.startsWith('data:')) {
      input = `data:image/jpeg;base64,${image}`;
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
    console.error('Error:', error);
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
 * - crop=true: Crop bagian atas untuk fokus NIK
 * - cropHeight=100: Tinggi crop dari atas (default: 150)
 */
app.post('/extract', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'File is required'
      });
    }
    
    const shouldCrop = req.query.crop === 'true';
    const cropHeight = parseInt(req.query.cropHeight || '100'); // Default 100px (optimal untuk NIK)
    
    let imageBuffer = req.file.buffer;
    
    // Crop image if requested
    if (shouldCrop) {
      try {
        imageBuffer = await sharp(req.file.buffer)
          .extract({ left: 0, top: 0, width: null, height: cropHeight })
          .toBuffer();
        console.log(`Image cropped to height: ${cropHeight}px`);
      } catch (cropError) {
        console.error('Crop error:', cropError);
        // Continue dengan original image jika crop gagal
      }
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
    console.error('Error:', error);
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
      'POST /extract-nik': {
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

app.listen(port, () => {
  console.log(`KTP NIK Extractor API running on http://localhost:${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`CORS Origin: ${CORS_ORIGIN}`);
});
